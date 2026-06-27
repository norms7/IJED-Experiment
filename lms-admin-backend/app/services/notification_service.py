"""
notification_service.py
-----------------------
Central helper for creating notifications and broadcasting them via SSE.

Usage (in any endpoint):
    from app.services.notification_service import NotificationService
    await NotificationService.notify(db, target_user_id=5, actor_user_id=2,
        notification_type="activity_graded",
        title="Activity Graded",
        message="Your quiz 'Chapter 1 Quiz' has been graded: 90/100",
        link_type="activity", link_id=12)
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Notification, Student, Teacher, User, StudentSubjectEnrollment, TeacherClassAssignment


# ── SSE connection registry ───────────────────────────────────────────────────
# Maps user_id → list of asyncio.Queue (one per open browser tab / connection)
_connections: dict[int, list[asyncio.Queue]] = {}


def register_connection(user_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _connections.setdefault(user_id, []).append(q)
    return q


def unregister_connection(user_id: int, q: asyncio.Queue) -> None:
    conns = _connections.get(user_id, [])
    if q in conns:
        conns.remove(q)
    if not conns:
        _connections.pop(user_id, None)


def _push_to_user(user_id: int, payload: dict) -> None:
    """Push SSE payload to all open connections for a user (fire-and-forget)."""
    for q in _connections.get(user_id, []):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass  # client too slow — skip, they'll see it on next poll


# ── Core notification creator ─────────────────────────────────────────────────

class NotificationService:

    @staticmethod
    async def notify(
        db: AsyncSession,
        *,
        target_user_id: int,
        notification_type: str,
        title: str,
        message: str,
        actor_user_id: Optional[int] = None,
        link_type: Optional[str] = None,
        link_id: Optional[int] = None,
    ) -> Notification:
        """Create a DB notification and push it live via SSE."""
        notif = Notification(
            target_user_id=target_user_id,
            actor_user_id=actor_user_id,
            notification_type=notification_type,
            title=title,
            message=message,
            link_type=link_type,
            link_id=link_id,
        )
        db.add(notif)
        await db.flush()
        await db.refresh(notif)

        payload = {
            "id":                notif.id,
            "type":              notif.notification_type,
            "title":             notif.title,
            "message":           notif.message,
            "link_type":         notif.link_type,
            "link_id":           notif.link_id,
            "is_read":           notif.is_read,
            "created_at":        notif.created_at.isoformat(),
        }
        _push_to_user(target_user_id, payload)
        return notif

    @staticmethod
    async def notify_many(
        db: AsyncSession,
        *,
        target_user_ids: list[int],
        notification_type: str,
        title: str,
        message: str,
        actor_user_id: Optional[int] = None,
        link_type: Optional[str] = None,
        link_id: Optional[int] = None,
    ) -> None:
        """Create notifications for multiple users at once (e.g. whole class)."""
        for uid in target_user_ids:
            await NotificationService.notify(
                db,
                target_user_id=uid,
                notification_type=notification_type,
                title=title,
                message=message,
                actor_user_id=actor_user_id,
                link_type=link_type,
                link_id=link_id,
            )

    # ── Convenience helpers ───────────────────────────────────────────────────

    @staticmethod
    async def get_enrolled_student_user_ids(db: AsyncSession, subject_id: int) -> list[int]:
        """Return user_ids of all students enrolled in a subject.
        Tries direct subject enrollment first, then falls back to section-based enrollment."""
        # Method 1: direct StudentSubjectEnrollment
        result = await db.execute(
            select(Student.user_id)
            .join(StudentSubjectEnrollment, StudentSubjectEnrollment.student_id == Student.id)
            .where(StudentSubjectEnrollment.subject_id == subject_id)
        )
        user_ids = [r[0] for r in result.all()]
        if user_ids:
            return user_ids

        # Method 2: fallback via section → class → teacher_class_assignment
        from app.models.models import StudentSectionAssignment, Section
        result2 = await db.execute(
            select(Student.user_id)
            .join(StudentSectionAssignment, StudentSectionAssignment.student_id == Student.id)
            .join(Section, Section.id == StudentSectionAssignment.section_id)
            .join(TeacherClassAssignment, TeacherClassAssignment.class_id == Section.class_id)
            .where(TeacherClassAssignment.subject_id == subject_id)
        )
        return [r[0] for r in result2.all()]

    @staticmethod
    async def get_teacher_user_id_for_subject(db: AsyncSession, subject_id: int) -> Optional[int]:
        """Return user_id of the teacher assigned to a subject."""
        result = await db.execute(
            select(Teacher.user_id)
            .join(TeacherClassAssignment, TeacherClassAssignment.teacher_id == Teacher.id)
            .where(TeacherClassAssignment.subject_id == subject_id)
            .limit(1)
        )
        row = result.first()
        return row[0] if row else None

    @staticmethod
    async def get_admin_user_ids(db: AsyncSession) -> list[int]:
        """Return user_ids of all active admin users."""
        from app.models.models import Role
        role_result = await db.execute(
            select(Role.id).where(Role.name == "admin")
        )
        role_row = role_result.first()
        if not role_row:
            return []
        result = await db.execute(
            select(User.id).where(User.role_id == role_row[0], User.is_active == True)
        )
        return [r[0] for r in result.all()]

    @staticmethod
    async def get_teacher_user_id_for_activity(db: AsyncSession, activity) -> Optional[int]:
        """Return teacher's user_id for an activity.
        Uses activity.teacher_id first, falls back to subject assignment."""
        if activity.teacher_id:
            result = await db.execute(
                select(Teacher.user_id).where(Teacher.id == activity.teacher_id)
            )
            row = result.first()
            if row:
                return row[0]
        # Fallback via subject
        if activity.subject_id:
            return await NotificationService.get_teacher_user_id_for_subject(db, activity.subject_id)
        # Fallback via module → subject
        from app.models.models import Module
        mod_result = await db.execute(
            select(Module).where(Module.id == activity.module_id)
        )
        mod = mod_result.scalar_one_or_none()
        if mod and mod.subject_id:
            return await NotificationService.get_teacher_user_id_for_subject(db, mod.subject_id)
        return None
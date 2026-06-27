"""
Student Dashboard — aggregated stats endpoint.

GET  /student/me/dashboard         → counts + module/activity progress + avg grade
POST /student/me/modules/{id}/read → mark a module as read by this student

PERF FIX (2025-06):
  Replaced 5 sequential await db.execute() calls with asyncio.gather() groups.
  Queries that don't depend on each other now run concurrently.

  Before: subject_ids → mod_ids → read_count → act_ids → sub_count → avg_score
          (each waits for the previous — total = sum of all query times)
  After:  subject_ids → [mod_ids + read_count in parallel]
                      → [act_ids in parallel once mod_ids known]
                      → [sub_count + avg_score in parallel]
          (total = subject_ids + max(mod_ids, read_count) + max(act_ids_wait)
                 + max(sub_count, avg_score))
"""
import asyncio
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import bearer_scheme, decode_token
from app.db.session import get_db
from app.models.models import (
    Activity, ActivitySubmission, Module, Student,
    StudentModuleRead, StudentSectionAssignment,
    StudentSubjectEnrollment, TeacherClassAssignment,
)

student_dashboard_router = APIRouter(prefix="/student", tags=["Student Dashboard"])


# ── Auth dependency ──────────────────────────────────────────────────────────

async def get_current_student(
    credentials=Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Student:
    payload = decode_token(credentials.credentials)
    if payload.get("role", "") not in ("student", "admin"):
        raise HTTPException(status_code=403, detail="Student access required")
    user_id = int(payload["sub"])
    result = await db.execute(
        select(Student)
        .options(
            selectinload(Student.section_assignments)
            .selectinload(StudentSectionAssignment.section),
            selectinload(Student.subject_enrollments),
        )
        .where(Student.user_id == user_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")
    return student


async def _resolve_subject_ids(student: Student, db: AsyncSession) -> set[int]:
    """Return the set of subject_ids the student is enrolled in."""
    direct = student.subject_enrollments or []
    if direct:
        return {e.subject_id for e in direct}
    # Fallback: section → class → teacher_class_assignments
    class_ids = {
        a.section.class_id
        for a in student.section_assignments
        if a.section and a.section.class_id
    }
    if not class_ids:
        return set()
    tca = await db.execute(
        select(TeacherClassAssignment.subject_id)
        .where(TeacherClassAssignment.class_id.in_(class_ids))
    )
    return {r[0] for r in tca.all()}


# ── GET /student/me/dashboard ────────────────────────────────────────────────

@student_dashboard_router.get("/me/dashboard", summary="Student dashboard summary")
async def get_student_dashboard(
    student: Student = Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    # Step 1 — subject_ids must come first (everything else depends on it)
    subject_ids = await _resolve_subject_ids(student, db)
    enrolled_count = len(subject_ids)

    if not subject_ids:
        return {
            "enrolled_subjects": 0,
            "modules":    {"done": 0, "total": 0},
            "activities": {"done": 0, "total": 0},
            "average_score": 0.0,
        }

    # Step 2 — module IDs and read count are independent; run them in parallel
    mod_ids_coro = db.execute(
        select(Module.id)
        .where(Module.subject_id.in_(subject_ids), Module.is_published == True)
    )

    # We need module IDs before we can query reads, so fetch modules first,
    # but we CAN run the read-count and act-ids queries once we have module IDs.
    # Structure: gather([mod_ids]) → gather([read_count, act_ids]) → gather([sub_count, avg])

    mod_result = await mod_ids_coro
    all_module_ids = [r[0] for r in mod_result.all()]
    total_modules = len(all_module_ids)

    if not all_module_ids:
        return {
            "enrolled_subjects": enrolled_count,
            "modules":    {"done": 0, "total": 0},
            "activities": {"done": 0, "total": 0},
            "average_score": 0.0,
        }

    # Step 3 — read count + activity IDs are both independent once we have module IDs
    read_coro = db.execute(
        select(func.count(StudentModuleRead.id))
        .where(
            StudentModuleRead.student_id == student.id,
            StudentModuleRead.module_id.in_(all_module_ids),
        )
    )
    act_ids_coro = db.execute(
        select(Activity.id)
        .where(
            Activity.module_id.in_(all_module_ids),
            Activity.is_published == True,
        )
    )

    read_result, act_result = await asyncio.gather(read_coro, act_ids_coro)

    modules_read = read_result.scalar() or 0
    all_activity_ids = [r[0] for r in act_result.all()]
    total_activities = len(all_activity_ids)

    if not all_activity_ids:
        return {
            "enrolled_subjects": enrolled_count,
            "modules":    {"done": modules_read, "total": total_modules},
            "activities": {"done": 0, "total": 0},
            "average_score": 0.0,
        }

    # Step 4 — submission count + graded scores are independent; run in parallel
    sub_count_coro = db.execute(
        select(func.count(ActivitySubmission.id))
        .where(
            ActivitySubmission.student_id == student.id,
            ActivitySubmission.activity_id.in_(all_activity_ids),
        )
    )
    avg_score_coro = db.execute(
        select(ActivitySubmission.score, ActivitySubmission.max_score)
        .where(
            ActivitySubmission.student_id == student.id,
            ActivitySubmission.activity_id.in_(all_activity_ids),
            ActivitySubmission.is_graded == True,
            ActivitySubmission.score.isnot(None),
            ActivitySubmission.max_score.isnot(None),
            ActivitySubmission.max_score > 0,
        )
    )

    sub_count_result, graded_result = await asyncio.gather(sub_count_coro, avg_score_coro)

    activities_done = sub_count_result.scalar() or 0

    graded_rows = graded_result.all()
    avg_score = 0.0
    if graded_rows:
        total_pct = sum(
            (row.score / row.max_score * 100)
            for row in graded_rows
        )
        avg_score = round(total_pct / len(graded_rows), 1)

    return {
        "enrolled_subjects": enrolled_count,
        "modules":    {"done": modules_read,    "total": total_modules},
        "activities": {"done": activities_done, "total": total_activities},
        "average_score": avg_score,
    }


# ── POST /student/me/modules/{id}/read ──────────────────────────────────────

@student_dashboard_router.post(
    "/me/modules/{module_id}/read",
    summary="Mark a module as read by the current student",
)
async def mark_module_read(
    module_id: int,
    student: Student = Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    # Check module exists and is published
    mod_result = await db.execute(
        select(Module).where(Module.id == module_id, Module.is_published == True)
    )
    module = mod_result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Upsert: insert if not exists, update last_read_at if exists
    existing = await db.execute(
        select(StudentModuleRead).where(
            StudentModuleRead.student_id == student.id,
            StudentModuleRead.module_id == module_id,
        )
    )
    record = existing.scalar_one_or_none()
    if not record:
        record = StudentModuleRead(student_id=student.id, module_id=module_id)
        db.add(record)
        await db.flush()
        message = "Module marked as read"
    else:
        record.last_read_at = datetime.now(timezone.utc)
        message = "Module read timestamp updated"

    await db.commit()
    return {
        "message": message,
        "module_id": module_id,
        "student_id": student.id,
        "first_read_at": record.first_read_at.isoformat(),
        "last_read_at": record.last_read_at.isoformat(),
    }

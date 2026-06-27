"""
Attendance endpoints — Teacher role only.

Routes (all prefixed /teacher/attendance):
  GET    /sections                              → sections the teacher advises (with room/subject)
  GET    /sections/{class_id}/students          → student attendance summary for a class
  GET    /sessions                              → list sessions for a class+subject+term
  POST   /sessions                             → create a session (has_class T/F + records)
  PUT    /sessions/{session_id}                → update session records
  DELETE /sessions/{session_id}               → delete a session
  GET    /sections/{class_id}/stats            → per-student present/absent/total counts
"""

from datetime import date, datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.api.v1.endpoints.teacher_portal import get_current_teacher


def _fmt_date(d):
    """Serialize a date or string to ISO string."""
    if d is None:
        return None
    if isinstance(d, str):
        return d
    return d.isoformat()

router = APIRouter(prefix="/teacher/attendance", tags=["Attendance"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class AttendanceRecordIn(BaseModel):
    student_id: int
    status: str = "absent"   # present | absent | late | excused
    remarks: Optional[str] = None

class SessionCreateRequest(BaseModel):
    class_id:     int
    subject_id:   Optional[int] = None
    term:         str = "1st"        # 1st | 2nd | 3rd | 4th
    session_date: str                # "YYYY-MM-DD"
    has_class:    bool = True
    notes:        Optional[str] = None
    records:      List[AttendanceRecordIn] = []

class SessionUpdateRequest(BaseModel):
    has_class:    Optional[bool] = None
    notes:        Optional[str] = None
    records:      List[AttendanceRecordIn] = []


# ── GET /teacher/attendance/sections ─────────────────────────────────────────

@router.get("/sections", summary="Get sections advised by this teacher")
async def get_advised_sections(
    teacher=Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import TeacherClassAssignment, Class, Section, Subject

    result = await db.execute(
        select(TeacherClassAssignment)
        .options(
            selectinload(TeacherClassAssignment.class_).selectinload(Class.sections),
            selectinload(TeacherClassAssignment.subject),
        )
        .where(TeacherClassAssignment.teacher_id == teacher.id)
    )
    assignments = result.scalars().all()

    # Build one row per unique class (section group)
    seen = {}
    for a in assignments:
        cls = a.class_
        if cls.id not in seen:
            seen[cls.id] = {
                "class_id":    cls.id,
                "class_name":  cls.name,
                "grade_level": cls.grade_level or "",
                "school_year": cls.school_year or "",
                "subjects":    [],
                "sections":    [{"id": s.id, "name": s.name} for s in cls.sections],
            }
        seen[cls.id]["subjects"].append({
            "subject_id":   a.subject.id,
            "subject_name": a.subject.name,
            "schedule":     a.schedule or "",
        })

    return list(seen.values())


# ── GET /teacher/attendance/sections/{class_id}/students ─────────────────────

@router.get("/sections/{class_id}/students", summary="Students + attendance summary for a class")
async def get_section_students(
    class_id: int,
    subject_id: Optional[int] = Query(None),
    term: Optional[str] = Query(None),
    teacher=Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import (
        TeacherClassAssignment, Section, StudentSectionAssignment,
        Student, AttendanceSession, AttendanceRecord
    )

    # Auth check — use first() because a teacher may have multiple subject
    # assignments to the same class, which would cause scalar_one_or_none() to
    # raise MultipleResultsFound.
    result = await db.execute(
        select(TeacherClassAssignment).where(
            TeacherClassAssignment.teacher_id == teacher.id,
            TeacherClassAssignment.class_id == class_id,
        )
    )
    if not result.scalars().first():
        raise HTTPException(status_code=403, detail="Not assigned to this class")

    # Get sections for this class
    result = await db.execute(select(Section).where(Section.class_id == class_id))
    sections = result.scalars().all()
    section_ids = [s.id for s in sections]
    if not section_ids:
        return {"students": [], "total_meetings": 0}

    # Get students
    result = await db.execute(
        select(Student)
        .options(selectinload(Student.user))
        .join(Student.section_assignments)
        .where(StudentSectionAssignment.section_id.in_(section_ids))
        .distinct()
    )
    students = result.scalars().all()
    student_ids = [s.id for s in students]

    # Total meetings (sessions) for this class+subject+term
    q_sessions = select(AttendanceSession).where(
        AttendanceSession.class_id == class_id,
        AttendanceSession.teacher_id == teacher.id,
    )
    if subject_id:
        q_sessions = q_sessions.where(AttendanceSession.subject_id == subject_id)
    if term:
        q_sessions = q_sessions.where(AttendanceSession.term == term)

    result = await db.execute(q_sessions)
    sessions = result.scalars().all()
    # Only sessions where class was actually held count as meetings
    total_meetings = sum(1 for s in sessions if s.has_class)
    session_ids = [s.id for s in sessions if s.has_class]

    # Per-student counts
    present_counts = {sid: 0 for sid in student_ids}
    absent_counts  = {sid: 0 for sid in student_ids}
    late_counts    = {sid: 0 for sid in student_ids}
    excused_counts = {sid: 0 for sid in student_ids}

    if session_ids and student_ids:
        result = await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.session_id.in_(session_ids),
                AttendanceRecord.student_id.in_(student_ids),
            )
        )
        for rec in result.scalars().all():
            if rec.status == "present":
                present_counts[rec.student_id] = present_counts.get(rec.student_id, 0) + 1
            elif rec.status == "absent":
                absent_counts[rec.student_id]  = absent_counts.get(rec.student_id, 0)  + 1
            elif rec.status == "late":
                late_counts[rec.student_id]    = late_counts.get(rec.student_id, 0)    + 1
            elif rec.status == "excused":
                excused_counts[rec.student_id] = excused_counts.get(rec.student_id, 0) + 1

    return {
        "total_meetings": total_meetings,
        "students": [
            {
                "id":             s.id,
                "student_number": s.student_number or "",
                "first_name":     s.user.first_name,
                "last_name":      s.user.last_name,
                "present":        present_counts.get(s.id, 0),
                "absent":         absent_counts.get(s.id, 0),
                "late":           late_counts.get(s.id, 0),
                "excused":        excused_counts.get(s.id, 0),
                "total_meetings": total_meetings,
            }
            for s in students
        ],
    }


# ── GET /teacher/attendance/sessions ─────────────────────────────────────────

@router.get("/sessions", summary="List attendance sessions for a class")
async def list_sessions(
    class_id:   int = Query(...),
    subject_id: Optional[int]  = Query(None),
    term:       Optional[str]  = Query(None),
    teacher=Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import AttendanceSession, AttendanceRecord

    q = select(AttendanceSession).where(
        AttendanceSession.class_id   == class_id,
        AttendanceSession.teacher_id == teacher.id,
    )
    if subject_id:
        q = q.where(AttendanceSession.subject_id == subject_id)
    if term:
        q = q.where(AttendanceSession.term == term)
    q = q.order_by(AttendanceSession.session_date.desc())

    result = await db.execute(q)
    sessions = result.scalars().all()

    return [
        {
            "id":           s.id,
            "session_date": _fmt_date(s.session_date),
            "has_class":    s.has_class,
            "term":         s.term,
            "subject_id":   s.subject_id,
            "notes":        s.notes or "",
        }
        for s in sessions
    ]


# ── GET /teacher/attendance/sessions/{session_id} ─────────────────────────────

@router.get("/sessions/{session_id}", summary="Get session details with records")
async def get_session(
    session_id: int,
    teacher=Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import AttendanceSession, AttendanceRecord, Student

    result = await db.execute(
        select(AttendanceSession)
        .options(selectinload(AttendanceSession.records))
        .where(AttendanceSession.id == session_id,
               AttendanceSession.teacher_id == teacher.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "id":           session.id,
        "session_date": _fmt_date(session.session_date),
        "has_class":    session.has_class,
        "term":         session.term,
        "subject_id":   session.subject_id,
        "notes":        session.notes or "",
        "records": [
            {
                "student_id": r.student_id,
                "status":     r.status,
                "remarks":    r.remarks or "",
            }
            for r in session.records
        ],
    }


# ── POST /teacher/attendance/sessions ─────────────────────────────────────────

@router.post("/sessions", summary="Create an attendance session", status_code=201)
async def create_session(
    body: SessionCreateRequest,
    teacher=Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import (
        TeacherClassAssignment, AttendanceSession, AttendanceRecord
    )

    # Auth check — use first() to handle teachers with multiple subject assignments per class
    result = await db.execute(
        select(TeacherClassAssignment).where(
            TeacherClassAssignment.teacher_id == teacher.id,
            TeacherClassAssignment.class_id   == body.class_id,
        )
    )
    if not result.scalars().first():
        raise HTTPException(status_code=403, detail="Not assigned to this class")

    # Duplicate check
    parsed_date = datetime.strptime(body.session_date, "%Y-%m-%d").date()

    result = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.class_id     == body.class_id,
            AttendanceSession.subject_id   == body.subject_id,
            AttendanceSession.session_date == parsed_date,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409,
                            detail=f"Session already exists for {body.session_date}")

    session = AttendanceSession(
        teacher_id   = teacher.id,
        class_id     = body.class_id,
        subject_id   = body.subject_id,
        term         = body.term,
        session_date = parsed_date,
        has_class    = body.has_class,
        notes        = body.notes,
    )
    db.add(session)
    await db.flush()  # get session.id

    if body.has_class:
        for rec in body.records:
            db.add(AttendanceRecord(
                session_id = session.id,
                student_id = rec.student_id,
                status     = rec.status,
                remarks    = rec.remarks,
            ))

    await db.commit()
    await db.refresh(session)
    return {"id": session.id, "session_date": _fmt_date(session.session_date), "has_class": session.has_class}


# ── PUT /teacher/attendance/sessions/{session_id} ─────────────────────────────

@router.put("/sessions/{session_id}", summary="Update an attendance session")
async def update_session(
    session_id: int,
    body: SessionUpdateRequest,
    teacher=Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import AttendanceSession, AttendanceRecord

    result = await db.execute(
        select(AttendanceSession)
        .options(selectinload(AttendanceSession.records))
        .where(AttendanceSession.id == session_id,
               AttendanceSession.teacher_id == teacher.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if body.has_class is not None:
        session.has_class = body.has_class
    if body.notes is not None:
        session.notes = body.notes

    # Replace all records
    for rec in session.records:
        await db.delete(rec)
    await db.flush()

    if session.has_class:
        for rec in body.records:
            db.add(AttendanceRecord(
                session_id = session.id,
                student_id = rec.student_id,
                status     = rec.status,
                remarks    = rec.remarks,
            ))

    await db.commit()
    return {"message": "Session updated", "id": session_id}


# ── DELETE /teacher/attendance/sessions/{session_id} ──────────────────────────

@router.delete("/sessions/{session_id}", summary="Delete an attendance session")
async def delete_session(
    session_id: int,
    teacher=Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import AttendanceSession

    result = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.id == session_id,
            AttendanceSession.teacher_id == teacher.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return {"message": "Session deleted", "id": session_id}

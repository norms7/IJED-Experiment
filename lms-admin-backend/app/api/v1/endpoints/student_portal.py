"""
Student Portal — endpoints for logged-in students.

GET /student/me/subjects  → subjects the student is directly enrolled in
                            (student_subject_enrollments table, set by admin)
                            Falls back to section → class → teacher_class_assignments
                            if no direct enrollments exist.
GET /student/me/modules   → published modules for the student's enrolled subjects
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import bearer_scheme, decode_token
from app.db.session import get_db
from app.models.models import (
    Module, Section, Student, StudentSectionAssignment,
    StudentSubjectEnrollment, Subject,
    TeacherClassAssignment,
)
from app.schemas.schemas import ModuleOut

router = APIRouter(prefix="/student", tags=["Student Portal"])

# ── Note: get_current_student is defined below; attendance endpoint at bottom ─


# ── Auth dependency ───────────────────────────────────────────────────────────

async def get_current_student(
    credentials=Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    payload = decode_token(credentials.credentials)
    role = payload.get("role", "")
    if role not in ("student", "admin"):
        raise HTTPException(status_code=403, detail="Student access required")

    user_id = int(payload["sub"])
    result = await db.execute(
        select(Student)
        .options(
            selectinload(Student.section_assignments)
            .selectinload(StudentSectionAssignment.section)
            .selectinload(Section.class_),
            selectinload(Student.subject_enrollments)
            .selectinload(StudentSubjectEnrollment.subject),
        )
        .where(Student.user_id == user_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")
    return student


# ── GET /student/me/subjects ──────────────────────────────────────────────────

@router.get("/me/subjects", summary="Get my enrolled subjects")
async def get_student_subjects(
    student=Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns subjects the student is enrolled in.

    Priority:
    1. Direct subject enrollments via student_subject_enrollments
       (set by admin through the "Enroll in Subjects" feature).
    2. Fallback: subjects inferred from the student's section → class →
       teacher_class_assignments (for legacy/section-only setups).
    """

    # ── 1. Direct subject enrollments (primary source) ────────────────────
    direct_enrollments = student.subject_enrollments or []

    if direct_enrollments:
        # For each enrolled subject, also look up which class it belongs to
        # (via teacher_class_assignments) so we can show the class name.
        subject_ids = [e.subject_id for e in direct_enrollments]

        tca_result = await db.execute(
            select(TeacherClassAssignment)
            .options(
                selectinload(TeacherClassAssignment.subject),
                selectinload(TeacherClassAssignment.class_),
            )
            .where(TeacherClassAssignment.subject_id.in_(subject_ids))
        )
        tca_rows = tca_result.scalars().all()

        # Build subject_id → class info map (use first assignment found)
        class_map: dict[int, dict] = {}
        for tca in tca_rows:
            if tca.subject_id not in class_map:
                class_map[tca.subject_id] = {
                    "class_id": tca.class_.id,
                    "class_name": tca.class_.name,
                }

        subjects = []
        for e in direct_enrollments:
            class_info = class_map.get(e.subject_id, {})
            subjects.append({
                "subject_id": e.subject.id,
                "subject_name": e.subject.name,
                "class_id": class_info.get("class_id"),
                "class_name": class_info.get("class_name", "—"),
            })
        return subjects

    # ── 2. Fallback: section → class → teacher assignments ────────────────
    class_ids = {
        a.section.class_id
        for a in student.section_assignments
        if a.section and a.section.class_id
    }
    if not class_ids:
        return []

    result = await db.execute(
        select(TeacherClassAssignment)
        .options(
            selectinload(TeacherClassAssignment.subject),
            selectinload(TeacherClassAssignment.class_),
        )
        .where(TeacherClassAssignment.class_id.in_(class_ids))
    )
    assignments = result.scalars().all()

    seen: set[int] = set()
    subjects = []
    for a in assignments:
        if a.subject_id not in seen:
            seen.add(a.subject_id)
            subjects.append({
                "subject_id": a.subject.id,
                "subject_name": a.subject.name,
                "class_id": a.class_.id,
                "class_name": a.class_.name,
            })
    return subjects


# ── GET /student/me/modules ───────────────────────────────────────────────────

@router.get("/me/modules", response_model=list[ModuleOut], summary="Get modules for my subjects")
async def get_student_modules(
    subject_id: Optional[int] = Query(None),
    student=Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns published modules for the subjects the student is enrolled in.
    Resolves subject list the same way as /me/subjects (direct enrollments first,
    then section fallback). Optionally filter by subject_id.
    """

    # ── Collect subject_ids the student has access to ─────────────────────
    direct_enrollments = student.subject_enrollments or []

    if direct_enrollments:
        enrolled_subject_ids = {e.subject_id for e in direct_enrollments}
    else:
        # Fallback to section → class → subjects
        class_ids = {
            a.section.class_id
            for a in student.section_assignments
            if a.section and a.section.class_id
        }
        if not class_ids:
            return []

        tca_result = await db.execute(
            select(TeacherClassAssignment.subject_id)
            .where(TeacherClassAssignment.class_id.in_(class_ids))
        )
        enrolled_subject_ids = {row[0] for row in tca_result.all()}

    if not enrolled_subject_ids:
        return []

    # ── Query published modules for those subjects ────────────────────────
    q = (
        select(Module)
        .options(selectinload(Module.activities))
        .where(Module.subject_id.in_(enrolled_subject_ids))
        .where(Module.is_published == True)
    )
    if subject_id:
        q = q.where(Module.subject_id == subject_id)
    q = q.order_by(Module.subject_id, Module.term, Module.order)

    rows = (await db.execute(q)).scalars().all()
    result = []
    for m in rows:
        out = ModuleOut.model_validate(m)
        out.activity_count = len(m.activities)
        result.append(out)
    return result

# ── GET /student/me/attendance ────────────────────────────────────────────────

@router.get("/me/attendance", summary="Get my attendance summary per subject")
async def get_my_attendance(
    student=Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a read-only attendance summary for the logged-in student.

    For every subject the student is enrolled in, returns:
      - subject name
      - class name
      - per-term breakdown: present / absent / late / excused / total_meetings
      - overall totals across all terms

    Only sessions where has_class=True count as meetings (same logic as teacher view).
    """
    from app.models.models import (
        AttendanceSession, AttendanceRecord,
        TeacherClassAssignment, Subject,
        StudentSubjectEnrollment, Section,
    )

    # ── 1. Resolve which (subject_id, class_id) pairs the student belongs to ─
    direct = student.subject_enrollments or []
    if direct:
        subject_ids = [e.subject_id for e in direct]
        tca_result = await db.execute(
            select(TeacherClassAssignment)
            .options(
                selectinload(TeacherClassAssignment.subject),
                selectinload(TeacherClassAssignment.class_),
            )
            .where(TeacherClassAssignment.subject_id.in_(subject_ids))
        )
        tca_rows = tca_result.scalars().all()
        # Build list of unique (subject_id, class_id, subject_name, class_name)
        seen_pairs: dict[int, dict] = {}
        for tca in tca_rows:
            if tca.subject_id not in seen_pairs:
                seen_pairs[tca.subject_id] = {
                    "subject_id":   tca.subject_id,
                    "subject_name": tca.subject.name,
                    "class_id":     tca.class_.id,
                    "class_name":   tca.class_.name,
                }
        subject_class_pairs = list(seen_pairs.values())
    else:
        # Fallback: section → class → teacher assignments
        class_ids = {
            a.section.class_id
            for a in student.section_assignments
            if a.section and a.section.class_id
        }
        if not class_ids:
            return []
        tca_result = await db.execute(
            select(TeacherClassAssignment)
            .options(
                selectinload(TeacherClassAssignment.subject),
                selectinload(TeacherClassAssignment.class_),
            )
            .where(TeacherClassAssignment.class_id.in_(class_ids))
        )
        seen_pairs = {}
        for tca in tca_result.scalars().all():
            if tca.subject_id not in seen_pairs:
                seen_pairs[tca.subject_id] = {
                    "subject_id":   tca.subject_id,
                    "subject_name": tca.subject.name,
                    "class_id":     tca.class_.id,
                    "class_name":   tca.class_.name,
                }
        subject_class_pairs = list(seen_pairs.values())

    if not subject_class_pairs:
        return []

    # ── 2. Fetch all sessions across these (class_id, subject_id) pairs ───────
    # Build OR conditions so we only match valid (class_id, subject_id) pairs,
    # not any cross-product of class_ids × subject_ids.
    from sqlalchemy import or_, and_
    pair_conditions = or_(*(
        and_(
            AttendanceSession.class_id   == p["class_id"],
            AttendanceSession.subject_id == p["subject_id"],
        )
        for p in subject_class_pairs
    ))
    sessions_result = await db.execute(
        select(AttendanceSession).where(
            pair_conditions,
            AttendanceSession.has_class == True,
        )
    )
    sessions = sessions_result.scalars().all()
    session_ids = [s.id for s in sessions]

    # ── 3. Fetch this student's attendance records ─────────────────────────────
    records_by_session: dict[int, str] = {}  # session_id → status
    if session_ids:
        rec_result = await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.session_id.in_(session_ids),
                AttendanceRecord.student_id == student.id,
            )
        )
        for rec in rec_result.scalars().all():
            records_by_session[rec.session_id] = rec.status

    # ── 4. Aggregate per subject per term ──────────────────────────────────────
    # Build a lookup: (class_id, subject_id) → pair info
    pair_lookup = {
        (p["class_id"], p["subject_id"]): p
        for p in subject_class_pairs
    }

    # subject_id → { term → { present, absent, late, excused, total } }
    agg: dict[int, dict[str, dict]] = {}
    for sid in [p["subject_id"] for p in subject_class_pairs]:
        agg[sid] = {}

    for sess in sessions:
        key = (sess.class_id, sess.subject_id)
        if key not in pair_lookup:
            continue
        sid  = sess.subject_id
        term = sess.term or "1st"

        if term not in agg[sid]:
            agg[sid][term] = {"present": 0, "absent": 0, "late": 0, "excused": 0, "total": 0}

        agg[sid][term]["total"] += 1
        status = records_by_session.get(sess.id, "absent")  # no record = absent
        if status in agg[sid][term]:
            agg[sid][term][status] += 1
        else:
            agg[sid][term]["absent"] += 1

    # ── 5. Build response ──────────────────────────────────────────────────────
    TERM_ORDER = ["1st", "2nd", "3rd", "4th"]
    output = []
    for pair in subject_class_pairs:
        sid       = pair["subject_id"]
        term_data = agg.get(sid, {})

        terms_list = []
        totals = {"present": 0, "absent": 0, "late": 0, "excused": 0, "total": 0}
        for term in TERM_ORDER:
            if term in term_data:
                t = term_data[term]
                terms_list.append({"term": term, **t})
                for k in totals:
                    totals[k] += t.get(k, 0)

        output.append({
            "subject_id":   pair["subject_id"],
            "subject_name": pair["subject_name"],
            "class_id":     pair["class_id"],
            "class_name":   pair["class_name"],
            "terms":        terms_list,
            "totals":       totals,
        })

    return output
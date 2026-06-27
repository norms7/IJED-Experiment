"""
Teacher Portal endpoints — for logged-in teachers (not admin-only).
GET  /teacher/me/subjects                          → subjects assigned to this teacher
GET  /teacher/me/class/{class_id}/students         → students in a class
GET  /teacher/me/modules                           → modules uploaded by this teacher
POST /teacher/me/modules                           → upload a new module (with PDF)
POST /teacher/me/modules/upload                    → upload PDF file, returns file_url

Student Portal endpoints — for logged-in students.
GET  /student/me/modules                           → published modules for enrolled classes
GET  /student/me/subjects                          → subjects available to student
GET  /student/me/activities                        → published activities for enrolled subjects
POST /student/me/activities/{id}/submit            → submit answers (auto-graded or manual queue)
GET  /student/me/activities/{id}/result            → get own submission result
"""
import json
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from supabase import create_client, Client as SupabaseClient

from app.core.config import settings

# ── Supabase Storage client ───────────────────────────────────────────────────

_supabase: SupabaseClient = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_SERVICE_KEY,
)
STORAGE_BUCKET = "modules"

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import bearer_scheme, decode_token
from app.db.session import get_db
from app.models.models import (
    Activity, ActivityAnswer, ActivityQuestion, ActivityQuestionChoice,
    ActivitySubmission, Module, Subject, Teacher, TeacherClassAssignment, User,
)
from app.schemas.schemas import ModuleOut
from app.schemas import ActivitySubmitRequest

router = APIRouter(prefix="/teacher", tags=["Teacher Portal"])


# ── Auth dependency for any logged-in teacher ─────────────────────────────────

async def get_current_teacher(
    credentials=Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Teacher:
    payload = decode_token(credentials.credentials)
    role = payload.get("role", "")
    if role not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Teacher access required")

    user_id = int(payload["sub"])
    result = await db.execute(
        select(Teacher)
        .options(selectinload(Teacher.class_assignments).selectinload(TeacherClassAssignment.subject))
        .options(selectinload(Teacher.class_assignments).selectinload(TeacherClassAssignment.class_))
        .where(Teacher.user_id == user_id)
    )
    teacher = result.scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher profile not found")
    return teacher


# ── GET /teacher/me/subjects ──────────────────────────────────────────────────

@router.get("/me/subjects", summary="Get my assigned subjects")
async def get_my_subjects(
    teacher: Teacher = Depends(get_current_teacher),
):
    """Returns all subjects this teacher is assigned to, with class info."""
    seen = set()
    subjects = []
    for assignment in teacher.class_assignments:
        key = (assignment.subject_id, assignment.class_id)
        if key not in seen:
            seen.add(key)
            subjects.append({
                "subject_id": assignment.subject.id,
                "subject_name": assignment.subject.name,
                "class_id": assignment.class_.id,
                "class_name": assignment.class_.name,
                "grade_level": assignment.class_.grade_level,
                "schedule": assignment.schedule,
            })
    return subjects


# ── GET /teacher/me/class/{class_id}/students ─────────────────────────────────

@router.get("/me/class/{class_id}/students", summary="Get students enrolled in a class")
async def get_class_students(
    class_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns all students enrolled in any section that belongs to the given class.
    The teacher must be assigned to this class (via teacher_class_assignments).
    """
    from app.models.models import TeacherClassAssignment
    result = await db.execute(
        select(TeacherClassAssignment).where(
            TeacherClassAssignment.teacher_id == teacher.id,
            TeacherClassAssignment.class_id == class_id,
        )
    )
    # Use first() — a teacher may have multiple assignment rows for the same
    # class (one per subject/section), so scalar_one_or_none() raises
    # MultipleResultsFound when that happens.
    assignment = result.scalars().first()
    if not assignment:
        raise HTTPException(status_code=403, detail="You are not assigned to this class")

    from app.models.models import Section, StudentSectionAssignment, Student, User
    result = await db.execute(
        select(Section).where(Section.class_id == class_id)
    )
    sections = result.scalars().all()
    section_ids = [s.id for s in sections]
    if not section_ids:
        return []

    result = await db.execute(
        select(Student)
        .options(selectinload(Student.user))
        .join(Student.section_assignments)
        .where(StudentSectionAssignment.section_id.in_(section_ids))
        .distinct()
    )
    students = result.scalars().all()

    return [
        {
            "id": s.id,
            "student_number": s.student_number,
            "user": {
                "id": s.user.id,
                "first_name": s.user.first_name,
                "last_name": s.user.last_name,
                "email": s.user.email,
                "is_active": s.user.is_active,
            }
        }
        for s in students
    ]


# ── POST /teacher/me/modules/upload ──────────────────────────────────────────

@router.post("/me/modules/upload", summary="Upload PDF file for a module")
async def upload_module_file(
    file: UploadFile = File(...),
    teacher: Teacher = Depends(get_current_teacher),
):
    """Upload a PDF file to Supabase Storage. Returns the public file_url."""
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Max 20MB.")

    unique_name = f"{uuid.uuid4()}_{file.filename}"
    storage_path = f"teacher/files/{unique_name}"

    try:
        _supabase.storage.from_(STORAGE_BUCKET).upload(
            path=storage_path,
            file=contents,
            file_options={"content-type": "application/pdf"},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {exc}")

    public_url = _supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)

    return {
        "file_url": public_url,
        "file_name": file.filename,
    }


# ── GET /teacher/files/{filename} ────────────────────────────────────────────
# Kept for backwards compatibility: old file_url values stored in the DB
# as `/teacher/files/<uuid>_<name>` will still resolve.
# New uploads store the full Supabase public URL directly in file_url.

@router.get("/files/{filename}", summary="Download/view a module PDF")
async def serve_file(filename: str):
    storage_path = f"teacher/files/{filename}"
    try:
        public_url = _supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="File not found")
    return RedirectResponse(url=public_url, status_code=302)


# ── GET /teacher/me/modules ───────────────────────────────────────────────────

@router.get("/me/modules", response_model=list[ModuleOut], summary="Get my modules")
async def get_my_modules(
    subject_id: Optional[int] = Query(None),
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Returns all modules this teacher has uploaded, optionally filtered by subject."""
    q = (
        select(Module)
        .options(selectinload(Module.activities))
        .where(Module.teacher_id == teacher.id)
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


# ── POST /teacher/me/modules ──────────────────────────────────────────────────

@router.post(
    "/me/modules",
    response_model=ModuleOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a module",
)
async def create_my_module(
    title: str = Form(...),
    subject_id: int = Form(...),
    description: Optional[str] = Form(None),
    term: Optional[str] = Form(None),
    file_url: Optional[str] = Form(None),
    file_name: Optional[str] = Form(None),
    is_published: bool = Form(True),
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new module. Call /teacher/me/modules/upload first to get file_url,
    then pass it here along with the module details.
    """
    assigned_subject_ids = {a.subject_id for a in teacher.class_assignments}
    if subject_id not in assigned_subject_ids:
        raise HTTPException(
            status_code=403,
            detail="You are not assigned to this subject"
        )

    class_id = None
    for a in teacher.class_assignments:
        if a.subject_id == subject_id:
            class_id = a.class_id
            break

    module = Module(
        title=title,
        description=description,
        subject_id=subject_id,
        class_id=class_id,
        teacher_id=teacher.id,
        term=term,
        file_url=file_url,
        file_name=file_name,
        is_published=is_published,
        order=0,
    )
    db.add(module)
    await db.flush()
    await db.refresh(module, ["activities"])

    # ── Notify enrolled students about the new module ─────────────────────
    if is_published:
        from app.services.notification_service import NotificationService
        student_user_ids = await NotificationService.get_enrolled_student_user_ids(db, subject_id)
        subject_name = next(
            (a.subject.name for a in teacher.class_assignments if a.subject_id == subject_id),
            "your subject"
        )
        await NotificationService.notify_many(
            db,
            target_user_ids=student_user_ids,
            notification_type="module_uploaded",
            title="New Module Available",
            message=f"A new module '{title}' has been uploaded for {subject_name}.",
            actor_user_id=teacher.user_id,
            link_type="module",
            link_id=module.id,
        )
        # Also notify admins
        admin_user_ids = await NotificationService.get_admin_user_ids(db)
        await NotificationService.notify_many(
            db,
            target_user_ids=admin_user_ids,
            notification_type="module_uploaded",
            title="Module Uploaded",
            message=f"Teacher uploaded '{title}' for {subject_name}.",
            actor_user_id=teacher.user_id,
            link_type="module",
            link_id=module.id,
        )

    out = ModuleOut.model_validate(module)
    out.activity_count = 0
    return out


# ── DELETE /teacher/me/modules/{module_id} ────────────────────────────────────

@router.delete(
    "/me/modules/{module_id}",
    summary="Delete one of my modules",
    status_code=status.HTTP_200_OK,
)
async def delete_my_module(
    module_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a module that belongs to this teacher.
    Returns 403 if the module belongs to a different teacher.
    """
    result = await db.execute(
        select(Module).where(Module.id == module_id)
    )
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    if module.teacher_id != teacher.id:
        raise HTTPException(status_code=403, detail="You can only delete your own modules")

    if module.file_url:
        # Extract the storage path from the URL.
        # Handles both new-style full Supabase URLs and old-style /teacher/files/<name> paths.
        if "/object/public/" in module.file_url:
            # e.g. https://<project>.supabase.co/storage/v1/object/public/module/teacher/files/<name>
            storage_path = module.file_url.split(f"/object/public/{STORAGE_BUCKET}/", 1)[-1]
        else:
            # legacy relative path: /teacher/files/<uuid>_<name>
            filename = module.file_url.split("/")[-1]
            storage_path = f"teacher/files/{filename}"
        try:
            _supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except Exception:
            pass  # Don't block deletion if the storage object is already gone

    await db.delete(module)
    await db.flush()
    return {"message": "Module deleted successfully", "id": module_id}



# ── GET /teacher/me/class/{class_id}/module-reads ─────────────────────────────

@router.get("/me/class/{class_id}/module-reads", summary="Get module read counts per student for a class")
async def get_class_module_reads(
    class_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a dict mapping student_id → number of modules they have read
    for all modules belonging to this class.
    """
    from app.models.models import (
        TeacherClassAssignment, Section, StudentSectionAssignment,
        Student, Module, StudentModuleRead
    )

    # Verify teacher is assigned to this class
    result = await db.execute(
        select(TeacherClassAssignment).where(
            TeacherClassAssignment.teacher_id == teacher.id,
            TeacherClassAssignment.class_id == class_id,
        )
    )
    if not result.scalars().first():
        raise HTTPException(status_code=403, detail="You are not assigned to this class")

    # ── Get all module ids for this class ────────────────────────────────
    # BUG FIX: modules on live are created with subject_id but class_id may be NULL.
    # We must collect modules by BOTH class_id AND subject_id (via teacher assignments).
    # Step 1: get subject_ids assigned to this teacher for this class
    tca_subjects_result = await db.execute(
        select(TeacherClassAssignment.subject_id).where(
            TeacherClassAssignment.teacher_id == teacher.id,
            TeacherClassAssignment.class_id == class_id,
        )
    )
    subject_ids_for_class = [row[0] for row in tca_subjects_result.all()]

    # Step 2: fetch modules that match EITHER class_id OR subject_id (union)
    from sqlalchemy import or_
    module_conditions = [Module.class_id == class_id]
    if subject_ids_for_class:
        module_conditions.append(Module.subject_id.in_(subject_ids_for_class))

    result = await db.execute(
        select(Module.id).where(or_(*module_conditions), Module.is_published == True)
    )
    module_ids = list({row[0] for row in result.all()})  # dedupe with set
    if not module_ids:
        return {"module_reads": {}, "total_modules": 0}

    # ── Get all students in this class ───────────────────────────────────
    # BUG FIX: on live, students are enrolled via StudentSubjectEnrollment
    # (direct subject enrollments), NOT via section_assignments.
    # We must collect student_ids from BOTH sources.
    student_id_set: set[int] = set()

    # Source 1: section_assignments (legacy / local)
    result = await db.execute(
        select(Section).where(Section.class_id == class_id)
    )
    sections = result.scalars().all()
    section_ids = [s.id for s in sections]
    if section_ids:
        result = await db.execute(
            select(Student.id)
            .join(Student.section_assignments)
            .where(StudentSectionAssignment.section_id.in_(section_ids))
            .distinct()
        )
        student_id_set.update(row[0] for row in result.all())

    # Source 2: direct subject enrollments (live / Railway)
    if subject_ids_for_class:
        from app.models.models import StudentSubjectEnrollment
        result = await db.execute(
            select(StudentSubjectEnrollment.student_id)
            .where(StudentSubjectEnrollment.subject_id.in_(subject_ids_for_class))
            .distinct()
        )
        student_id_set.update(row[0] for row in result.all())

    student_ids = list(student_id_set)

    if not student_ids:
        return {"module_reads": {}, "total_modules": len(module_ids)}

    # Fetch all read records for these students+modules
    result = await db.execute(
        select(StudentModuleRead.student_id, StudentModuleRead.module_id)
        .where(
            StudentModuleRead.student_id.in_(student_ids),
            StudentModuleRead.module_id.in_(module_ids),
        )
    )
    reads = result.all()

    # Count reads per student
    counts = {sid: 0 for sid in student_ids}
    for student_id, _ in reads:
        counts[student_id] = counts.get(student_id, 0) + 1

    return {
        "module_reads": counts,   # { "student_id": read_count, ... }
        "total_modules": len(module_ids),
    }


# ══════════════════════════════════════════════════════════════════════════════
# STUDENT PORTAL
# ══════════════════════════════════════════════════════════════════════════════

student_router = APIRouter(prefix="/student", tags=["Student Portal"])


async def get_current_student(
    credentials=Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import Student, StudentSectionAssignment, Section
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
            .selectinload(Section.class_)
        )
        .where(Student.user_id == user_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")
    return student


# ── Auto-grade helper ─────────────────────────────────────────────────────────

def _auto_grade(question: ActivityQuestion, answer_value: Optional[str]):
    """Returns (is_correct, points_earned). Returns (None, None) for essay/manual."""
    if answer_value is None:
        return (False, 0) if question.question_type != "essay" else (None, None)

    if question.question_type == "multiple_choice":
        correct = str(question.correct_answer or "").strip()
        ok = answer_value.strip() == correct
        return (ok, question.points if ok else 0)

    elif question.question_type == "checkbox":
        try:
            correct = set(json.loads(question.correct_answer or "[]"))
            given   = set(json.loads(answer_value or "[]"))
            ok = correct == given
        except Exception:
            ok = False
        return (ok, question.points if ok else 0)

    elif question.question_type == "fill_blank":
        ok = answer_value.strip().lower() == (question.correct_answer or "").strip().lower()
        return (ok, question.points if ok else 0)

    # essay → manual grading
    return (None, None)


# ── GET /student/me/modules ───────────────────────────────────────────────────

@student_router.get("/me/modules", response_model=list[ModuleOut], summary="Get modules for my subjects")
async def get_student_modules(
    subject_id: Optional[int] = Query(None),
    student=Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """Returns published modules for the classes the student is enrolled in."""
    from app.models.models import StudentSectionAssignment, Section

    class_ids = {
        a.section.class_id
        for a in student.section_assignments
        if a.section and a.section.class_id
    }

    if not class_ids:
        return []

    q = (
        select(Module)
        .options(selectinload(Module.activities))
        .where(Module.class_id.in_(class_ids))
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


# ── GET /student/me/subjects ──────────────────────────────────────────────────

@student_router.get("/me/subjects", summary="Get my enrolled subjects")
async def get_student_subjects(
    student=Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """Returns subjects available to the student based on their class enrollment."""
    from app.models.models import TeacherClassAssignment

    class_ids = {
        a.section.class_id
        for a in student.section_assignments
        if a.section and a.section.class_id
    }
    if not class_ids:
        return []

    result = await db.execute(
        select(TeacherClassAssignment)
        .options(selectinload(TeacherClassAssignment.subject))
        .options(selectinload(TeacherClassAssignment.class_))
        .where(TeacherClassAssignment.class_id.in_(class_ids))
    )
    assignments = result.scalars().all()

    seen = set()
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
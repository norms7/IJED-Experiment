from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.core.security import get_current_admin
from app.schemas.schemas import (
    StudentCreate, StudentOut, StudentListResponse,
    AssignSectionRequest, MessageResponse,
    EnrollSubjectsRequest, StudentSubjectEnrollmentOut,
)
from app.services import student_service
from app.models.models import Student, Subject, StudentSubjectEnrollment

router = APIRouter(prefix="/admin/students", tags=["Student Management"])


@router.post(
    "",
    response_model=StudentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create Student Profile",
)
async def create_student(
    data: StudentCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Creates a student profile linked to an existing user.
    The linked user must already exist with role = 'student'.
    """
    return await student_service.create_student_profile(db, data)


@router.get("", response_model=StudentListResponse, summary="List All Students")
async def list_students(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Returns all active students with their section assignments."""
    return await student_service.list_students(db)


@router.get(
    "/by-section/{section_id}",
    response_model=StudentListResponse,
    summary="Students by Section",
)
async def students_by_section(
    section_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Returns all students enrolled in a given section."""
    return await student_service.get_students_by_section(db, section_id)


@router.get("/{student_id}", response_model=StudentOut, summary="Get Student Detail")
async def get_student(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    return StudentOut.model_validate(
        await student_service._load_student_full(db, student_id)
    )


@router.post(
    "/assign-section",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Assign Student to Section",
)
async def assign_section(
    data: AssignSectionRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Enrolls a student into a section.
    Business rule: each student belongs to exactly ONE section.
    Returns 409 if already assigned — deassign first if needed.
    """
    result = await student_service.assign_section(db, data)
    return MessageResponse(**result)


# ── Subject Enrollment ────────────────────────────────────────────────────────

@router.get(
    "/{student_id}/subjects",
    response_model=list[StudentSubjectEnrollmentOut],
    summary="Get Student's Enrolled Subjects",
)
async def get_student_subjects(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Returns all subjects the student is currently enrolled in."""
    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    result = await db.execute(
        select(StudentSubjectEnrollment)
        .where(StudentSubjectEnrollment.student_id == student_id)
        .options(selectinload(StudentSubjectEnrollment.subject))
    )
    enrollments = result.scalars().all()

    return [
        StudentSubjectEnrollmentOut(
            id=e.id,
            student_id=e.student_id,
            subject_id=e.subject_id,
            subject_name=e.subject.name,
            enrolled_at=e.enrolled_at,
        )
        for e in enrollments
    ]


@router.post(
    "/{student_id}/subjects",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Enroll Student in Subjects",
)
async def enroll_student_subjects(
    student_id: int,
    data: EnrollSubjectsRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Enrolls a student in one or more subjects.
    Replaces any existing subject enrollments with the new list.
    Pass an empty list to clear all enrollments.
    """
    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Validate all subject IDs exist
    if data.subject_ids:
        result = await db.execute(
            select(Subject).where(Subject.id.in_(data.subject_ids))
        )
        found = {s.id for s in result.scalars().all()}
        missing = set(data.subject_ids) - found
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Subject ID(s) not found: {sorted(missing)}"
            )

    # Remove existing enrollments and replace with new list
    await db.execute(
        delete(StudentSubjectEnrollment).where(
            StudentSubjectEnrollment.student_id == student_id
        )
    )

    for subject_id in data.subject_ids:
        db.add(StudentSubjectEnrollment(
            student_id=student_id,
            subject_id=subject_id,
        ))

    await db.commit()

    return MessageResponse(
        message=f"Student enrolled in {len(data.subject_ids)} subject(s) successfully."
    )


@router.delete(
    "/{student_id}/subjects/{subject_id}",
    response_model=MessageResponse,
    summary="Unenroll Student from a Subject",
)
async def unenroll_student_subject(
    student_id: int,
    subject_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Removes a single subject from the student's enrollment."""
    result = await db.execute(
        select(StudentSubjectEnrollment).where(
            StudentSubjectEnrollment.student_id == student_id,
            StudentSubjectEnrollment.subject_id == subject_id,
        )
    )
    enrollment = result.scalar_one_or_none()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    await db.delete(enrollment)
    await db.commit()
    return MessageResponse(message="Subject unenrollment successful.")
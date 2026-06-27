from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.models.models import Student, StudentSectionAssignment, Section, User
from app.schemas.schemas import (
    AssignSectionRequest, StudentOut, StudentListResponse, StudentCreate,
)


async def _load_student_full(db: AsyncSession, student_id: int) -> Student:
    result = await db.execute(
        select(Student)
        .options(
            selectinload(Student.user).selectinload(User.role),
            selectinload(Student.section_assignments).selectinload(StudentSectionAssignment.section),
        )
        .where(Student.id == student_id)
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Student not found")
    return s


async def create_student_profile(db: AsyncSession, data: StudentCreate) -> StudentOut:
    existing = await db.execute(select(Student).where(Student.user_id == data.user_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Student profile already exists for this user")

    student = Student(**data.model_dump())
    db.add(student)
    await db.flush()
    return StudentOut.model_validate(await _load_student_full(db, student.id))


async def list_students(db: AsyncSession) -> StudentListResponse:
    result = await db.execute(
        select(Student)
        .options(
            selectinload(Student.user).selectinload(User.role),
            selectinload(Student.section_assignments).selectinload(StudentSectionAssignment.section),
        )
        .join(Student.user)
        .where(User.is_active == True)
        .order_by(User.last_name)
    )
    students = result.scalars().all()
    return StudentListResponse(
        total=len(students),
        items=[StudentOut.model_validate(s) for s in students],
    )


async def get_students_by_section(db: AsyncSession, section_id: int) -> StudentListResponse:
    # Verify section exists
    section = await db.get(Section, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    result = await db.execute(
        select(Student)
        .options(
            selectinload(Student.user).selectinload(User.role),
            selectinload(Student.section_assignments).selectinload(StudentSectionAssignment.section),
        )
        .join(Student.section_assignments)
        .where(StudentSectionAssignment.section_id == section_id)
        .join(Student.user)
        .where(User.is_active == True)
    )
    students = result.scalars().unique().all()
    return StudentListResponse(
        total=len(students),
        items=[StudentOut.model_validate(s) for s in students],
    )


async def assign_section(db: AsyncSession, data: AssignSectionRequest) -> dict:
    # A student belongs to ONE section — check for any existing active assignment
    existing = await db.execute(
        select(StudentSectionAssignment).where(
            StudentSectionAssignment.student_id == data.student_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Student is already assigned to a section. Remove existing assignment first.",
        )

    section = await db.get(Section, data.section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    assignment = StudentSectionAssignment(
        student_id=data.student_id,
        section_id=data.section_id,
    )
    db.add(assignment)
    await db.flush()
    return {"message": "Student assigned to section successfully", "id": assignment.id}

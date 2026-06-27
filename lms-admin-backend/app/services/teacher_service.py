from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.models.models import Teacher, TeacherClassAssignment, User
from app.schemas.schemas import (
    AssignClassRequest, TeacherOut, TeacherListResponse, TeacherCreate,
)


async def _load_teacher_full(db: AsyncSession, teacher_id: int) -> Teacher:
    result = await db.execute(
        select(Teacher)
        .options(
            selectinload(Teacher.user).selectinload(User.role),
            selectinload(Teacher.class_assignments).selectinload(TeacherClassAssignment.class_),
            selectinload(Teacher.class_assignments).selectinload(TeacherClassAssignment.subject),
        )
        .where(Teacher.id == teacher_id)
    )
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return t


async def create_teacher_profile(db: AsyncSession, data: TeacherCreate) -> TeacherOut:
    # Check user exists and is not already a teacher
    existing = await db.execute(select(Teacher).where(Teacher.user_id == data.user_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Teacher profile already exists for this user")

    teacher = Teacher(**data.model_dump())
    db.add(teacher)
    await db.flush()
    return TeacherOut.model_validate(await _load_teacher_full(db, teacher.id))


async def list_teachers(db: AsyncSession) -> TeacherListResponse:
    result = await db.execute(
        select(Teacher)
        .options(
            selectinload(Teacher.user).selectinload(User.role),
            selectinload(Teacher.class_assignments).selectinload(TeacherClassAssignment.class_),
            selectinload(Teacher.class_assignments).selectinload(TeacherClassAssignment.subject),
        )
        .join(Teacher.user)
        .where(User.is_active == True)
        .order_by(User.last_name)
    )
    teachers = result.scalars().all()
    return TeacherListResponse(
        total=len(teachers),
        items=[TeacherOut.model_validate(t) for t in teachers],
    )


async def get_teacher(db: AsyncSession, teacher_id: int) -> TeacherOut:
    t = await _load_teacher_full(db, teacher_id)
    return TeacherOut.model_validate(t)


async def assign_class(db: AsyncSession, data: AssignClassRequest) -> dict:
    # Guard: duplicate check handled by DB unique constraint, but give friendly error
    existing = await db.execute(
        select(TeacherClassAssignment).where(
            TeacherClassAssignment.teacher_id == data.teacher_id,
            TeacherClassAssignment.class_id == data.class_id,
            TeacherClassAssignment.subject_id == data.subject_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Teacher is already assigned to this class/subject combination",
        )

    assignment = TeacherClassAssignment(
        teacher_id=data.teacher_id,
        class_id=data.class_id,
        subject_id=data.subject_id,
        schedule=data.schedule,
    )
    db.add(assignment)
    await db.flush()
    return {"message": "Teacher assigned successfully", "id": assignment.id}

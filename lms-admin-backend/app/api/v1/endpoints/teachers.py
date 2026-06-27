from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload

from app.db.session import get_db
from app.core.security import get_current_admin
from app.schemas.schemas import (
    TeacherCreate, TeacherOut, TeacherListResponse,
    AssignClassRequest, MessageResponse, TeacherUpdate, AssignmentUpdate,
)
from app.models.models import Teacher, TeacherClassAssignment, User, Role

router = APIRouter(prefix="/admin/teachers", tags=["Teacher Management"])


# ----------------------------------------------------------------------
# Core teacher CRUD (using service layer for consistency)
# ----------------------------------------------------------------------

@router.post("", response_model=TeacherOut, status_code=status.HTTP_201_CREATED)
async def create_teacher(
    data: TeacherCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Create a new teacher profile linked to an existing user."""
    from app.services import teacher_service
    return await teacher_service.create_teacher_profile(db, data)


@router.get("", response_model=TeacherListResponse)
async def list_teachers(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """List all teachers (active users with teacher role)."""
    from app.services import teacher_service
    return await teacher_service.list_teachers(db)


@router.get("/{teacher_id}", response_model=TeacherOut)
async def get_teacher(
    teacher_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Get a single teacher by ID with all assignments."""
    from app.services import teacher_service
    return await teacher_service.get_teacher(db, teacher_id)


@router.post("/assign-class", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def assign_class(
    data: AssignClassRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Assign a teacher to a class + subject combination.
    Checks for duplicate assignment (same teacher, class, subject) before creating.
    """
    # Check if teacher exists
    teacher_stmt = select(Teacher).where(Teacher.id == data.teacher_id)
    teacher_result = await db.execute(teacher_stmt)
    teacher = teacher_result.scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    # Check if class exists
    from app.models.models import Class
    class_stmt = select(Class).where(Class.id == data.class_id)
    class_result = await db.execute(class_stmt)
    class_ = class_result.scalar_one_or_none()
    if not class_:
        raise HTTPException(status_code=404, detail="Class not found")

    # Check if subject exists
    from app.models.models import Subject
    subject_stmt = select(Subject).where(Subject.id == data.subject_id)
    subject_result = await db.execute(subject_stmt)
    subject = subject_result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    # Prevent duplicate assignment
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
            detail="Teacher is already assigned to this class and subject combination."
        )

    # Create assignment
    assignment = TeacherClassAssignment(
        teacher_id=data.teacher_id,
        class_id=data.class_id,
        subject_id=data.subject_id,
        schedule=data.schedule,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    return MessageResponse(message="Teacher assigned successfully", id=assignment.id)


# ----------------------------------------------------------------------
# Extended teacher endpoints (direct implementation)
# ----------------------------------------------------------------------

@router.get("/by-user/{user_id}", response_model=TeacherOut, summary="Get Teacher by User ID")
async def get_teacher_by_user_id(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Fetch teacher profile using the user's ID (not teacher ID).
    Loads all relationships: user, role, class_assignments, subject, class.
    """
    stmt = (
        select(Teacher)
        .options(
            joinedload(Teacher.user).joinedload(User.role),
            joinedload(Teacher.class_assignments)
            .joinedload(TeacherClassAssignment.subject),
            joinedload(Teacher.class_assignments)
            .joinedload(TeacherClassAssignment.class_),
        )
        .where(Teacher.user_id == user_id)
    )
    result = await db.execute(stmt)
    teacher = result.unique().scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher profile not found for this user")
    return TeacherOut.model_validate(teacher)


@router.put("/{teacher_id}", response_model=TeacherOut, summary="Update Teacher Profile")
async def update_teacher(
    teacher_id: int,
    data: TeacherUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Update employee_id, specialization, or contact_number of a teacher."""
    stmt = select(Teacher).where(Teacher.id == teacher_id)
    result = await db.execute(stmt)
    teacher = result.scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(teacher, field, value)

    await db.commit()
    await db.refresh(teacher)

    # Reload with all relationships for the response
    reload_stmt = (
        select(Teacher)
        .options(
            joinedload(Teacher.user).joinedload(User.role),
            joinedload(Teacher.class_assignments)
            .joinedload(TeacherClassAssignment.subject),
            joinedload(Teacher.class_assignments)
            .joinedload(TeacherClassAssignment.class_),
        )
        .where(Teacher.id == teacher_id)
    )
    result2 = await db.execute(reload_stmt)
    teacher_out = result2.unique().scalar_one()
    return TeacherOut.model_validate(teacher_out)


@router.put("/assignments/{assignment_id}", response_model=MessageResponse)
async def update_assignment(
    assignment_id: int,
    data: AssignmentUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Update class_id, subject_id, or schedule of an existing assignment.
    Checks for conflicts with other assignments of the same teacher.
    """
    stmt = select(TeacherClassAssignment).where(TeacherClassAssignment.id == assignment_id)
    result = await db.execute(stmt)
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    update_data = data.model_dump(exclude_unset=True)
    # If class_id or subject_id is being changed, ensure no duplicate with other assignments
    new_class_id = update_data.get("class_id", assignment.class_id)
    new_subject_id = update_data.get("subject_id", assignment.subject_id)
    if new_class_id != assignment.class_id or new_subject_id != assignment.subject_id:
        duplicate = await db.execute(
            select(TeacherClassAssignment).where(
                TeacherClassAssignment.teacher_id == assignment.teacher_id,
                TeacherClassAssignment.class_id == new_class_id,
                TeacherClassAssignment.subject_id == new_subject_id,
                TeacherClassAssignment.id != assignment_id,
            )
        )
        if duplicate.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another assignment already exists for this teacher with the same class and subject."
            )

    for field, value in update_data.items():
        setattr(assignment, field, value)

    await db.commit()
    return MessageResponse(message="Assignment updated successfully")


@router.delete("/assignments/{assignment_id}", response_model=MessageResponse)
async def delete_assignment(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Delete a teacher-class-subject assignment."""
    stmt = select(TeacherClassAssignment).where(TeacherClassAssignment.id == assignment_id)
    result = await db.execute(stmt)
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await db.delete(assignment)
    await db.commit()
    return MessageResponse(message="Assignment deleted successfully")
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.models.models import User, Role
from app.schemas.schemas import UserCreate, UserUpdate, UserOut, UserListResponse
from app.core.security import hash_password


async def _get_role_or_404(db: AsyncSession, role_id: int) -> Role:
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail=f"Role {role_id} not found")
    return role


async def _check_email_unique(db: AsyncSession, email: str, exclude_id: int | None = None) -> None:
    q = select(User).where(User.email == email)
    if exclude_id:
        q = q.where(User.id != exclude_id)
    result = await db.execute(q)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Email '{email}' is already registered",
        )


async def create_user(db: AsyncSession, data: UserCreate) -> UserOut:
    await _check_email_unique(db, data.email)
    await _get_role_or_404(db, data.role_id)

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        first_name=data.first_name,
        last_name=data.last_name,
        role_id=data.role_id,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user, ["role"])
    return UserOut.model_validate(user)


async def list_users(
    db: AsyncSession,
    role_name: str | None,
    is_active: bool | None,
    search: str | None,
    page: int,
    page_size: int,
) -> UserListResponse:
    q = (
        select(User)
        .options(selectinload(User.role))
        .join(Role)
    )
    filters = []
    if role_name:
        filters.append(Role.name == role_name)
    if is_active is not None:
        filters.append(User.is_active == is_active)
    if search:
        term = f"%{search}%"
        filters.append(
            (User.first_name + " " + User.last_name).ilike(term) | User.email.ilike(term)
        )
    if filters:
        q = q.where(and_(*filters))

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    rows = (
        await db.execute(q.offset((page - 1) * page_size).limit(page_size).order_by(User.created_at.desc()))
    ).scalars().all()

    return UserListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[UserOut.model_validate(u) for u in rows],
    )


async def get_user_or_404(db: AsyncSession, user_id: int) -> User:
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def update_user(db: AsyncSession, user_id: int, data: UserUpdate) -> UserOut:
    user = await get_user_or_404(db, user_id)

    if data.email is not None and data.email != user.email:
        await _check_email_unique(db, data.email, exclude_id=user_id)
        user.email = data.email
    if data.first_name is not None:
        user.first_name = data.first_name
    if data.last_name is not None:
        user.last_name = data.last_name
    if data.role_id is not None:
        await _get_role_or_404(db, data.role_id)
        user.role_id = data.role_id
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.password is not None:
        user.hashed_password = hash_password(data.password)

    await db.flush()
    await db.refresh(user, ["role"])
    return UserOut.model_validate(user)


async def soft_delete_user(db: AsyncSession, user_id: int) -> None:
    user = await get_user_or_404(db, user_id)
    user.is_active = False
    await db.flush()


async def get_recent_users(db: AsyncSession, limit: int = 10) -> list[UserOut]:
    result = await db.execute(
        select(User)
        .options(selectinload(User.role))
        .order_by(User.created_at.desc())
        .limit(limit)
    )
    return [UserOut.model_validate(u) for u in result.scalars().all()]

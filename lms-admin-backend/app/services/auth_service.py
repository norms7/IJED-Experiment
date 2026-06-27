from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.models.models import User, Role
from app.schemas.schemas import LoginRequest, TokenResponse
from app.core.security import verify_password, create_access_token


async def login(db: AsyncSession, data: LoginRequest) -> TokenResponse:
    """
    Authenticate a user by email + password and return a JWT.

    Uses outerjoin instead of inner join so that a broken/missing role FK
    never silently drops the user row and produces a confusing 401.
    Instead, a missing role is caught explicitly with a clear 500 error.
    """
    result = await db.execute(
        select(User)
        .options(selectinload(User.role))
        .outerjoin(Role)                          # ← was .join() — inner join dropped
        .where(User.email == data.email, User.is_active == True)  # the row when role FK was broken
    )
    user: User | None = result.scalar_one_or_none()

    # Generic "wrong credentials" — never reveal whether email exists
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Catch orphaned role FK (role deleted after user was created)
    if user.role is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account configuration error: role not found. Contact an administrator.",
        )

    token = create_access_token(
        subject=user.id,
        extra={"role": user.role.name, "email": user.email},
    )
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        role=user.role.name,
        full_name=f"{user.first_name} {user.last_name}",
    )
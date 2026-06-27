from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.security import get_current_admin
from app.schemas.schemas import (
    UserCreate, UserUpdate, UserOut, UserListResponse, MessageResponse
)
from app.services import user_service

router = APIRouter(prefix="/admin/users", tags=["User Management"])


@router.post(
    "",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create User",
)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Create a new user (admin / teacher / student).
    - Email must be unique across all users.
    - Password is bcrypt-hashed before storage.
    - `role_id` must reference a valid role in the `roles` table.
    """
    return await user_service.create_user(db, data)


@router.get("", response_model=UserListResponse, summary="List Users")
async def list_users(
    role: Optional[str] = Query(None, description="Filter by role name: admin | teacher | student"),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None, description="Search by name or email"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Paginated list of users with optional role/active/search filters."""
    return await user_service.list_users(db, role, is_active, search, page, page_size)


@router.get("/recent", response_model=list[UserOut], summary="Recent Registrations")
async def recent_users(
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Returns the most recently registered users (default 10)."""
    return await user_service.get_recent_users(db, limit)


@router.get("/{user_id}", response_model=UserOut, summary="Get User")
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    user = await user_service.get_user_or_404(db, user_id)
    return UserOut.model_validate(user)


@router.put("/{user_id}", response_model=UserOut, summary="Update User")
async def update_user(
    user_id: int,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Partial update — only provided fields are changed.
    If `password` is supplied it will be rehashed.
    """
    return await user_service.update_user(db, user_id, data)


@router.delete(
    "/{user_id}",
    response_model=MessageResponse,
    summary="Soft-Delete User",
)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Sets `is_active = false`. The record is retained for audit purposes.
    Hard-delete is intentionally not exposed via API.
    """
    await user_service.soft_delete_user(db, user_id)
    return MessageResponse(message="User deactivated successfully", id=user_id)

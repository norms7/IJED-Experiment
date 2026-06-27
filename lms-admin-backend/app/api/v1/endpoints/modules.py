from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.security import get_current_admin
from app.schemas.schemas import (
    ModuleCreate, ModuleUpdate, ModuleOut,
    ActivityCreate, ActivityUpdate, ActivityOut,
    MessageResponse,
)
from app.services import module_service

# ── Modules ───────────────────────────────────────────────────────────────────

modules_router = APIRouter(prefix="/admin/modules", tags=["Modules"])


@modules_router.post(
    "",
    response_model=ModuleOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create Module",
)
async def create_module(
    data: ModuleCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Creates a new learning module. Optionally link to a class and/or subject."""
    return await module_service.create_module(db, data)


@modules_router.get("", response_model=list[ModuleOut], summary="List Modules")
async def list_modules(
    class_id: Optional[int] = Query(None),
    subject_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """List all modules, optionally filtered by class or subject."""
    return await module_service.list_modules(db, class_id, subject_id)


@modules_router.get("/{module_id}", response_model=ModuleOut, summary="Get Module")
async def get_module(
    module_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    return await module_service.get_module(db, module_id)


@modules_router.put("/{module_id}", response_model=ModuleOut, summary="Update Module")
async def update_module(
    module_id: int,
    data: ModuleUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    return await module_service.update_module(db, module_id, data)


@modules_router.delete(
    "/{module_id}",
    response_model=MessageResponse,
    summary="Delete Module",
)
async def delete_module(
    module_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Cascade-deletes all activities linked to this module."""
    await module_service.delete_module(db, module_id)
    return MessageResponse(message="Module deleted successfully", id=module_id)


# ── Activities ────────────────────────────────────────────────────────────────

activities_router = APIRouter(prefix="/admin/activities", tags=["Activities"])


@activities_router.post(
    "",
    response_model=ActivityOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create Activity",
)
async def create_activity(
    data: ActivityCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Creates an activity inside a module.
    `activity_type` must be one of: assignment | quiz | reading | project
    """
    return await module_service.create_activity(db, data)


@activities_router.get(
    "",
    response_model=list[ActivityOut],
    summary="List Activities by Module",
)
async def list_activities(
    module_id: int = Query(..., description="Module ID to list activities for"),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    return await module_service.list_activities(db, module_id)


@activities_router.get(
    "/{activity_id}",
    response_model=ActivityOut,
    summary="Get Activity",
)
async def get_activity(
    activity_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    return ActivityOut.model_validate(
        await module_service.get_activity_or_404(db, activity_id)
    )


@activities_router.put(
    "/{activity_id}",
    response_model=ActivityOut,
    summary="Update Activity",
)
async def update_activity(
    activity_id: int,
    data: ActivityUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    return await module_service.update_activity(db, activity_id, data)


@activities_router.delete(
    "/{activity_id}",
    response_model=MessageResponse,
    summary="Delete Activity",
)
async def delete_activity(
    activity_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    await module_service.delete_activity(db, activity_id)
    return MessageResponse(message="Activity deleted successfully", id=activity_id)

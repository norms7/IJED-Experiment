from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models.models import Module, Activity
from app.schemas.schemas import (
    ModuleCreate, ModuleUpdate, ModuleOut,
    ActivityCreate, ActivityUpdate, ActivityOut,
)


# ── Module ────────────────────────────────────────────────────────────────────

async def _to_module_out(module: Module) -> ModuleOut:
    data = ModuleOut.model_validate(module)
    data.activity_count = len(module.activities)
    return data


async def create_module(db: AsyncSession, data: ModuleCreate) -> ModuleOut:
    module = Module(**data.model_dump())
    db.add(module)
    await db.flush()
    await db.refresh(module, ["activities"])
    return await _to_module_out(module)


async def list_modules(
    db: AsyncSession,
    class_id: int | None = None,
    subject_id: int | None = None,
) -> list[ModuleOut]:
    q = select(Module).options(selectinload(Module.activities))
    if class_id:
        q = q.where(Module.class_id == class_id)
    if subject_id:
        q = q.where(Module.subject_id == subject_id)
    q = q.order_by(Module.order, Module.created_at)
    rows = (await db.execute(q)).scalars().all()
    return [await _to_module_out(m) for m in rows]


async def get_module_or_404(db: AsyncSession, module_id: int) -> Module:
    result = await db.execute(
        select(Module).options(selectinload(Module.activities)).where(Module.id == module_id)
    )
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Module not found")
    return m


async def get_module(db: AsyncSession, module_id: int) -> ModuleOut:
    return await _to_module_out(await get_module_or_404(db, module_id))


async def update_module(db: AsyncSession, module_id: int, data: ModuleUpdate) -> ModuleOut:
    module = await get_module_or_404(db, module_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(module, field, value)
    await db.flush()
    await db.refresh(module, ["activities"])
    return await _to_module_out(module)


async def delete_module(db: AsyncSession, module_id: int) -> None:
    module = await get_module_or_404(db, module_id)
    await db.delete(module)
    await db.flush()


# ── Activity ──────────────────────────────────────────────────────────────────

async def create_activity(db: AsyncSession, data: ActivityCreate) -> ActivityOut:
    # Verify module exists
    await get_module_or_404(db, data.module_id)
    activity = Activity(**data.model_dump())
    db.add(activity)
    await db.flush()
    return ActivityOut.model_validate(activity)


async def list_activities(db: AsyncSession, module_id: int) -> list[ActivityOut]:
    result = await db.execute(
        select(Activity)
        .where(Activity.module_id == module_id)
        .order_by(Activity.created_at)
    )
    return [ActivityOut.model_validate(a) for a in result.scalars().all()]


async def get_activity_or_404(db: AsyncSession, activity_id: int) -> Activity:
    a = await db.get(Activity, activity_id)
    if not a:
        raise HTTPException(status_code=404, detail="Activity not found")
    return a


async def update_activity(
    db: AsyncSession, activity_id: int, data: ActivityUpdate
) -> ActivityOut:
    activity = await get_activity_or_404(db, activity_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(activity, field, value)
    await db.flush()
    return ActivityOut.model_validate(activity)


async def delete_activity(db: AsyncSession, activity_id: int) -> None:
    activity = await get_activity_or_404(db, activity_id)
    await db.delete(activity)
    await db.flush()

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.models import User, Role, Module, Activity
from app.schemas.schemas import DashboardStats
from app.services.user_service import get_recent_users


async def get_dashboard_stats(db: AsyncSession) -> DashboardStats:
    from app.models.models import Class

    # ── PERF FIX: run all independent queries in parallel via asyncio.gather ──
    #
    # Before: role_counts → wait → classes → wait → modules → wait → activities → wait → recent
    # After:  role_counts + classes + modules + activities + recent all fire together,
    #         total wait = max(slowest) instead of sum(all)
    # ─────────────────────────────────────────────────────────────────────────

    role_counts_q = (
        select(Role.name, func.count(User.id).label("cnt"))
        .join(User, User.role_id == Role.id)
        .where(User.is_active == True)
        .group_by(Role.name)
    )

    classes_q   = select(func.count()).select_from(Class).where(Class.is_active == True)
    modules_q   = select(func.count()).select_from(Module)
    activities_q = select(func.count()).select_from(Activity)

    # Fire all five queries concurrently
    (
        role_rows_result,
        classes_result,
        modules_result,
        activities_result,
        recent,
    ) = await asyncio.gather(
        db.execute(role_counts_q),
        db.execute(classes_q),
        db.execute(modules_q),
        db.execute(activities_q),
        get_recent_users(db, limit=5),
    )

    # Unpack results
    counts_by_role   = {row.name: row.cnt for row in role_rows_result.all()}
    total_users      = sum(counts_by_role.values())
    total_admins     = counts_by_role.get("admin", 0)
    total_teachers   = counts_by_role.get("teacher", 0)
    total_students   = counts_by_role.get("student", 0)
    total_classes    = classes_result.scalar_one()
    total_modules    = modules_result.scalar_one()
    total_activities = activities_result.scalar_one()

    return DashboardStats(
        total_users=total_users,
        total_admins=total_admins,
        total_teachers=total_teachers,
        total_students=total_students,
        total_classes=total_classes,
        total_modules=total_modules,
        total_activities=total_activities,
        recent_users=recent,
    )

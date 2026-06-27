from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.security import get_current_admin
from app.schemas.schemas import DashboardStats
from app.services import dashboard_service

router = APIRouter(prefix="/admin/dashboard", tags=["Dashboard"])


@router.get("/stats", response_model=DashboardStats, summary="Dashboard Summary")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Returns aggregate counts for the admin dashboard:
    total users, teachers, students, classes, modules, activities,
    and the 5 most recently registered users.
    """
    return await dashboard_service.get_dashboard_stats(db)

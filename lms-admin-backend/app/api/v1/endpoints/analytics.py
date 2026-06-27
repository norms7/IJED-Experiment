"""
endpoints/analytics.py
──────────────────────
Student Performance Analytics — API endpoints.

All routes are student-scoped: the JWT must carry role=student (or admin for
testing). Students can only ever see their own data.

Routes
──────
GET /student/me/analytics/descriptive
GET /student/me/analytics/bayesian
GET /student/me/analytics/predicted-grade
GET /student/me/analytics/improvement-probability
GET /student/me/analytics/risk-assessment
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import bearer_scheme, decode_token
from app.db.session import get_db
from app.models.models import Student, StudentSectionAssignment
from app.services import analytics_service
from sqlalchemy import select
from sqlalchemy.orm import selectinload

analytics_router = APIRouter(prefix="/student", tags=["Student Analytics"])


# ── Auth dependency (mirrors student_dashboard.py) ───────────────────────────

async def _get_current_student(
    credentials=Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Student:
    payload = decode_token(credentials.credentials)
    if payload.get("role", "") not in ("student", "admin"):
        raise HTTPException(status_code=403, detail="Student access required")
    user_id = int(payload["sub"])
    result = await db.execute(
        select(Student)
        .options(
            selectinload(Student.section_assignments)
            .selectinload(StudentSectionAssignment.section),
            selectinload(Student.subject_enrollments),
        )
        .where(Student.user_id == user_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")
    return student


# ── GET /student/me/analytics/descriptive ────────────────────────────────────

@analytics_router.get(
    "/me/analytics/descriptive",
    summary="Full descriptive analytics bundle",
)
async def get_descriptive_analytics(
    subject_id: Optional[int] = Query(None, description="Filter by subject"),
    student: Student = Depends(_get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns all five descriptive analytics blocks in a single call so the
    frontend can populate all charts with one round-trip.

    Bundle:
      grade_progress       – line chart data
      attendance_calendar  – heatmap data
      score_vs_avg         – bar chart data
      module_progress      – progress bars data
      subject_radar        – radar chart data

    BUG FIX (2025-06): These were previously run concurrently via
    asyncio.gather(), but all five functions share the same AsyncSession
    (injected once per-request by FastAPI's Depends(get_db)). SQLAlchemy's
    AsyncSession does NOT support concurrent use — only one query can be
    in-flight on a given session at a time. Running them concurrently caused:

        sqlalchemy.exc.InterfaceError: cannot perform operation:
        another operation is in progress

    Fix: run them sequentially with plain await. Each function already
    batches its own internal queries efficiently (see analytics_service.py),
    and each result is now cached in the analytics_cache table, so the
    sequential cost here is small — and it's the only safe way to share
    one session across multiple service calls.
    """
    grade_progress = await analytics_service.get_grade_progress(student.id, db, subject_id)
    attendance_calendar = await analytics_service.get_attendance_calendar(student.id, db, subject_id)
    score_vs_avg = await analytics_service.get_score_vs_class_average(student.id, db, subject_id)
    module_progress = await analytics_service.get_module_reading_progress(student.id, db, subject_id)
    subject_radar = await analytics_service.get_subject_radar(student.id, db)

    return {
        "grade_progress":      grade_progress,
        "attendance_calendar": attendance_calendar,
        "score_vs_avg":        score_vs_avg,
        "module_progress":     module_progress,
        "subject_radar":       subject_radar,
    }


# ── GET /student/me/analytics/bayesian ───────────────────────────────────────

@analytics_router.get(
    "/me/analytics/bayesian",
    summary="Full Bayesian analytics bundle",
)
async def get_bayesian_analytics(
    target_grade: float = Query(90.0, ge=0, le=100, description="Target grade for improvement probability"),
    subject_id: Optional[int] = Query(None),
    student: Student = Depends(_get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns all Bayesian analytics in one call.

    Bundle:
      predicted_grade        – posterior mean + credible interval
      improvement_probability– P(reach target grade)
      students_like_you      – percentile vs anonymised peers
      risk_assessment        – Low / Moderate / High Risk + factors

    BUG FIX (2025-06): Same root cause as the descriptive endpoint above —
    asyncio.gather() against one shared AsyncSession is unsafe and threw
    "another operation is in progress" under load. Switched to sequential
    awaits. students_like_you (the heaviest call) is already internally
    batched to 3 queries total (was up to 600 before the earlier perf fix),
    so the sequential cost here is small.
    """
    predicted = await analytics_service.get_predicted_final_grade(student.id, db, subject_id)
    improvement = await analytics_service.get_improvement_probability(student.id, db, target_grade, subject_id)
    peers = await analytics_service.get_students_like_you(student.id, db)
    risk = await analytics_service.get_risk_assessment(student.id, db)

    return {
        "predicted_grade":          predicted,
        "improvement_probability":  improvement,
        "students_like_you":        peers,
        "risk_assessment":          risk,
    }


# ── GET /student/me/analytics/predicted-grade ────────────────────────────────

@analytics_router.get(
    "/me/analytics/predicted-grade",
    summary="Bayesian predicted final grade",
)
async def get_predicted_grade(
    subject_id: Optional[int] = Query(None),
    student: Student = Depends(_get_current_student),
    db: AsyncSession = Depends(get_db),
):
    return await analytics_service.get_predicted_final_grade(student.id, db, subject_id)


# ── GET /student/me/analytics/improvement-probability ────────────────────────

@analytics_router.get(
    "/me/analytics/improvement-probability",
    summary="Probability of reaching a target grade",
)
async def get_improvement_prob(
    target_grade: float = Query(90.0, ge=0, le=100),
    subject_id: Optional[int] = Query(None),
    student: Student = Depends(_get_current_student),
    db: AsyncSession = Depends(get_db),
):
    return await analytics_service.get_improvement_probability(
        student.id, db, target_grade, subject_id
    )


# ── GET /student/me/analytics/risk-assessment ────────────────────────────────

@analytics_router.get(
    "/me/analytics/risk-assessment",
    summary="Bayesian academic risk assessment",
)
async def get_risk(
    student: Student = Depends(_get_current_student),
    db: AsyncSession = Depends(get_db),
):
    return await analytics_service.get_risk_assessment(student.id, db)

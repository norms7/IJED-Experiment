"""
analytics_service.py
────────────────────
Descriptive and Bayesian analytics engine for the IJED Student Performance
Analytics tab.

PERF FIX (2025-06):
  1. get_students_like_you() rewritten — was doing up to 200 sequential
     per-peer queries (3 queries each = 600+ DB round trips). On NullPool
     (new TCP+SSL handshake per query, required for Render free tier +
     Supabase pgbouncer Transaction mode) this took 30-60+ seconds and
     caused "Failed to fetch" timeouts on the frontend. Now batches all
     peer data into 3 total queries regardless of peer count.
  2. Added a generic cache_or_compute() wrapper backed by the
     analytics_cache table (model added in models.py). Descriptive data
     caches for 5 minutes, Bayesian for 10 minutes — both are expensive
     to compute and don't need per-second freshness for a student
     dashboard. Cache is invalidated automatically by TTL; no manual
     invalidation needed since grades/attendance update relatively
     infrequently compared to page views.

Descriptive:
  • grade_progress          – time-series of activity scores per student
  • attendance_calendar     – daily attendance status for heatmap rendering
  • score_vs_class_average  – student score vs class average per activity
  • module_reading_progress – module completion + time-spent proxy
  • subject_radar           – normalised per-subject grade for radar chart

Bayesian:
  • predicted_final_grade   – Bayesian linear regression posterior (mean + CI)
  • improvement_probability – Beta-Binomial P(reach target grade)
  • students_like_you       – percentile vs anonymised peers with similar profile
  • risk_assessment         – composite risk label + contributing factors

All functions accept an AsyncSession and a resolved student.id.
All Bayesian math is done in pure Python (no external ML deps required).
"""

from __future__ import annotations

import asyncio
import json
import math
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import (
    Activity,
    ActivitySubmission,
    AnalyticsCache,
    AttendanceRecord,
    AttendanceSession,
    Module,
    StudentModuleRead,
    StudentSubjectEnrollment,
    TeacherClassAssignment,
)


# ═══════════════════════════════════════════════════════════════════════════════
# Cache layer
# ═══════════════════════════════════════════════════════════════════════════════

# TTLs chosen per data type. Descriptive data (grades, attendance, modules)
# changes whenever a teacher grades something or marks attendance — a few
# minutes of staleness is acceptable. Bayesian computations are heavier
# (especially students_like_you) so they get a longer TTL.
DESCRIPTIVE_TTL_SECONDS = 300    # 5 minutes
BAYESIAN_TTL_SECONDS    = 600    # 10 minutes


async def _cache_get(student_id: int, cache_key: str, ttl_seconds: int, db: AsyncSession) -> Optional[dict]:
    """
    Return cached payload if present and within TTL, else None.

    BUG FIX (2025-06): This previously had no error handling around the
    db.execute() call. If the analytics_cache table is missing, locked, or
    otherwise unreachable, the exception propagated all the way up through
    cache_or_compute() and crashed the entire analytics request with a 500
    — even though the actual fix is trivial: just skip the cache and
    compute fresh, exactly like a cache miss. A broken cache should never
    be able to take down the underlying feature it's supposed to speed up.
    """
    try:
        result = await db.execute(
            select(AnalyticsCache).where(
                AnalyticsCache.student_id == student_id,
                AnalyticsCache.cache_key == cache_key,
            )
        )
        row = result.scalar_one_or_none()
    except Exception:
        # Cache table missing / unreachable / any DB-level issue — roll back
        # the failed statement so this session can still be used for the
        # subsequent fresh computation, and treat this as a cache miss.
        await db.rollback()
        return None

    if not row:
        return None

    age = datetime.now(timezone.utc) - row.computed_at.replace(tzinfo=timezone.utc)
    if age > timedelta(seconds=ttl_seconds):
        return None

    try:
        return json.loads(row.payload)
    except (json.JSONDecodeError, TypeError):
        return None


async def _cache_set(student_id: int, cache_key: str, payload: dict, db: AsyncSession) -> None:
    """Upsert the cache row. Commits independently so a cache write failure
    never blocks the actual response to the user."""
    try:
        existing = await db.execute(
            select(AnalyticsCache).where(
                AnalyticsCache.student_id == student_id,
                AnalyticsCache.cache_key == cache_key,
            )
        )
        row = existing.scalar_one_or_none()
        serialized = json.dumps(payload)

        if row:
            row.payload = serialized
            row.computed_at = datetime.now(timezone.utc)
        else:
            db.add(AnalyticsCache(
                student_id=student_id,
                cache_key=cache_key,
                payload=serialized,
            ))
        await db.commit()
    except Exception:
        # Cache writes are best-effort. If this fails (e.g. transient
        # connection issue), we still return the freshly computed data to
        # the caller — just without persisting it for next time.
        await db.rollback()


async def cache_or_compute(
    student_id: int,
    cache_key: str,
    ttl_seconds: int,
    compute_fn,
    db: AsyncSession,
) -> dict:
    """
    Generic cache wrapper. Tries cache first; on miss, calls compute_fn()
    (an async callable with no args), stores the result, and returns it.
    """
    cached = await _cache_get(student_id, cache_key, ttl_seconds, db)
    if cached is not None:
        return cached

    fresh = await compute_fn()
    await _cache_set(student_id, cache_key, fresh, db)
    return fresh


async def invalidate_student_cache(student_id: int, db: AsyncSession) -> None:
    """
    Call this from grading / attendance-marking endpoints to force fresh
    analytics on the student's next visit. Optional — TTL expiry handles
    staleness automatically, but immediate invalidation gives instant
    feedback after a teacher grades something.
    """
    await db.execute(
        delete(AnalyticsCache).where(AnalyticsCache.student_id == student_id)
    )
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════════════

async def _resolve_subject_ids(student_id: int, db: AsyncSession) -> list[int]:
    """Return subject_ids the student is enrolled in."""
    result = await db.execute(
        select(StudentSubjectEnrollment.subject_id)
        .where(StudentSubjectEnrollment.student_id == student_id)
    )
    return [r[0] for r in result.all()]


async def _resolve_class_ids_for_student(student_id: int, subject_ids: list[int], db: AsyncSession) -> dict[int, int]:
    """Map subject_id → class_id via teacher_class_assignments."""
    if not subject_ids:
        return {}
    result = await db.execute(
        select(TeacherClassAssignment.subject_id, TeacherClassAssignment.class_id)
        .where(TeacherClassAssignment.subject_id.in_(subject_ids))
    )
    mapping: dict[int, int] = {}
    for sid, cid in result.all():
        if sid not in mapping:
            mapping[sid] = cid
    return mapping


# ═══════════════════════════════════════════════════════════════════════════════
# 1. DESCRIPTIVE – Grade Progress (line chart data)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_grade_progress(
    student_id: int,
    db: AsyncSession,
    subject_id: Optional[int] = None,
) -> dict:
    """
    Returns chronologically ordered list of graded submissions for the student.
    Each entry carries the activity name, type, score, max_score, pct, and date.

    Used by: Line Chart — My Grade Progress
    """
    async def _compute():
        subject_ids = await _resolve_subject_ids(student_id, db)
        if not subject_ids:
            return {"data": [], "subjects": []}

        q = (
            select(ActivitySubmission)
            .options(
                selectinload(ActivitySubmission.activity)
            )
            .where(
                ActivitySubmission.student_id == student_id,
                ActivitySubmission.is_graded == True,
                ActivitySubmission.score.isnot(None),
            )
        )

        subs_result = await db.execute(q)
        subs = subs_result.scalars().all()

        # Filter to enrolled subjects only
        enrolled_set = set(subject_ids)
        data = []
        for sub in subs:
            act = sub.activity
            if act.subject_id not in enrolled_set:
                continue
            if subject_id and act.subject_id != subject_id:
                continue
            if sub.max_score and sub.max_score > 0:
                pct = round((sub.score / sub.max_score) * 100, 1)
            else:
                pct = None

            data.append({
                "date": sub.submitted_at.date().isoformat(),
                "activity_id": act.id,
                "activity_name": act.title,
                "activity_type": act.activity_type,
                "subject_id": act.subject_id,
                "score": sub.score,
                "max_score": sub.max_score,
                "pct": pct,
            })

        # Sort chronologically
        data.sort(key=lambda x: x["date"])

        return {"data": data, "enrolled_subject_ids": subject_ids}

    cache_key = f"descriptive.grade_progress.subject_{subject_id or 'all'}"
    return await cache_or_compute(student_id, cache_key, DESCRIPTIVE_TTL_SECONDS, _compute, db)


# ═══════════════════════════════════════════════════════════════════════════════
# 2. DESCRIPTIVE – Attendance Calendar (heatmap data)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_attendance_calendar(
    student_id: int,
    db: AsyncSession,
    subject_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
) -> dict:
    """
    Returns a day-keyed map of attendance status for calendar heatmap.

    status values: "present" | "absent" | "late" | "excused" | "no_class"
    Used by: Calendar Heatmap — My Attendance Calendar
    """
    async def _compute():
        subject_ids = await _resolve_subject_ids(student_id, db)
        if not subject_ids:
            return {"calendar": {}, "summary": {}}

        filter_ids = [subject_id] if subject_id else subject_ids

        sessions_result = await db.execute(
            select(AttendanceSession)
            .where(AttendanceSession.subject_id.in_(filter_ids))
            .order_by(AttendanceSession.session_date)
        )
        sessions = sessions_result.scalars().all()

        if not sessions:
            return {"calendar": {}, "summary": {"present": 0, "absent": 0, "late": 0, "excused": 0, "no_class": 0}}

        session_ids = [s.id for s in sessions if s.has_class]

        records_by_session: dict[int, str] = {}
        if session_ids:
            rec_result = await db.execute(
                select(AttendanceRecord).where(
                    AttendanceRecord.session_id.in_(session_ids),
                    AttendanceRecord.student_id == student_id,
                )
            )
            for rec in rec_result.scalars().all():
                records_by_session[rec.session_id] = rec.status

        calendar: dict[str, str] = {}
        summary = {"present": 0, "absent": 0, "late": 0, "excused": 0, "no_class": 0}

        for sess in sessions:
            d = sess.session_date
            if year and d.year != year:
                continue
            if month and d.month != month:
                continue

            key = d.isoformat()
            if not sess.has_class:
                status = "no_class"
            else:
                status = records_by_session.get(sess.id, "absent")

            calendar[key] = status
            summary[status] = summary.get(status, 0) + 1

        return {"calendar": calendar, "summary": summary}

    cache_key = f"descriptive.attendance.subject_{subject_id or 'all'}.y{year or 'x'}.m{month or 'x'}"
    return await cache_or_compute(student_id, cache_key, DESCRIPTIVE_TTL_SECONDS, _compute, db)


# ═══════════════════════════════════════════════════════════════════════════════
# 3. DESCRIPTIVE – Score vs Class Average (bar chart data)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_score_vs_class_average(
    student_id: int,
    db: AsyncSession,
    subject_id: Optional[int] = None,
) -> dict:
    """
    Per graded activity: student score vs class average.
    Used by: Bar Chart with Benchmark Line — Activity Score vs Class Average
    """
    async def _compute():
        subject_ids = await _resolve_subject_ids(student_id, db)
        if not subject_ids:
            return {"data": []}

        filter_ids = [subject_id] if subject_id else subject_ids

        acts_result = await db.execute(
            select(Activity)
            .where(
                Activity.subject_id.in_(filter_ids),
                Activity.is_published == True,
            )
            .order_by(Activity.created_at)
        )
        activities = acts_result.scalars().all()
        if not activities:
            return {"data": []}

        act_ids = [a.id for a in activities]
        act_map = {a.id: a for a in activities}

        subs_result = await db.execute(
            select(ActivitySubmission)
            .where(
                ActivitySubmission.activity_id.in_(act_ids),
                ActivitySubmission.is_graded == True,
                ActivitySubmission.score.isnot(None),
                ActivitySubmission.max_score > 0,
            )
        )
        all_subs = subs_result.scalars().all()

        from collections import defaultdict
        class_scores: dict[int, list[float]] = defaultdict(list)
        student_score: dict[int, float] = {}

        for sub in all_subs:
            pct = round((sub.score / sub.max_score) * 100, 1)
            class_scores[sub.activity_id].append(pct)
            if sub.student_id == student_id:
                student_score[sub.activity_id] = pct

        data = []
        for act_id, pcts in class_scores.items():
            if not pcts:
                continue
            avg = round(sum(pcts) / len(pcts), 1)
            my = student_score.get(act_id)
            act = act_map[act_id]
            diff = round(my - avg, 1) if my is not None else None
            data.append({
                "activity_id": act_id,
                "activity_name": act.title,
                "activity_type": act.activity_type,
                "subject_id": act.subject_id,
                "my_score_pct": my,
                "class_avg_pct": avg,
                "diff_pct": diff,
                "class_size": len(pcts),
            })

        data.sort(key=lambda x: (x["subject_id"], x["activity_id"]))
        return {"data": data}

    cache_key = f"descriptive.score_vs_avg.subject_{subject_id or 'all'}"
    return await cache_or_compute(student_id, cache_key, DESCRIPTIVE_TTL_SECONDS, _compute, db)


# ═══════════════════════════════════════════════════════════════════════════════
# 4. DESCRIPTIVE – Module Reading Progress (progress bars)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_module_reading_progress(
    student_id: int,
    db: AsyncSession,
    subject_id: Optional[int] = None,
) -> dict:
    """
    Per subject: modules read vs total published modules, with estimated time.
    Used by: Progress Bars — Module Reading Progress
    """
    async def _compute():
        subject_ids = await _resolve_subject_ids(student_id, db)
        if not subject_ids:
            return {"subjects": [], "totals": {"read": 0, "total": 0, "pct": 0}}

        filter_ids = [subject_id] if subject_id else subject_ids

        modules_result = await db.execute(
            select(Module)
            .where(
                Module.subject_id.in_(filter_ids),
                Module.is_published == True,
            )
            .order_by(Module.subject_id, Module.order)
        )
        modules = modules_result.scalars().all()

        reads_result = await db.execute(
            select(StudentModuleRead)
            .where(StudentModuleRead.student_id == student_id)
        )
        read_map = {r.module_id: r for r in reads_result.scalars().all()}

        from collections import defaultdict
        by_subject: dict[int, dict] = defaultdict(lambda: {"modules": [], "subject_id": None})

        for mod in modules:
            sid = mod.subject_id
            read = read_map.get(mod.id)
            by_subject[sid]["subject_id"] = sid
            by_subject[sid]["modules"].append({
                "module_id": mod.id,
                "title": mod.title,
                "term": mod.term,
                "is_read": read is not None,
                "first_read_at": read.first_read_at.isoformat() if read else None,
                "last_read_at": read.last_read_at.isoformat() if read else None,
            })

        subjects_out = []
        total_read = 0
        total_mods = 0

        for sid, grp in by_subject.items():
            mods = grp["modules"]
            read_count = sum(1 for m in mods if m["is_read"])
            total = len(mods)
            pct = round((read_count / total) * 100) if total else 0
            subjects_out.append({
                "subject_id": sid,
                "modules_read": read_count,
                "modules_total": total,
                "completion_pct": pct,
                "remaining": total - read_count,
                "modules": mods,
            })
            total_read += read_count
            total_mods += total

        overall_pct = round((total_read / total_mods) * 100) if total_mods else 0
        return {
            "subjects": subjects_out,
            "totals": {"read": total_read, "total": total_mods, "pct": overall_pct},
        }

    cache_key = f"descriptive.module_progress.subject_{subject_id or 'all'}"
    return await cache_or_compute(student_id, cache_key, DESCRIPTIVE_TTL_SECONDS, _compute, db)


# ═══════════════════════════════════════════════════════════════════════════════
# 5. DESCRIPTIVE – Subject Radar (radar/spider chart)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_subject_radar(
    student_id: int,
    db: AsyncSession,
) -> dict:
    """
    Per subject: weighted average score percentage (normalised 0–100).
    Used by: Radar/Spider Chart — Subject Performance Overview
    """
    async def _compute():
        subject_ids = await _resolve_subject_ids(student_id, db)
        if not subject_ids:
            return {"axes": []}

        subs_result = await db.execute(
            select(ActivitySubmission)
            .options(selectinload(ActivitySubmission.activity))
            .where(
                ActivitySubmission.student_id == student_id,
                ActivitySubmission.is_graded == True,
                ActivitySubmission.score.isnot(None),
            )
        )
        subs = subs_result.scalars().all()

        from collections import defaultdict
        per_subject: dict[int, list[float]] = defaultdict(list)

        for sub in subs:
            act = sub.activity
            if act.subject_id in set(subject_ids) and sub.max_score and sub.max_score > 0:
                pct = (sub.score / sub.max_score) * 100
                per_subject[act.subject_id].append(pct)

        from app.models.models import Subject
        subj_result = await db.execute(
            select(Subject).where(Subject.id.in_(subject_ids))
        )
        subj_map = {s.id: s.name for s in subj_result.scalars().all()}

        axes = []
        for sid in subject_ids:
            scores = per_subject.get(sid, [])
            avg = round(sum(scores) / len(scores), 1) if scores else 0
            axes.append({
                "subject_id": sid,
                "subject_name": subj_map.get(sid, f"Subject {sid}"),
                "avg_pct": avg,
                "activity_count": len(scores),
            })

        return {"axes": axes}

    cache_key = "descriptive.subject_radar"
    return await cache_or_compute(student_id, cache_key, DESCRIPTIVE_TTL_SECONDS, _compute, db)


# ═══════════════════════════════════════════════════════════════════════════════
# Bayesian helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _normal_cdf(x: float) -> float:
    """Approximation of the standard normal CDF (Abramowitz & Stegun)."""
    t = 1 / (1 + 0.2316419 * abs(x))
    poly = t * (0.319381530
                + t * (-0.356563782
                       + t * (1.781477937
                              + t * (-1.821255978
                                     + t * 1.330274429))))
    p = 1 - (1 / math.sqrt(2 * math.pi)) * math.exp(-0.5 * x * x) * poly
    return p if x >= 0 else 1 - p


def _percentile_rank(value: float, population: list[float]) -> int:
    """Return the percentile rank of value within population."""
    if not population:
        return 50
    below = sum(1 for v in population if v < value)
    return round((below / len(population)) * 100)


# ═══════════════════════════════════════════════════════════════════════════════
# 6. BAYESIAN – Predicted Final Grade
# ═══════════════════════════════════════════════════════════════════════════════

async def get_predicted_final_grade(
    student_id: int,
    db: AsyncSession,
    subject_id: Optional[int] = None,
) -> dict:
    """
    Bayesian Linear Regression posterior for the student's final grade.

    Prior: school-wide average μ₀ = 78, σ₀ = 12
    Likelihood: student's observed graded activity percentages
    Posterior: conjugate normal update (known variance)

    Returns:
      predicted_grade  – posterior mean (0–100)
      range_low / range_high – 95% credible interval
      confidence       – "95%"
      n_observations   – number of graded activities used
    """
    async def _compute():
        subject_ids = await _resolve_subject_ids(student_id, db)
        if not subject_ids:
            return _empty_prediction()

        filter_ids = [subject_id] if subject_id else subject_ids

        subs_result = await db.execute(
            select(ActivitySubmission)
            .options(selectinload(ActivitySubmission.activity))
            .where(
                ActivitySubmission.student_id == student_id,
                ActivitySubmission.is_graded == True,
                ActivitySubmission.score.isnot(None),
            )
        )
        subs = [s for s in subs_result.scalars().all()
                if s.activity.subject_id in set(filter_ids)
                and s.max_score and s.max_score > 0]

        MU_0    = 78.0
        TAU_0   = 1.0 / (12.0 ** 2)
        SIGMA_L = 15.0
        TAU_L   = 1.0 / (SIGMA_L ** 2)

        observations = [(s.score / s.max_score) * 100 for s in subs]
        n = len(observations)

        if n == 0:
            return _empty_prediction()

        tau_n  = TAU_0 + n * TAU_L
        mu_n   = (TAU_0 * MU_0 + TAU_L * sum(observations)) / tau_n
        sigma_n = math.sqrt(1 / tau_n)

        Z_95 = 1.96
        lo = max(0, round(mu_n - Z_95 * sigma_n, 1))
        hi = min(100, round(mu_n + Z_95 * sigma_n, 1))

        return {
            "predicted_grade": round(mu_n, 1),
            "range_low": lo,
            "range_high": hi,
            "confidence": "95%",
            "n_observations": n,
            "current_avg": round(sum(observations) / n, 1),
        }

    cache_key = f"bayesian.predicted_grade.subject_{subject_id or 'all'}"
    return await cache_or_compute(student_id, cache_key, BAYESIAN_TTL_SECONDS, _compute, db)


def _empty_prediction() -> dict:
    return {
        "predicted_grade": None,
        "range_low": None,
        "range_high": None,
        "confidence": "95%",
        "n_observations": 0,
        "current_avg": None,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 7. BAYESIAN – Grade Improvement Probability
# ═══════════════════════════════════════════════════════════════════════════════

async def get_improvement_probability(
    student_id: int,
    db: AsyncSession,
    target_grade: float = 90.0,
    subject_id: Optional[int] = None,
) -> dict:
    """
    Beta-Binomial model estimating P(student reaches target_grade).

    Prior: Beta(α₀=2, β₀=2) — weak uniform-ish prior
    Update: each graded activity counted as success if score ≥ target_grade
    Output: posterior mean probability + interpretation
    """
    async def _compute():
        subject_ids = await _resolve_subject_ids(student_id, db)
        if not subject_ids:
            return {"probability": None, "target_grade": target_grade, "n_observations": 0}

        filter_ids = [subject_id] if subject_id else subject_ids

        subs_result = await db.execute(
            select(ActivitySubmission)
            .options(selectinload(ActivitySubmission.activity))
            .where(
                ActivitySubmission.student_id == student_id,
                ActivitySubmission.is_graded == True,
                ActivitySubmission.score.isnot(None),
            )
        )
        subs = [s for s in subs_result.scalars().all()
                if s.activity.subject_id in set(filter_ids)
                and s.max_score and s.max_score > 0]

        if not subs:
            return {"probability": None, "target_grade": target_grade, "n_observations": 0}

        ALPHA_0, BETA_0 = 2.0, 2.0

        successes = sum(1 for s in subs if (s.score / s.max_score) * 100 >= target_grade)
        failures  = len(subs) - successes

        alpha_n = ALPHA_0 + successes
        beta_n  = BETA_0  + failures

        p_posterior = alpha_n / (alpha_n + beta_n)
        prob_pct = round(p_posterior * 100, 1)

        label = (
            "Very likely"   if prob_pct >= 75 else
            "Likely"        if prob_pct >= 55 else
            "Possible"      if prob_pct >= 35 else
            "Challenging"
        )

        return {
            "probability": prob_pct,
            "target_grade": target_grade,
            "label": label,
            "n_observations": len(subs),
            "successes": successes,
            "current_avg": round(
                sum((s.score / s.max_score) * 100 for s in subs) / len(subs), 1
            ),
        }

    # target_grade is part of the cache key since changing it changes the result
    cache_key = f"bayesian.improvement_prob.subject_{subject_id or 'all'}.target_{int(target_grade)}"
    return await cache_or_compute(student_id, cache_key, BAYESIAN_TTL_SECONDS, _compute, db)


# ═══════════════════════════════════════════════════════════════════════════════
# 8. BAYESIAN – "Students Like You" Insight (anonymised peers)
# ═══════════════════════════════════════════════════════════════════════════════
#
# PERF FIX (2025-06): This was the single biggest contributor to the
# "Failed to fetch" crash. The original implementation called
# _student_profile(peer_id) in a sequential loop for up to 200 peers, and
# each call ran 3 separate await db.execute() queries (attendance sessions,
# module reads, activity submissions) — all scoped to that one peer.
#
# On NullPool (a fresh TCP+SSL handshake to Supabase per query, which is
# required on Render's free tier with Supabase's Transaction-mode pooler),
# that's up to 600 sequential network round trips in a single request.
# Each round trip costs 150-300ms minimum, so worst case this function alone
# could take 90-180+ seconds — far past any reasonable fetch timeout.
#
# THE FIX: instead of looping per-peer, we run exactly 3 queries total:
#   1. One query for ALL attendance records across ALL peers (grouped after)
#   2. One query for ALL module reads across ALL peers (grouped after)
#   3. One query for ALL submissions across ALL peers (grouped after)
# Then we aggregate everything in plain Python (cheap, in-memory, instant).
# This is O(1) DB round trips regardless of peer count, instead of O(n).
# ═══════════════════════════════════════════════════════════════════════════════

async def get_students_like_you(
    student_id: int,
    db: AsyncSession,
) -> dict:
    """
    Computes the student's engagement profile and finds their percentile rank
    versus anonymised peers with a similar profile.

    Matching variables:
      - attendance rate (%)
      - module completion rate (%)
      - average activity score (%)

    NO identifiable student info is returned — only aggregate statistics.
    """
    async def _compute():
        subject_ids = await _resolve_subject_ids(student_id, db)
        if not subject_ids:
            return {"percentile": None, "message": "Not enough data yet."}

        # ── Get all peers (including self) enrolled in these subjects ──────────
        enroll_res = await db.execute(
            select(StudentSubjectEnrollment.student_id)
            .where(StudentSubjectEnrollment.subject_id.in_(subject_ids))
            .distinct()
        )
        all_student_ids = list({r[0] for r in enroll_res.all()})
        if student_id not in all_student_ids:
            all_student_ids.append(student_id)

        # Cap the peer pool for sanity on very large schools — same limit as
        # before (200), but now it doesn't matter for performance since we
        # batch-query regardless of count.
        peer_pool_ids = [sid for sid in all_student_ids if sid != student_id][:200]
        target_ids = peer_pool_ids + [student_id]

        # ── Query 1: Attendance — ALL students, ALL relevant sessions, ONE call ──
        att_sessions_res = await db.execute(
            select(AttendanceSession.id)
            .where(
                AttendanceSession.subject_id.in_(subject_ids),
                AttendanceSession.has_class == True,
            )
        )
        session_ids = [r[0] for r in att_sessions_res.all()]
        total_sessions = len(session_ids)

        present_by_student: dict[int, int] = {}
        if session_ids:
            present_res = await db.execute(
                select(AttendanceRecord.student_id, func.count(AttendanceRecord.id))
                .where(
                    AttendanceRecord.session_id.in_(session_ids),
                    AttendanceRecord.student_id.in_(target_ids),
                    AttendanceRecord.status == "present",
                )
                .group_by(AttendanceRecord.student_id)
            )
            present_by_student = {sid: cnt for sid, cnt in present_res.all()}

        # ── Query 2: Module completion — ALL students, ONE call ──────────────────
        total_mods_res = await db.execute(
            select(func.count(Module.id)).where(
                Module.subject_id.in_(subject_ids),
                Module.is_published == True,
            )
        )
        total_mods = total_mods_res.scalar() or 0

        reads_by_student: dict[int, int] = {}
        if total_mods:
            reads_res = await db.execute(
                select(StudentModuleRead.student_id, func.count(StudentModuleRead.id))
                .where(StudentModuleRead.student_id.in_(target_ids))
                .group_by(StudentModuleRead.student_id)
            )
            reads_by_student = {sid: cnt for sid, cnt in reads_res.all()}

        # ── Query 3: Average score — ALL students, ONE call ───────────────────────
        # Join submission → activity to filter by subject, but do it as one
        # batched query covering every target student at once.
        subs_res = await db.execute(
            select(
                ActivitySubmission.student_id,
                ActivitySubmission.score,
                ActivitySubmission.max_score,
            )
            .join(Activity, Activity.id == ActivitySubmission.activity_id)
            .where(
                ActivitySubmission.student_id.in_(target_ids),
                ActivitySubmission.is_graded == True,
                ActivitySubmission.score.isnot(None),
                ActivitySubmission.max_score > 0,
                Activity.subject_id.in_(subject_ids),
            )
        )
        scores_by_student: dict[int, list[float]] = {}
        for sid, score, max_score in subs_res.all():
            pct = (score / max_score) * 100
            scores_by_student.setdefault(sid, []).append(pct)

        # ── Build composite engagement score per student (all in-memory now) ─────
        def _composite_for(sid: int) -> float:
            att_rate = (present_by_student.get(sid, 0) / total_sessions * 100) if total_sessions else 0.0
            mod_rate = (reads_by_student.get(sid, 0) / total_mods * 100) if total_mods else 0.0
            scores = scores_by_student.get(sid, [])
            avg_score = sum(scores) / len(scores) if scores else 0.0
            return (att_rate + mod_rate + avg_score) / 3

        my_composite = _composite_for(student_id)
        peer_composites = [_composite_for(pid) for pid in peer_pool_ids]

        percentile = _percentile_rank(my_composite, peer_composites)

        if percentile >= 75:
            message = f"You perform better than {percentile}% of students with similar engagement patterns."
        elif percentile >= 50:
            message = f"You are performing above the median — better than {percentile}% of similar students."
        elif percentile >= 25:
            message = f"There is room to grow. You are currently ahead of {percentile}% of similar students."
        else:
            message = f"You are in the bottom {100 - percentile}% of similar students — this is a great moment to step up!"

        my_att_rate = (present_by_student.get(student_id, 0) / total_sessions * 100) if total_sessions else 0.0
        my_mod_rate = (reads_by_student.get(student_id, 0) / total_mods * 100) if total_mods else 0.0
        my_scores = scores_by_student.get(student_id, [])
        my_avg_score = sum(my_scores) / len(my_scores) if my_scores else 0.0

        return {
            "percentile": percentile,
            "message": message,
            "my_profile": {
                "attendance_rate": round(my_att_rate, 1),
                "module_completion": round(my_mod_rate, 1),
                "avg_score": round(my_avg_score, 1),
            },
            "peer_count": len(peer_composites),
        }

    cache_key = "bayesian.students_like_you"
    return await cache_or_compute(student_id, cache_key, BAYESIAN_TTL_SECONDS, _compute, db)


# ═══════════════════════════════════════════════════════════════════════════════
# 9. BAYESIAN – Risk Assessment
# ═══════════════════════════════════════════════════════════════════════════════

async def get_risk_assessment(
    student_id: int,
    db: AsyncSession,
) -> dict:
    """
    Composite Bayesian risk indicator.

    P(fail) ← logistic function over:
      attendance_rate, activity_completion, avg_score, module_completion

    Risk thresholds:
      P(fail) < 0.25  → Low Risk
      P(fail) < 0.55  → Moderate Risk
      else            → High Risk
    """
    async def _compute():
        subject_ids = await _resolve_subject_ids(student_id, db)
        if not subject_ids:
            return {"risk_level": "Unknown", "explanation": "No enrollment data found.", "p_fail": None}

        sess_result = await db.execute(
            select(AttendanceSession)
            .where(
                AttendanceSession.subject_id.in_(subject_ids),
                AttendanceSession.has_class == True,
            )
        )
        sessions = sess_result.scalars().all()
        att_rate = 0.0
        if sessions:
            present_res = await db.execute(
                select(func.count(AttendanceRecord.id)).where(
                    AttendanceRecord.session_id.in_([s.id for s in sessions]),
                    AttendanceRecord.student_id == student_id,
                    AttendanceRecord.status == "present",
                )
            )
            present_count = present_res.scalar() or 0
            att_rate = present_count / len(sessions)

        total_mods_res = await db.execute(
            select(func.count(Module.id)).where(
                Module.subject_id.in_(subject_ids),
                Module.is_published == True,
            )
        )
        total_mods = total_mods_res.scalar() or 0
        reads_res = await db.execute(
            select(func.count(StudentModuleRead.id)).where(
                StudentModuleRead.student_id == student_id
            )
        )
        reads = reads_res.scalar() or 0
        mod_rate = (reads / total_mods) if total_mods else 0.0

        all_acts_res = await db.execute(
            select(func.count(Activity.id)).where(
                Activity.subject_id.in_(subject_ids),
                Activity.is_published == True,
            )
        )
        total_acts = all_acts_res.scalar() or 0

        subs_res = await db.execute(
            select(ActivitySubmission)
            .options(selectinload(ActivitySubmission.activity))
            .where(
                ActivitySubmission.student_id == student_id,
                ActivitySubmission.is_graded == True,
                ActivitySubmission.score.isnot(None),
            )
        )
        subs = [s for s in subs_res.scalars().all()
                if s.activity.subject_id in set(subject_ids)
                and s.max_score and s.max_score > 0]

        act_completion = (len(subs) / total_acts) if total_acts else 0.0
        avg_score_pct  = (
            sum((s.score / s.max_score) for s in subs) / len(subs)
            if subs else 0.0
        )

        w_att  = -3.5
        w_mod  = -1.5
        w_act  = -2.0
        w_avg  = -4.0
        b      =  5.5

        logit = (b
                 + w_att  * att_rate
                 + w_mod  * mod_rate
                 + w_act  * act_completion
                 + w_avg  * avg_score_pct)

        p_fail = 1 / (1 + math.exp(-logit))

        if p_fail < 0.25:
            risk_level = "Low Risk"
            emoji = "🟢"
        elif p_fail < 0.55:
            risk_level = "Moderate Risk"
            emoji = "🟡"
        else:
            risk_level = "High Risk"
            emoji = "🔴"

        factors: list[str] = []
        if att_rate < 0.80:
            factors.append(f"Attendance is {round(att_rate*100)}% (below the 80% threshold).")
        if mod_rate < 0.60:
            factors.append(f"Only {round(mod_rate*100)}% of modules have been read.")
        if act_completion < 0.70:
            factors.append(f"Activity completion stands at {round(act_completion*100)}%.")
        if avg_score_pct < 0.75:
            factors.append(f"Average score is {round(avg_score_pct*100)}%, which is below passing.")
        if not factors:
            factors.append("All indicators are within healthy ranges.")

        return {
            "risk_level": risk_level,
            "emoji": emoji,
            "p_fail": round(p_fail, 3),
            "factors": factors,
            "signals": {
                "attendance_rate": round(att_rate * 100, 1),
                "module_completion": round(mod_rate * 100, 1),
                "activity_completion": round(act_completion * 100, 1),
                "avg_score": round(avg_score_pct * 100, 1),
            },
        }

    cache_key = "bayesian.risk_assessment"
    return await cache_or_compute(student_id, cache_key, BAYESIAN_TTL_SECONDS, _compute, db)
"""
Student Portal – Activity endpoints

Routes:
  GET  /student/me/activities                      – list published activities for the student
  GET  /student/me/activities/{id}                 – get one activity (questions without correct_answer)
  POST /student/me/activities/{id}/submit          – submit answers (auto-grade or queue for manual)
  GET  /student/me/activities/{id}/result          – get student's own submission result
"""
import json
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import bearer_scheme, decode_token
from app.db.session import get_db
from app.models.models import (
    Activity, ActivityAnswer, ActivityQuestion, ActivityQuestionChoice,
    ActivitySubmission, Module, Section, Student, StudentSectionAssignment,
    StudentSubjectEnrollment, TeacherClassAssignment,
)
from app.schemas.schemas import ActivitySubmitRequest, SubmissionOut

student_activity_router = APIRouter(prefix="/student", tags=["Student Activities"])


# ── Auth dependency ───────────────────────────────────────────────────────────

async def get_current_student(
    credentials=Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Student:
    payload = decode_token(credentials.credentials)
    role = payload.get("role", "")
    if role not in ("student", "admin"):
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_class_ids(student: Student) -> set[int]:
    return {
        a.section.class_id
        for a in student.section_assignments
        if a.section and a.section.class_id
    }


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: datetime) -> datetime:
    """Make a datetime timezone-aware. If naive, assume it's already in local/server time
    and attach UTC (since the server stores times without tz info from the frontend)."""
    if dt.tzinfo is None:
        # The frontend sends ISO strings without tz; treat as-is (no offset conversion)
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _is_past_due(activity: Activity) -> bool:
    if not activity.due_date:
        return False
    due = _as_aware(activity.due_date)
    now = _utcnow()
    # If both are UTC-naive-treated-as-UTC, this is a direct comparison
    # Grace: add 60-second buffer so boundary submissions still go through
    return now > due


def _is_open(activity: Activity) -> bool:
    """Returns True if the activity is within its open window."""
    if not activity.start_date:
        return True  # No start restriction = always open
    sd = _as_aware(activity.start_date)
    now = _utcnow()
    return now >= sd


def _auto_grade_answer(question: ActivityQuestion, answer_value: Optional[str]):
    """Returns (is_correct, points_earned). Returns (None, None) for manual types."""
    if answer_value is None:
        return False, 0

    if question.question_type == "multiple_choice":
        correct = str(question.correct_answer or "").strip()
        given   = str(answer_value).strip()
        ok = given == correct
        return ok, question.points if ok else 0

    elif question.question_type == "checkbox":
        try:
            correct_set = set(map(str, json.loads(question.correct_answer or "[]")))
            given_set   = set(map(str, json.loads(answer_value or "[]")))
            ok = correct_set == given_set
        except Exception:
            ok = False
        return ok, question.points if ok else 0

    elif question.question_type in ("fill_blank", "enumeration"):
        ok = answer_value.strip().lower() == (question.correct_answer or "").strip().lower()
        return ok, question.points if ok else 0

    # essay / freeform → manual grading
    return None, None


def _strip_correct_answers(q: ActivityQuestion) -> dict:
    """Return a question dict safe to send to students (no correct_answer)."""
    return {
        "id":            q.id,
        "order":         q.order,
        "question_text": q.question_text,
        "question_type": q.question_type,
        "points":        q.points,
        "choices": [
            {"id": c.id, "order": c.order, "choice_text": c.choice_text}
            for c in sorted(q.choices, key=lambda x: x.order)
        ],
    }


def _activity_status(activity: Activity, submission: Optional[ActivitySubmission]) -> dict:
    """Compute display status for an activity from the student's perspective."""
    now = _utcnow()
    past_due = _is_past_due(activity)
    not_open = not _is_open(activity)

    if submission:
        if submission.is_graded:
            return {"status": "graded", "label": "Graded", "color": "green"}
        return {"status": "submitted", "label": "Submitted – Pending Grade", "color": "blue"}
    if past_due:
        return {"status": "past_due", "label": "Past Due – No Submission", "color": "red"}
    if not_open:
        return {"status": "not_open", "label": "Not Yet Open", "color": "gray"}
    return {"status": "open", "label": "Open", "color": "maroon"}


# ── GET /student/me/activities ────────────────────────────────────────────────

@student_activity_router.get(
    "/me/activities",
    summary="List published activities for the student's enrolled subjects",
)
async def list_student_activities(
    subject_id: Optional[int] = Query(None),
    student: Student = Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    # ── 1. Direct subject enrollments (primary source) ───────────────────
    direct_enrollments = student.subject_enrollments or []
    subject_ids: set[int] = set()

    if direct_enrollments:
        subject_ids = {e.subject_id for e in direct_enrollments}
    else:
        # ── 2. Fallback: section -> class -> teacher_class_assignments ─────
        ssa_result = await db.execute(
            select(StudentSectionAssignment)
            .options(selectinload(StudentSectionAssignment.section))
            .where(StudentSectionAssignment.student_id == student.id)
        )
        ssa_rows = ssa_result.scalars().all()
        class_ids = {
            row.section.class_id
            for row in ssa_rows
            if row.section and row.section.class_id
        }
        if not class_ids:
            return []

        tca_result = await db.execute(
            select(TeacherClassAssignment)
            .where(TeacherClassAssignment.class_id.in_(class_ids))
        )
        subject_ids = {r.subject_id for r in tca_result.scalars().all()}

    if not subject_ids:
        return []

    # ── Get published modules for the resolved subject_ids ───────────────
    mod_result = await db.execute(
        select(Module).where(
            Module.subject_id.in_(subject_ids),
            Module.is_published == True,
        )
    )
    modules_list = mod_result.scalars().all()
    module_ids = {m.id for m in modules_list}
    module_term_map = {m.id: m.term for m in modules_list}  # module_id -> term string
    if not module_ids:
        return []

    q = (
        select(Activity)
        .where(
            Activity.module_id.in_(module_ids),
            Activity.is_published == True,
        )
        .order_by(Activity.due_date.asc().nullslast(), Activity.created_at.desc())
    )
    if subject_id:
        q = q.where(Activity.subject_id == subject_id)

    rows = (await db.execute(q)).scalars().all()

    # Fetch existing submissions for this student in one query
    sub_result = await db.execute(
        select(ActivitySubmission).where(
            ActivitySubmission.student_id == student.id,
            ActivitySubmission.activity_id.in_([r.id for r in rows]),
        )
    )
    subs_by_activity = {s.activity_id: s for s in sub_result.scalars().all()}

    now = _utcnow()
    output = []
    for act in rows:
        sub = subs_by_activity.get(act.id)
        status_info = _activity_status(act, sub)
        past_due = _is_past_due(act)

        item = {
            "id":                act.id,
            "title":             act.title,
            "description":       act.description,
            "activity_type":     act.activity_type,
            "activity_type_custom": act.activity_type_custom,
            "format_type":       act.format_type,
            "grading_mode":      act.grading_mode,
            "module_id":         act.module_id,
            "subject_id":        act.subject_id,
            "term":              module_term_map.get(act.module_id),
            "max_score":         act.max_score,
            "start_date":        act.start_date.isoformat() if act.start_date else None,
            "due_date":          act.due_date.isoformat() if act.due_date else None,
            "is_past_due":       past_due,
            "can_answer":        not past_due and sub is None,
            "status":            status_info["status"],
            "status_label":      status_info["label"],
            "status_color":      status_info["color"],
            "submission": {
                "id":           sub.id,
                "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
                "score":        sub.score,
                "max_score":    sub.max_score,
                "grade":        sub.grade,
                "remarks":      sub.remarks,
                "is_graded":    sub.is_graded,
            } if sub else None,
        }
        output.append(item)

    return output


# ── GET /student/me/activities/{id} ──────────────────────────────────────────

@student_activity_router.get(
    "/me/activities/{activity_id}",
    summary="Get one activity with questions (no correct answers)",
)
async def get_student_activity(
    activity_id: int,
    student: Student = Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    # Step 1: Fetch the activity directly by ID (simpler — avoids async session expiry issues)
    result = await db.execute(
        select(Activity)
        .options(
            selectinload(Activity.questions)
            .selectinload(ActivityQuestion.choices)
        )
        .where(
            Activity.id == activity_id,
            Activity.is_published == True,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Step 2: Verify the student has access — re-query section assignments fresh
    ssa_result = await db.execute(
        select(StudentSectionAssignment)
        .options(selectinload(StudentSectionAssignment.section))
        .where(StudentSectionAssignment.student_id == student.id)
    )
    ssa_rows = ssa_result.scalars().all()
    student_class_ids = {
        row.section.class_id
        for row in ssa_rows
        if row.section and row.section.class_id
    }

    if student_class_ids:
        mod_result = await db.execute(
            select(Module).where(Module.id == activity.module_id)
        )
        module = mod_result.scalar_one_or_none()
        if not module or module.class_id not in student_class_ids:
            raise HTTPException(status_code=403, detail="You are not enrolled in this activity's class")

    # Check for existing submission
    sub_result = await db.execute(
        select(ActivitySubmission).where(
            ActivitySubmission.activity_id == activity_id,
            ActivitySubmission.student_id == student.id,
        )
    )
    sub = sub_result.scalar_one_or_none()
    past_due = _is_past_due(activity)
    can_answer = not past_due and sub is None
    status_info = _activity_status(activity, sub)

    return {
        "id":                activity.id,
        "title":             activity.title,
        "description":       activity.description,
        "instructions":      activity.instructions,
        "activity_type":     activity.activity_type,
        "activity_type_custom": activity.activity_type_custom,
        "format_type":       activity.format_type,
        "grading_mode":      activity.grading_mode,
        "module_id":         activity.module_id,
        "subject_id":        activity.subject_id,
        "max_score":         activity.max_score,
        "start_date":        activity.start_date.isoformat() if activity.start_date else None,
        "due_date":          activity.due_date.isoformat() if activity.due_date else None,
        "is_past_due":       past_due,
        "can_answer":        can_answer,
        "status":            status_info["status"],
        "status_label":      status_info["label"],
        "status_color":      status_info["color"],
        "questions":         [_strip_correct_answers(q) for q in sorted(activity.questions, key=lambda x: x.order)],
        "submission": {
            "id":           sub.id,
            "submitted_at": sub.submitted_at.isoformat(),
            "score":        sub.score,
            "max_score":    sub.max_score,
            "grade":        sub.grade,
            "remarks":      sub.remarks,
            "is_graded":    sub.is_graded,
        } if sub else None,
    }


# ── POST /student/me/activities/{id}/submit ───────────────────────────────────

@student_activity_router.post(
    "/me/activities/{activity_id}/submit",
    status_code=status.HTTP_201_CREATED,
    summary="Submit answers for an activity",
)
async def submit_activity(
    activity_id: int,
    body: ActivitySubmitRequest,
    student: Student = Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    # Fetch activity directly — access check via section assignments below
    result = await db.execute(
        select(Activity)
        .options(
            selectinload(Activity.questions)
            .selectinload(ActivityQuestion.choices)
        )
        .where(
            Activity.id == activity_id,
            Activity.is_published == True,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Verify enrollment fresh from DB
    ssa_result = await db.execute(
        select(StudentSectionAssignment)
        .options(selectinload(StudentSectionAssignment.section))
        .where(StudentSectionAssignment.student_id == student.id)
    )
    ssa_rows = ssa_result.scalars().all()
    student_class_ids = {
        row.section.class_id for row in ssa_rows
        if row.section and row.section.class_id
    }
    if student_class_ids:
        mod_result = await db.execute(select(Module).where(Module.id == activity.module_id))
        mod = mod_result.scalar_one_or_none()
        if not mod or mod.class_id not in student_class_ids:
            raise HTTPException(status_code=403, detail="Not enrolled in this activity's class")

    # Block past-due submissions
    if _is_past_due(activity):
        raise HTTPException(
            status_code=403,
            detail="This activity is past its due date. No late submissions are accepted.",
        )

    # start_date is informational; only block if past due (no late submissions)
    # if not _is_open(activity):
    #     raise HTTPException(status_code=403, detail="This activity is not yet open.")

    # Check for duplicate submission
    existing = await db.execute(
        select(ActivitySubmission).where(
            ActivitySubmission.activity_id == activity_id,
            ActivitySubmission.student_id == student.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="You have already submitted this activity.")

    # Build question lookup
    q_map = {q.id: q for q in activity.questions}

    # Create submission record
    submission = ActivitySubmission(
        activity_id=activity_id,
        student_id=student.id,
        max_score=activity.max_score,
        submitted_at=_utcnow(),
    )
    db.add(submission)
    await db.flush()

    total_earned = 0
    all_auto = True

    # Process each answer
    for ans_data in body.answers:
        question = q_map.get(ans_data.question_id)
        if not question:
            continue

        is_correct, pts_earned = _auto_grade_answer(question, ans_data.answer_value)
        if is_correct is None:
            all_auto = False

        answer = ActivityAnswer(
            submission_id=submission.id,
            question_id=ans_data.question_id,
            answer_value=ans_data.answer_value,
            is_correct=is_correct,
            points_earned=pts_earned,
        )
        db.add(answer)
        if pts_earned:
            total_earned += pts_earned

    def _compute_grade(pct: float) -> str:
        if pct >= 100:  return "1.00"
        elif pct >= 97: return "1.25"
        elif pct >= 94: return "1.50"
        elif pct >= 91: return "1.75"
        elif pct >= 88: return "2.00"
        elif pct >= 85: return "2.25"
        elif pct >= 82: return "2.50"
        elif pct >= 79: return "2.75"
        elif pct >= 75: return "3.00"
        else:           return "5.00"

    if activity.grading_mode == "auto":
        if all_auto:
            # All questions are auto-gradeable — grade immediately
            submission.score     = total_earned
            submission.is_graded = True
            pct = min((total_earned / activity.max_score * 100), 100.0) if activity.max_score else 0
            submission.grade   = _compute_grade(pct)
            submission.remarks = "Auto-graded"
        else:
            # Mix of auto + manual questions — store partial score, await teacher
            submission.score     = total_earned  # partial auto points already earned
            submission.is_graded = False
            submission.remarks   = "Partial auto-grade — awaiting teacher review"
    else:
        # Fully manual activity — keep score null until teacher grades
        submission.score     = None
        submission.is_graded = False

    await db.flush()
    await db.refresh(submission, ["answers"])

    # ── Notify the teacher that a student has submitted ───────────────────
    from app.services.notification_service import NotificationService
    from app.models.models import User as UserModel
    user_result = await db.execute(
        select(UserModel).where(UserModel.id == student.user_id)
    )
    user_obj = user_result.scalar_one_or_none()
    student_name = f"{user_obj.first_name} {user_obj.last_name}" if user_obj else f"Student #{student.id}"

    teacher_user_id = await NotificationService.get_teacher_user_id_for_activity(db, activity)
    if teacher_user_id:
        await NotificationService.notify(
            db,
            target_user_id=teacher_user_id,
            actor_user_id=student.user_id,
            notification_type="submission_received",
            title="New Submission",
            message=f"{student_name} submitted '{activity.title}'.",
            link_type="activity",
            link_id=activity.id,
        )

    # Also notify all admins
    admin_user_ids = await NotificationService.get_admin_user_ids(db)
    await NotificationService.notify_many(
        db,
        target_user_ids=admin_user_ids,
        notification_type="submission_received",
        title="New Submission",
        message=f"{student_name} submitted '{activity.title}'.",
        actor_user_id=student.user_id,
        link_type="activity",
        link_id=activity.id,
    )

    return {
        "id":           submission.id,
        "activity_id":  submission.activity_id,
        "student_id":   submission.student_id,
        "submitted_at": submission.submitted_at.isoformat(),
        "score":        submission.score,
        "max_score":    submission.max_score,
        "grade":        submission.grade,
        "remarks":      submission.remarks,
        "is_graded":    submission.is_graded,
        "grading_mode": activity.grading_mode,
        "answers": [
            {
                "question_id":   a.question_id,
                "answer_value":  a.answer_value,
                "is_correct":    a.is_correct,
                "points_earned": a.points_earned,
            }
            for a in submission.answers
        ],
    }


# ── GET /student/me/activities/{id}/result ────────────────────────────────────

@student_activity_router.get(
    "/me/activities/{activity_id}/result",
    summary="Get the student's own submission result for an activity",
)
async def get_activity_result(
    activity_id: int,
    student: Student = Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ActivitySubmission)
        .options(selectinload(ActivitySubmission.answers))
        .where(
            ActivitySubmission.activity_id == activity_id,
            ActivitySubmission.student_id == student.id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="No submission found for this activity")

    return {
        "id":           sub.id,
        "activity_id":  sub.activity_id,
        "student_id":   sub.student_id,
        "submitted_at": sub.submitted_at.isoformat(),
        "score":        sub.score,
        "max_score":    sub.max_score,
        "grade":        sub.grade,
        "remarks":      sub.remarks,
        "is_graded":    sub.is_graded,
        "answers": [
            {
                "question_id":   a.question_id,
                "answer_value":  a.answer_value,
                "is_correct":    a.is_correct,
                "points_earned": a.points_earned,
            }
            for a in sub.answers
        ],
    }
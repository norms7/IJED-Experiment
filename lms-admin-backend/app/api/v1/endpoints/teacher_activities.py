"""
Teacher Portal – Activity endpoints
Add these routes to app/api/v1/endpoints/teacher_portal.py
(import and include activity_router in router.py)

Routes:
  POST   /teacher/me/activities              – create activity with questions
  GET    /teacher/me/activities              – list activities (filter by subject/module)
  GET    /teacher/me/activities/{id}         – get single activity with questions
  PUT    /teacher/me/activities/{id}         – update activity
  DELETE /teacher/me/activities/{id}         – delete activity

  GET    /teacher/me/activities/{id}/submissions       – list all submissions
  POST   /teacher/me/activities/{id}/submissions/{sid}/grade – manually grade a submission
"""
import json
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import bearer_scheme, decode_token
from app.db.session import get_db
from app.models.models import (
    Activity, ActivityQuestion, ActivityQuestionChoice,
    ActivitySubmission, ActivityAnswer, Module, Teacher,
    TeacherClassAssignment, Student, User,
)
# Import schemas from wherever you merge them
from app.schemas import (
    ActivityCreateV2, ActivityUpdateV2, ActivityOutV2,
    SubmissionOut, ManualGradeRequest, QuestionCreate,
)

activity_router = APIRouter(prefix="/teacher", tags=["Teacher Activities"])

# ── re-use the same auth dependency ──────────────────────────────────────────

async def get_current_teacher(
    credentials=Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Teacher:
    payload = decode_token(credentials.credentials)
    if payload.get("role", "") not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Teacher access required")
    user_id = int(payload["sub"])
    result = await db.execute(
        select(Teacher)
        .options(selectinload(Teacher.class_assignments).selectinload(TeacherClassAssignment.subject))
        .options(selectinload(Teacher.class_assignments).selectinload(TeacherClassAssignment.class_))
        .where(Teacher.user_id == user_id)
    )
    teacher = result.scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher profile not found")
    return teacher


# ── Helpers ───────────────────────────────────────────────────────────────────

def _determine_grading_mode(format_type: str) -> str:
    """Auto-grading for structured formats; manual for essay/assignment/hybrid."""
    AUTO_GRADABLE = {"multiple_choice", "checkbox", "enumeration"}
    return "auto" if format_type in AUTO_GRADABLE else "manual"


def _auto_grade_answer(question: ActivityQuestion, answer_value: Optional[str]) -> tuple[bool, int]:
    """Returns (is_correct, points_earned)."""
    if answer_value is None:
        return False, 0

    if question.question_type == "multiple_choice":
        correct_idx = str(question.correct_answer).strip()
        return (answer_value.strip() == correct_idx, question.points if answer_value.strip() == correct_idx else 0)

    elif question.question_type == "checkbox":
        try:
            correct = set(json.loads(question.correct_answer or "[]"))
            given = set(json.loads(answer_value or "[]"))
            is_correct = correct == given
        except Exception:
            is_correct = False
        return (is_correct, question.points if is_correct else 0)

    elif question.question_type == "fill_blank":
        is_correct = (answer_value.strip().lower() == (question.correct_answer or "").strip().lower())
        return (is_correct, question.points if is_correct else 0)

    # essay → manual
    return (None, None)


async def _build_activity_out(activity: Activity, db: AsyncSession) -> ActivityOutV2:
    # Count submissions
    result = await db.execute(
        select(ActivitySubmission).where(ActivitySubmission.activity_id == activity.id)
    )
    sub_count = len(result.scalars().all())
    out = ActivityOutV2.model_validate(activity)
    out.submission_count = sub_count
    return out


# ── POST /teacher/me/activities ───────────────────────────────────────────────

@activity_router.post(
    "/me/activities",
    response_model=ActivityOutV2,
    status_code=status.HTTP_201_CREATED,
    summary="Create an activity with questions",
)
async def create_activity(
    body: ActivityCreateV2,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    # Verify module belongs to teacher
    result = await db.execute(select(Module).where(Module.id == body.module_id))
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    if module.teacher_id != teacher.id:
        raise HTTPException(status_code=403, detail="You do not own this module")

    # Resolve grading_mode from format_type if not overridden
    grading_mode = body.grading_mode
    if grading_mode == "auto" and body.format_type in ("freeform", "assignment", "hybrid"):
        grading_mode = "manual"

    # Compute max_score from questions if not set
    max_score = body.max_score
    if max_score is None and body.questions:
        max_score = sum(q.points for q in body.questions)

    activity = Activity(
        title=body.title,
        description=body.description,
        instructions=body.instructions,
        activity_type=body.activity_type,
        activity_type_custom=body.activity_type_custom,
        format_type=body.format_type,
        grading_mode=grading_mode,
        module_id=body.module_id,
        subject_id=body.subject_id or module.subject_id,
        teacher_id=teacher.id,
        max_score=max_score,
        start_date=body.start_date,
        due_date=body.due_date,
        is_published=body.is_published,
    )
    db.add(activity)
    await db.flush()  # get activity.id

    # Create questions + choices
    for q_data in body.questions:
        question = ActivityQuestion(
            activity_id=activity.id,
            order=q_data.order,
            question_text=q_data.question_text,
            question_type=q_data.question_type,
            points=q_data.points,
            correct_answer=q_data.correct_answer,
        )
        db.add(question)
        await db.flush()
        for c_data in q_data.choices:
            choice = ActivityQuestionChoice(
                question_id=question.id,
                order=c_data.order,
                choice_text=c_data.choice_text,
            )
            db.add(choice)

    await db.flush()
    await db.refresh(activity, ["questions"])
    for q in activity.questions:
        await db.refresh(q, ["choices"])

    # ── Notify enrolled students about the new activity ───────────────────
    if body.is_published:
        from app.services.notification_service import NotificationService
        effective_subject_id = body.subject_id or module.subject_id
        if effective_subject_id:
            student_user_ids = await NotificationService.get_enrolled_student_user_ids(
                db, effective_subject_id
            )
            await NotificationService.notify_many(
                db,
                target_user_ids=student_user_ids,
                notification_type="activity_created",
                title="New Activity Posted",
                message=f"A new activity '{body.title}' has been posted.",
                actor_user_id=teacher.user_id,
                link_type="activity",
                link_id=activity.id,
            )
        # Notify admins
        admin_user_ids = await NotificationService.get_admin_user_ids(db)
        await NotificationService.notify_many(
            db,
            target_user_ids=admin_user_ids,
            notification_type="activity_created",
            title="Activity Created",
            message=f"Teacher created activity '{body.title}'.",
            actor_user_id=teacher.user_id,
            link_type="activity",
            link_id=activity.id,
        )

    return await _build_activity_out(activity, db)


# ── GET /teacher/me/activities ────────────────────────────────────────────────

@activity_router.get(
    "/me/activities",
    response_model=List[ActivityOutV2],
    summary="List activities I created",
)
async def list_activities(
    module_id: Optional[int] = Query(None),
    subject_id: Optional[int] = Query(None),
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(Activity)
        .options(selectinload(Activity.questions).selectinload(ActivityQuestion.choices))
        .where(Activity.teacher_id == teacher.id)
    )
    if module_id:
        q = q.where(Activity.module_id == module_id)
    if subject_id:
        q = q.where(Activity.subject_id == subject_id)
    q = q.order_by(Activity.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [await _build_activity_out(a, db) for a in rows]


# ── GET /teacher/me/activities/{id} ──────────────────────────────────────────

@activity_router.get(
    "/me/activities/{activity_id}",
    response_model=ActivityOutV2,
    summary="Get one activity with questions",
)
async def get_activity(
    activity_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Activity)
        .options(selectinload(Activity.questions).selectinload(ActivityQuestion.choices))
        .where(Activity.id == activity_id, Activity.teacher_id == teacher.id)
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return await _build_activity_out(activity, db)


# ── PUT /teacher/me/activities/{id} ──────────────────────────────────────────

@activity_router.put(
    "/me/activities/{activity_id}",
    response_model=ActivityOutV2,
    summary="Update an activity",
)
async def update_activity(
    activity_id: int,
    body: ActivityUpdateV2,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Activity)
        .options(selectinload(Activity.questions).selectinload(ActivityQuestion.choices))
        .where(Activity.id == activity_id, Activity.teacher_id == teacher.id)
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    for field, val in body.model_dump(exclude_unset=True, exclude={"questions"}).items():
        setattr(activity, field, val)

    if body.questions is not None:
        # Full replace: delete existing questions (cascade deletes choices + answers)
        for q in list(activity.questions):
            await db.delete(q)
        await db.flush()
        for q_data in body.questions:
            question = ActivityQuestion(
                activity_id=activity.id,
                order=q_data.order,
                question_text=q_data.question_text,
                question_type=q_data.question_type,
                points=q_data.points,
                correct_answer=q_data.correct_answer,
            )
            db.add(question)
            await db.flush()
            for c_data in q_data.choices:
                db.add(ActivityQuestionChoice(
                    question_id=question.id,
                    order=c_data.order,
                    choice_text=c_data.choice_text,
                ))
        # Recompute max_score if questions changed
        if body.max_score is None:
            activity.max_score = sum(q.points for q in body.questions)

    await db.flush()
    await db.refresh(activity, ["questions"])
    for q in activity.questions:
        await db.refresh(q, ["choices"])
    return await _build_activity_out(activity, db)


# ── DELETE /teacher/me/activities/{id} ───────────────────────────────────────

@activity_router.delete(
    "/me/activities/{activity_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete an activity",
)
async def delete_activity(
    activity_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Activity).where(Activity.id == activity_id, Activity.teacher_id == teacher.id)
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    await db.delete(activity)
    await db.flush()
    return {"message": "Activity deleted", "id": activity_id}


# ── GET /teacher/me/activities/{id}/submissions ───────────────────────────────

@activity_router.get(
    "/me/activities/{activity_id}/submissions",
    response_model=List[SubmissionOut],
    summary="View all student submissions for an activity",
)
async def list_submissions(
    activity_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    # Verify ownership
    result = await db.execute(
        select(Activity).where(Activity.id == activity_id, Activity.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Activity not found")

    result = await db.execute(
        select(ActivitySubmission, User.first_name, User.last_name)
        .join(Student, Student.id == ActivitySubmission.student_id)
        .join(User, User.id == Student.user_id)
        .options(selectinload(ActivitySubmission.answers))
        .where(ActivitySubmission.activity_id == activity_id)
        .order_by(ActivitySubmission.submitted_at.desc())
    )
    rows = result.all()
    out = []
    for submission, first_name, last_name in rows:
        d = SubmissionOut.model_validate(submission)
        d.student_name = f"{first_name} {last_name}"
        out.append(d)
    return out


# ── POST /teacher/me/activities/{id}/submissions/{sid}/grade ─────────────────

@activity_router.post(
    "/me/activities/{activity_id}/submissions/{submission_id}/grade",
    response_model=SubmissionOut,
    summary="Manually grade a submission (freeform/hybrid/assignment)",
)
async def manual_grade(
    activity_id: int,
    submission_id: int,
    body: ManualGradeRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    # Verify teacher owns the activity
    result = await db.execute(
        select(Activity).where(Activity.id == activity_id, Activity.teacher_id == teacher.id)
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    result = await db.execute(
        select(ActivitySubmission)
        .options(selectinload(ActivitySubmission.answers))
        .where(ActivitySubmission.id == submission_id, ActivitySubmission.activity_id == activity_id)
    )
    submission = result.scalar_one_or_none()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

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

    submission.score     = body.score
    submission.max_score = activity.max_score
    # Auto-compute grade from score if teacher didn't supply one
    if body.grade:
        submission.grade = body.grade
    elif activity.max_score:
        pct = (body.score / activity.max_score * 100)
        submission.grade = _compute_grade(pct)
    submission.remarks   = body.remarks
    submission.is_graded = True
    await db.flush()
    await db.refresh(submission, ["answers"])

    # ── Notify the student that their activity has been graded ────────────
    from app.services.notification_service import NotificationService
    from app.models.models import Student
    student_result = await db.execute(
        select(Student).where(Student.id == submission.student_id)
    )
    student = student_result.scalar_one_or_none()
    if student:
        score_str = f"{submission.score}/{submission.max_score}" if submission.max_score else str(submission.score)
        await NotificationService.notify(
            db,
            target_user_id=student.user_id,
            actor_user_id=teacher.user_id,
            notification_type="activity_graded",
            title="Activity Graded",
            message=f"Your submission for '{activity.title}' has been graded: {score_str}.",
            link_type="activity",
            link_id=activity.id,
        )
        # Notify admins of the grading event
        from app.models.models import User as UserModel
        student_user = await db.execute(select(UserModel).where(UserModel.id == student.user_id))
        student_user = student_user.scalar_one_or_none()
        student_name = f"{student_user.first_name} {student_user.last_name}" if student_user else f"Student #{student.id}"
        admin_user_ids = await NotificationService.get_admin_user_ids(db)
        await NotificationService.notify_many(
            db,
            target_user_ids=admin_user_ids,
            notification_type="activity_graded",
            title="Activity Graded",
            message=f"Teacher graded '{activity.title}' for {student_name}: {score_str}.",
            actor_user_id=teacher.user_id,
            link_type="activity",
            link_id=activity.id,
        )

    return submission
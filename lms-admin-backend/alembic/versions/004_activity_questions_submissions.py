"""004_activity_questions_submissions

Revision ID: 004_activity_questions_submissions
Revises: 003_student_subject_enrollments
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "004_activity_questions_submissions"
down_revision = "003_student_subject_enrollments"
branch_labels = None
depends_on = None


def upgrade():
    # ── Extend activities table ────────────────────────────────────────────────
    op.add_column("activities", sa.Column("format_type", sa.String(30), server_default="multiple_choice", nullable=False))
    # format_type: multiple_choice | freeform | checkbox | enumeration | assignment | hybrid
    op.add_column("activities", sa.Column("grading_mode", sa.String(20), server_default="auto", nullable=False))
    # grading_mode: auto | manual
    op.add_column("activities", sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subjects.id"), nullable=True))
    op.add_column("activities", sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("teachers.id"), nullable=True))
    op.add_column("activities", sa.Column("start_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("activities", sa.Column("instructions", sa.Text(), nullable=True))
    # activity_type extended values: quiz | long_quiz | task_performance | exam | lab_exercise | other | assignment
    op.add_column("activities", sa.Column("activity_type_custom", sa.String(100), nullable=True))  # for "Other"

    # ── activity_questions ─────────────────────────────────────────────────────
    op.create_table(
        "activity_questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("activity_id", sa.Integer(), sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("question_type", sa.String(30), nullable=False),
        # question_type: multiple_choice | checkbox | fill_blank | essay
        sa.Column("points", sa.Integer(), server_default="1", nullable=False),
        sa.Column("correct_answer", sa.Text(), nullable=True),
        # For multiple_choice/checkbox: JSON array of correct option indices e.g. "[0]" or "[0,2]"
        # For fill_blank: the expected answer string
        # For essay: null (manual grading)
    )
    op.create_index("ix_activity_questions_activity_id", "activity_questions", ["activity_id"])

    # ── activity_question_choices ──────────────────────────────────────────────
    op.create_table(
        "activity_question_choices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("activity_questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("choice_text", sa.Text(), nullable=False),
    )
    op.create_index("ix_aqc_question_id", "activity_question_choices", ["question_id"])

    # ── activity_submissions ───────────────────────────────────────────────────
    op.create_table(
        "activity_submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("activity_id", sa.Integer(), sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),         # auto-computed or teacher-set
        sa.Column("max_score", sa.Integer(), nullable=True),
        sa.Column("grade", sa.String(10), nullable=True),        # optional letter grade
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("is_graded", sa.Boolean(), server_default="false", nullable=False),
        sa.UniqueConstraint("activity_id", "student_id", name="uq_submission_activity_student"),
    )
    op.create_index("ix_activity_submissions_activity_id", "activity_submissions", ["activity_id"])
    op.create_index("ix_activity_submissions_student_id", "activity_submissions", ["student_id"])

    # ── activity_answers ───────────────────────────────────────────────────────
    op.create_table(
        "activity_answers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("submission_id", sa.Integer(), sa.ForeignKey("activity_submissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("activity_questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("answer_value", sa.Text(), nullable=True),
        # For multiple_choice: selected index as string e.g. "0"
        # For checkbox: JSON array of selected indices e.g. "[0,2]"
        # For fill_blank/essay: free text
        sa.Column("is_correct", sa.Boolean(), nullable=True),   # null = not yet graded (essay)
        sa.Column("points_earned", sa.Integer(), nullable=True),
    )
    op.create_index("ix_activity_answers_submission_id", "activity_answers", ["submission_id"])


def downgrade():
    op.drop_table("activity_answers")
    op.drop_table("activity_submissions")
    op.drop_table("activity_question_choices")
    op.drop_table("activity_questions")
    op.drop_column("activities", "activity_type_custom")
    op.drop_column("activities", "instructions")
    op.drop_column("activities", "start_date")
    op.drop_column("activities", "teacher_id")
    op.drop_column("activities", "subject_id")
    op.drop_column("activities", "grading_mode")
    op.drop_column("activities", "format_type")
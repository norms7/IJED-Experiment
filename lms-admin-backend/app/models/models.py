"""
SQLAlchemy ORM models for the LMS Admin module.
All tables use Integer PKs for simplicity; swap to UUID if preferred.

PERF FIX (2025-06): Added missing indexes on all high-traffic FK columns.
  See ── PERF INDEX ── comments for each addition.
  After applying this file, run:
      alembic revision --autogenerate -m "add_perf_indexes"
      alembic upgrade head
  OR paste the SQL block at the bottom of models_indexes_patch.py directly
  into the Supabase SQL Editor (uses CONCURRENTLY — no table lock).
"""
from datetime import datetime, timezone, date as date_type
from typing import Optional

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer, String, Text,
    UniqueConstraint, func, Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pydantic import BaseModel, EmailStr
from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── roles ─────────────────────────────────────────────────────────────────────

class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)  # admin | teacher | student

    users: Mapped[list["User"]] = relationship("User", back_populates="role")


# ── users ─────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_email",      "email"),
        Index("ix_users_role_id",    "role_id"),
        Index("ix_users_is_active",  "is_active"),
        Index("ix_users_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=False
    )

    role: Mapped["Role"] = relationship("Role", back_populates="users")
    teacher_profile: Mapped[Optional["Teacher"]] = relationship(
        "Teacher", back_populates="user", uselist=False
    )
    student_profile: Mapped[Optional["Student"]] = relationship(
        "Student", back_populates="user", uselist=False
    )


# ── subjects ──────────────────────────────────────────────────────────────────

class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)

    teacher_assignments: Mapped[list["TeacherClassAssignment"]] = relationship(
        "TeacherClassAssignment", back_populates="subject"
    )
    modules: Mapped[list["Module"]] = relationship("Module", back_populates="subject")
    student_enrollments: Mapped[list["StudentSubjectEnrollment"]] = relationship(
        "StudentSubjectEnrollment", back_populates="subject"
    )


# ── classes ───────────────────────────────────────────────────────────────────

class Class(Base):
    __tablename__ = "classes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    grade_level: Mapped[Optional[str]] = mapped_column(String(50))
    school_year: Mapped[Optional[str]] = mapped_column(String(20))  # e.g. "2024-2025"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    sections: Mapped[list["Section"]] = relationship("Section", back_populates="class_")
    teacher_assignments: Mapped[list["TeacherClassAssignment"]] = relationship(
        "TeacherClassAssignment", back_populates="class_"
    )
    modules: Mapped[list["Module"]] = relationship("Module", back_populates="class_")


# ── sections ──────────────────────────────────────────────────────────────────

class Section(Base):
    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"), nullable=False)

    class_: Mapped["Class"] = relationship("Class", back_populates="sections")
    student_assignments: Mapped[list["StudentSectionAssignment"]] = relationship(
        "StudentSectionAssignment", back_populates="section"
    )


# ── teachers ──────────────────────────────────────────────────────────────────

class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    employee_id: Mapped[Optional[str]] = mapped_column(String(50), unique=True)
    specialization: Mapped[Optional[str]] = mapped_column(String(150))
    contact_number: Mapped[Optional[str]] = mapped_column(String(30))

    user: Mapped["User"] = relationship("User", back_populates="teacher_profile")
    class_assignments: Mapped[list["TeacherClassAssignment"]] = relationship(
        "TeacherClassAssignment", back_populates="teacher"
    )
    modules: Mapped[list["Module"]] = relationship("Module", back_populates="teacher")


# ── teacher_class_assignments ─────────────────────────────────────────────────

class TeacherClassAssignment(Base):
    __tablename__ = "teacher_class_assignments"
    __table_args__ = (
        UniqueConstraint("teacher_id", "class_id", "subject_id", name="uq_teacher_class_subject"),
        Index("ix_tca_teacher_id", "teacher_id"),  # ── PERF INDEX: teacher portal load
        Index("ix_tca_subject_id", "subject_id"),  # ── PERF INDEX: subject enrollment queries
        Index("ix_tca_class_id",   "class_id"),    # ── PERF INDEX: class-based lookups
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"), nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"), nullable=False)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    schedule: Mapped[Optional[str]] = mapped_column(String(255))  # e.g. "MWF 8:00-9:00"
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    teacher: Mapped["Teacher"] = relationship("Teacher", back_populates="class_assignments")
    class_: Mapped["Class"] = relationship("Class", back_populates="teacher_assignments")
    subject: Mapped["Subject"] = relationship("Subject", back_populates="teacher_assignments")


# ── students ──────────────────────────────────────────────────────────────────

class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    student_number: Mapped[Optional[str]] = mapped_column(String(50), unique=True)
    contact_number: Mapped[Optional[str]] = mapped_column(String(30))
    guardian_name: Mapped[Optional[str]] = mapped_column(String(200))
    guardian_contact: Mapped[Optional[str]] = mapped_column(String(30))

    user: Mapped["User"] = relationship("User", back_populates="student_profile")
    section_assignments: Mapped[list["StudentSectionAssignment"]] = relationship(
        "StudentSectionAssignment", back_populates="student"
    )
    subject_enrollments: Mapped[list["StudentSubjectEnrollment"]] = relationship(
        "StudentSubjectEnrollment", back_populates="student", cascade="all, delete-orphan"
    )


# ── student_section_assignments ───────────────────────────────────────────────

class StudentSectionAssignment(Base):
    __tablename__ = "student_section_assignments"
    __table_args__ = (
        UniqueConstraint("student_id", "section_id", name="uq_student_section"),
        Index("ix_ssa_student_id", "student_id"),  # ── PERF INDEX: loaded on every student auth
        Index("ix_ssa_section_id", "section_id"),  # ── PERF INDEX: section roster queries
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), nullable=False)
    section_id: Mapped[int] = mapped_column(ForeignKey("sections.id"), nullable=False)
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    student: Mapped["Student"] = relationship("Student", back_populates="section_assignments")
    section: Mapped["Section"] = relationship("Section", back_populates="student_assignments")


# ── student_subject_enrollments ───────────────────────────────────────────────

class StudentSubjectEnrollment(Base):
    __tablename__ = "student_subject_enrollments"
    __table_args__ = (
        UniqueConstraint("student_id", "subject_id", name="uq_student_subject"),
        Index("ix_sse_student_id", "student_id"),  # ── PERF INDEX: loaded on every student request
        Index("ix_sse_subject_id", "subject_id"),  # ── PERF INDEX: subject enrollment admin queries
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    student: Mapped["Student"] = relationship("Student", back_populates="subject_enrollments")
    subject: Mapped["Subject"] = relationship("Subject", back_populates="student_enrollments")


# ── modules ───────────────────────────────────────────────────────────────────

class Module(Base):
    __tablename__ = "modules"
    __table_args__ = (
        Index("ix_modules_subject_id",   "subject_id"),    # ── PERF INDEX: queried on EVERY student/teacher page
        Index("ix_modules_is_published", "is_published"),  # ── PERF INDEX: always filtered is_published=True
        Index("ix_modules_class_id",     "class_id"),      # ── PERF INDEX: teacher class-based module queries
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    class_id: Mapped[Optional[int]] = mapped_column(ForeignKey("classes.id"))
    subject_id: Mapped[Optional[int]] = mapped_column(ForeignKey("subjects.id"))
    teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"))
    order: Mapped[int] = mapped_column(Integer, default=0)
    term: Mapped[Optional[str]] = mapped_column(String(20))  # 1st, 2nd, 3rd, 4th
    file_url: Mapped[Optional[str]] = mapped_column(String(500))
    file_name: Mapped[Optional[str]] = mapped_column(String(255))
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    class_: Mapped[Optional["Class"]] = relationship("Class", back_populates="modules")
    subject: Mapped[Optional["Subject"]] = relationship("Subject", back_populates="modules")
    teacher: Mapped[Optional["Teacher"]] = relationship("Teacher", back_populates="modules")
    activities: Mapped[list["Activity"]] = relationship(
        "Activity", back_populates="module", cascade="all, delete-orphan"
    )


# ── activities ────────────────────────────────────────────────────────────────

class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (
        Index("ix_activities_module_id",    "module_id"),     # ── PERF INDEX: activity list always filters by module
        Index("ix_activities_subject_id",   "subject_id"),    # ── PERF INDEX: subject-filtered activity queries
        Index("ix_activities_is_published", "is_published"),  # ── PERF INDEX: always filtered is_published=True
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    instructions: Mapped[Optional[str]] = mapped_column(Text)

    # Type of activity (assessment category)
    activity_type: Mapped[str] = mapped_column(
        String(50), default="quiz"
    )  # quiz | long_quiz | task_performance | exam | lab_exercise | other | assignment
    activity_type_custom: Mapped[Optional[str]] = mapped_column(String(100))  # used when activity_type == "other"

    # Format / question structure
    format_type: Mapped[str] = mapped_column(
        String(30), default="multiple_choice"
    )  # multiple_choice | freeform | checkbox | enumeration | assignment | hybrid

    # Grading
    grading_mode: Mapped[str] = mapped_column(
        String(20), default="auto"
    )  # auto | manual

    # Relationships to context
    module_id: Mapped[int] = mapped_column(ForeignKey("modules.id"), nullable=False)
    subject_id: Mapped[Optional[int]] = mapped_column(ForeignKey("subjects.id"))
    teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"))

    # Scoring
    max_score: Mapped[Optional[int]] = mapped_column(Integer)

    # Dates
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    module: Mapped["Module"] = relationship("Module", back_populates="activities")
    questions: Mapped[list["ActivityQuestion"]] = relationship(
        "ActivityQuestion", back_populates="activity",
        cascade="all, delete-orphan", order_by="ActivityQuestion.order"
    )
    submissions: Mapped[list["ActivitySubmission"]] = relationship(
        "ActivitySubmission", back_populates="activity", cascade="all, delete-orphan"
    )


# ── ActivityQuestion ───────────────────────────────────────────────────────────

class ActivityQuestion(Base):
    __tablename__ = "activity_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # question_type: multiple_choice | checkbox | fill_blank | essay
    points: Mapped[int] = mapped_column(Integer, default=1)
    correct_answer: Mapped[Optional[str]] = mapped_column(Text)
    # multiple_choice: "0" (index of correct choice)
    # checkbox:        "[0,2]" (JSON array of correct indices)
    # fill_blank:      "expected text" (case-insensitive match)
    # essay:           null

    activity: Mapped["Activity"] = relationship("Activity", back_populates="questions")
    choices: Mapped[list["ActivityQuestionChoice"]] = relationship(
        "ActivityQuestionChoice", back_populates="question",
        cascade="all, delete-orphan", order_by="ActivityQuestionChoice.order"
    )
    answers: Mapped[list["ActivityAnswer"]] = relationship(
        "ActivityAnswer", back_populates="question", cascade="all, delete-orphan"
    )


# ── ActivityQuestionChoice ─────────────────────────────────────────────────────

class ActivityQuestionChoice(Base):
    __tablename__ = "activity_question_choices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("activity_questions.id", ondelete="CASCADE"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
    choice_text: Mapped[str] = mapped_column(Text, nullable=False)

    question: Mapped["ActivityQuestion"] = relationship("ActivityQuestion", back_populates="choices")


# ── ActivitySubmission ─────────────────────────────────────────────────────────

class ActivitySubmission(Base):
    __tablename__ = "activity_submissions"
    __table_args__ = (
        UniqueConstraint("activity_id", "student_id", name="uq_submission_activity_student"),
        Index("ix_submissions_student_id",  "student_id"),   # ── PERF INDEX: student dashboard + activities page
        Index("ix_submissions_activity_id", "activity_id"),  # ── PERF INDEX: teacher grading queries
        Index("ix_submissions_is_graded",   "is_graded"),    # ── PERF INDEX: graded/ungraded filter
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    score: Mapped[Optional[int]] = mapped_column(Integer)
    max_score: Mapped[Optional[int]] = mapped_column(Integer)
    grade: Mapped[Optional[str]] = mapped_column(String(10))
    remarks: Mapped[Optional[str]] = mapped_column(Text)
    is_graded: Mapped[bool] = mapped_column(Boolean, default=False)

    activity: Mapped["Activity"] = relationship("Activity", back_populates="submissions")
    student: Mapped["Student"] = relationship("Student")
    answers: Mapped[list["ActivityAnswer"]] = relationship(
        "ActivityAnswer", back_populates="submission", cascade="all, delete-orphan"
    )


# ── ActivityAnswer ─────────────────────────────────────────────────────────────

class ActivityAnswer(Base):
    __tablename__ = "activity_answers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("activity_submissions.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[int] = mapped_column(ForeignKey("activity_questions.id", ondelete="CASCADE"), nullable=False)
    answer_value: Mapped[Optional[str]] = mapped_column(Text)
    is_correct: Mapped[Optional[bool]] = mapped_column(Boolean)       # null = ungraded (essay)
    points_earned: Mapped[Optional[int]] = mapped_column(Integer)

    submission: Mapped["ActivitySubmission"] = relationship("ActivitySubmission", back_populates="answers")
    question: Mapped["ActivityQuestion"] = relationship("ActivityQuestion", back_populates="answers")


# ── StudentModuleRead ──────────────────────────────────────────────────────────

class StudentModuleRead(Base):
    """Tracks when a student opens/reads a module. One row per student+module."""
    __tablename__ = "student_module_reads"
    __table_args__ = (
        UniqueConstraint("student_id", "module_id", name="uq_student_module_read"),
        Index("ix_smr_student_id", "student_id"),  # ── PERF INDEX: dashboard read-count query
        Index("ix_smr_module_id",  "module_id"),   # ── PERF INDEX: module-level read tracking
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    module_id: Mapped[int] = mapped_column(ForeignKey("modules.id", ondelete="CASCADE"), nullable=False)
    first_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    student: Mapped["Student"] = relationship("Student")
    module: Mapped["Module"] = relationship("Module")


# ── Notification ───────────────────────────────────────────────────────────────

class Notification(Base):
    """
    Persistent notification for any user.

    actor_user_id  – who triggered the action (teacher, student, admin). Nullable for system msgs.
    target_user_id – who receives the notification (always set).

    notification_type examples:
      module_uploaded      – teacher uploaded a module
      activity_created     – teacher created an activity
      activity_graded      – teacher graded a student's submission
      submission_received  – student submitted an activity (notifies teacher)
      announcement         – admin broadcast to all / role-group
    """
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notification_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    link_type: Mapped[Optional[str]] = mapped_column(String(50))   # e.g. "module", "activity"
    link_id: Mapped[Optional[int]] = mapped_column(Integer)         # id of the related object
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    target_user: Mapped["User"] = relationship("User", foreign_keys=[target_user_id])
    actor_user:  Mapped[Optional["User"]] = relationship("User", foreign_keys=[actor_user_id])


# ── AttendanceSession ──────────────────────────────────────────────────────────

class AttendanceSession(Base):
    """One class meeting per section+subject+date. has_class=False = No Class day."""
    __tablename__ = "attendance_sessions"
    __table_args__ = (
        UniqueConstraint("class_id", "subject_id", "session_date",
                         name="uq_attendance_session_class_subject_date"),
    )

    id:           Mapped[int]            = mapped_column(Integer, primary_key=True)
    teacher_id:   Mapped[int]            = mapped_column(ForeignKey("teachers.id",  ondelete="CASCADE"), nullable=False)
    class_id:     Mapped[int]            = mapped_column(ForeignKey("classes.id",   ondelete="CASCADE"), nullable=False)
    subject_id:   Mapped[Optional[int]]  = mapped_column(ForeignKey("subjects.id",  ondelete="SET NULL"), nullable=True)
    term:         Mapped[str]            = mapped_column(String(20), nullable=False, default="1st")
    session_date: Mapped[date_type]       = mapped_column(Date, nullable=False)
    has_class:    Mapped[bool]           = mapped_column(Boolean, nullable=False, default=True)
    notes:        Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    created_at:   Mapped[datetime]       = mapped_column(DateTime(timezone=True), server_default=func.now())

    records: Mapped[list["AttendanceRecord"]] = relationship(
        "AttendanceRecord", back_populates="session", cascade="all, delete-orphan"
    )


# ── AttendanceRecord ───────────────────────────────────────────────────────────

class AttendanceRecord(Base):
    """One attendance record per student per session."""
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_att_record_session_student"),
    )

    id:         Mapped[int]           = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int]           = mapped_column(ForeignKey("attendance_sessions.id", ondelete="CASCADE"), nullable=False)
    student_id: Mapped[int]           = mapped_column(ForeignKey("students.id",            ondelete="CASCADE"), nullable=False)
    status:     Mapped[str]           = mapped_column(String(10), nullable=False, default="absent")
    # status: present | absent | late | excused
    remarks:    Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    session: Mapped["AttendanceSession"] = relationship("AttendanceSession", back_populates="records")
    student: Mapped["Student"]           = relationship("Student")

# ── AnalyticsCache ────────────────────────────────────────────────────────────
# PERF FIX (2025-06): ORM model for the analytics_cache table.
# The table existed via migration 005_analytics_cache but had no model,
# so analytics_service.py never actually used it — every Bayesian/descriptive
# call recomputed from scratch on every page load.
#
# This model lets the service layer read/write cached results, turning a
# 30-60s "students_like_you" computation into a sub-100ms cache hit on repeat
# visits within the TTL window.

class AnalyticsCache(Base):
    """
    Serialized analytics results per student, keyed by cache_key.

    cache_key examples:
      "descriptive.all"                  – full descriptive bundle, no subject filter
      "descriptive.subject.{id}"         – descriptive bundle filtered by subject
      "bayesian.all.target_{n}"          – full bayesian bundle for a target grade
      "bayesian.students_like_you"       – just the expensive peer-percentile calc

    payload is a JSON string (use json.dumps/json.loads in the service layer).
    Staleness is checked by the caller: if (now - computed_at) > TTL, recompute.
    """
    __tablename__ = "analytics_cache"
    __table_args__ = (
        UniqueConstraint("student_id", "cache_key", name="uq_analytics_cache_student_key"),
        Index("ix_analytics_cache_student_id", "student_id"),
        Index("ix_analytics_cache_computed_at", "computed_at"),
    )

    id:           Mapped[int]      = mapped_column(Integer, primary_key=True)
    student_id:   Mapped[int]      = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    cache_key:    Mapped[str]      = mapped_column(String(120), nullable=False)
    payload:      Mapped[str]      = mapped_column(Text, nullable=False)
    computed_at:  Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    student: Mapped["Student"] = relationship("Student")

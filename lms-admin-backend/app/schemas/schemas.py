"""
Pydantic v2 schemas — request bodies, responses, and shared types.
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field, field_validator, EmailStr

import json


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    role: str
    full_name: str


# ── Role ──────────────────────────────────────────────────────────────────────

class RoleOut(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


# ── User ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, description="Min 8 chars")
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    role_id: int

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        return v


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    role_id: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=8)


class UserOut(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    is_active: bool
    created_at: datetime
    role: RoleOut

    model_config = {"from_attributes": True}

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class UserListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[UserOut]


# ── Subject ───────────────────────────────────────────────────────────────────

class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: Optional[str] = None


class SubjectOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Class ─────────────────────────────────────────────────────────────────────

class ClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    grade_level: Optional[str] = None
    school_year: Optional[str] = None


class ClassOut(BaseModel):
    id: int
    name: str
    grade_level: Optional[str] = None
    school_year: Optional[str] = None
    is_active: bool

    model_config = {"from_attributes": True}


# ── Section ───────────────────────────────────────────────────────────────────

class SectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    class_id: int


class SectionOut(BaseModel):
    id: int
    name: str
    class_id: int

    model_config = {"from_attributes": True}


# ── Teacher ───────────────────────────────────────────────────────────────────

class TeacherCreate(BaseModel):
    user_id: int
    employee_id: Optional[str] = None
    specialization: Optional[str] = None
    contact_number: Optional[str] = None


class AssignClassRequest(BaseModel):
    teacher_id: int
    class_id: Optional[int] = None
    subject_id: Optional[int] = None
    schedule: Optional[str] = None

class AssignmentUpdate(BaseModel):
    class_id: Optional[int] = None
    subject_id: Optional[int] = None
    schedule: Optional[str] = None

class TeacherAssignmentOut(BaseModel):
    id: int
    class_: ClassOut
    subject: SubjectOut
    schedule: Optional[str] = None
    assigned_at: datetime

    model_config = {"from_attributes": True}


class TeacherOut(BaseModel):
    id: int
    user: UserOut
    employee_id: Optional[str] = None
    specialization: Optional[str] = None
    contact_number: Optional[str] = None
    class_assignments: list[TeacherAssignmentOut] = []

    model_config = {"from_attributes": True}


class TeacherListResponse(BaseModel):
    total: int
    items: list[TeacherOut]

class TeacherUpdate(BaseModel):
    employee_id: Optional[str] = None
    specialization: Optional[str] = None
    contact_number: Optional[str] = None
    
# ── Student ───────────────────────────────────────────────────────────────────

class StudentCreate(BaseModel):
    user_id: int
    student_number: Optional[str] = None
    contact_number: Optional[str] = None
    guardian_name: Optional[str] = None
    guardian_contact: Optional[str] = None


class AssignSectionRequest(BaseModel):
    student_id: int
    section_id: int


class StudentSectionOut(BaseModel):
    id: int
    section: SectionOut
    enrolled_at: datetime

    model_config = {"from_attributes": True}


class StudentOut(BaseModel):
    id: int
    user: UserOut
    student_number: Optional[str] = None
    contact_number: Optional[str] = None
    guardian_name: Optional[str] = None
    section_assignments: list[StudentSectionOut] = []

    model_config = {"from_attributes": True}


class StudentListResponse(BaseModel):
    total: int
    items: list[StudentOut]


# ── Module ────────────────────────────────────────────────────────────────────

VALID_TERMS = {"1st", "2nd", "3rd", "4th"}


class ModuleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    class_id: Optional[int] = None
    subject_id: Optional[int] = None
    teacher_id: Optional[int] = None
    order: int = 0
    term: Optional[str] = None
    is_published: bool = False

    @field_validator("term")
    @classmethod
    def validate_term(cls, v: Optional[str]) -> Optional[str]:
        if v and v not in VALID_TERMS:
            raise ValueError(f"term must be one of {VALID_TERMS}")
        return v


class ModuleUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    class_id: Optional[int] = None
    subject_id: Optional[int] = None
    order: Optional[int] = None
    term: Optional[str] = None
    is_published: Optional[bool] = None
    file_url: Optional[str] = None
    file_name: Optional[str] = None


class ModuleOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    class_id: Optional[int] = None
    subject_id: Optional[int] = None
    teacher_id: Optional[int] = None
    order: int
    term: Optional[str] = None
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    is_published: bool
    created_at: datetime
    activity_count: int = 0

    model_config = {"from_attributes": True}


# ── Activity ──────────────────────────────────────────────────────────────────

VALID_ACTIVITY_TYPES = {"assignment", "quiz", "reading", "project"}


class ActivityCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    activity_type: str = "assignment"
    module_id: int
    max_score: Optional[int] = Field(None, ge=0)
    due_date: Optional[datetime] = None
    is_published: bool = False

    @field_validator("activity_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_ACTIVITY_TYPES:
            raise ValueError(f"activity_type must be one of {VALID_ACTIVITY_TYPES}")
        return v


class ActivityUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    activity_type: Optional[str] = None
    max_score: Optional[int] = Field(None, ge=0)
    due_date: Optional[datetime] = None
    is_published: Optional[bool] = None


class ActivityOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    activity_type: str
    module_id: int
    max_score: Optional[int] = None
    due_date: Optional[datetime] = None
    is_published: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_users: int
    total_admins: int
    total_teachers: int
    total_students: int
    total_classes: int
    total_modules: int
    total_activities: int
    recent_users: list[UserOut]


# ── Generic ───────────────────────────────────────────────────────────────────

class MessageResponse(BaseModel):
    message: str
    id: Optional[int] = None

# ── Student Subject Enrollment ─────────────────────────────────────────────────

class EnrollSubjectsRequest(BaseModel):
    subject_ids: list[int]

class StudentSubjectEnrollmentOut(BaseModel):
    id: int
    student_id: int
    subject_id: int
    subject_name: str
    enrolled_at: datetime

    model_config = {"from_attributes": True}

# ── Constants ──────────────────────────────────────────────────────────────────
 
VALID_FORMAT_TYPES = {
    "multiple_choice", "freeform", "checkbox", "enumeration", "assignment", "hybrid"
}
 
VALID_ACTIVITY_TYPES = {
    "quiz", "long_quiz", "task_performance", "exam", "lab_exercise", "other", "assignment"
}
 
VALID_QUESTION_TYPES = {
    "multiple_choice", "checkbox", "fill_blank", "essay"
}
 
VALID_GRADING_MODES = {"auto", "manual"}
 
 
# ── Choice Schemas ─────────────────────────────────────────────────────────────
 
class ChoiceCreate(BaseModel):
    choice_text: str = Field(min_length=1)
    order: int = 0
 
 
class ChoiceOut(BaseModel):
    id: int
    order: int
    choice_text: str
    model_config = {"from_attributes": True}
 
 
# ── Question Schemas ───────────────────────────────────────────────────────────
 
class QuestionCreate(BaseModel):
    question_text: str = Field(min_length=1)
    question_type: str
    points: int = Field(default=1, ge=1)
    order: int = 0
    correct_answer: Optional[str] = None  # JSON string for arrays, plain string for fill_blank
    choices: List[ChoiceCreate] = []
 
    @field_validator("question_type")
    @classmethod
    def validate_qtype(cls, v: str) -> str:
        if v not in VALID_QUESTION_TYPES:
            raise ValueError(f"question_type must be one of {VALID_QUESTION_TYPES}")
        return v
 
 
class QuestionOut(BaseModel):
    id: int
    order: int
    question_text: str
    question_type: str
    points: int
    correct_answer: Optional[str] = None
    choices: List[ChoiceOut] = []
    model_config = {"from_attributes": True}
 
 
# ── Activity Schemas (extended) ────────────────────────────────────────────────
 
class ActivityCreateV2(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    instructions: Optional[str] = None
 
    activity_type: str = "quiz"
    activity_type_custom: Optional[str] = None  # only when activity_type == "other"
 
    format_type: str = "multiple_choice"
    grading_mode: str = "auto"
 
    module_id: int
    subject_id: Optional[int] = None
    teacher_id: Optional[int] = None
 
    max_score: Optional[int] = Field(None, ge=0)
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    is_published: bool = False
 
    questions: List[QuestionCreate] = []
 
    @field_validator("activity_type")
    @classmethod
    def validate_atype(cls, v: str) -> str:
        if v not in VALID_ACTIVITY_TYPES:
            raise ValueError(f"activity_type must be one of {VALID_ACTIVITY_TYPES}")
        return v
 
    @field_validator("format_type")
    @classmethod
    def validate_ftype(cls, v: str) -> str:
        if v not in VALID_FORMAT_TYPES:
            raise ValueError(f"format_type must be one of {VALID_FORMAT_TYPES}")
        return v
 
    @field_validator("grading_mode")
    @classmethod
    def validate_gmode(cls, v: str) -> str:
        if v not in VALID_GRADING_MODES:
            raise ValueError(f"grading_mode must be one of {VALID_GRADING_MODES}")
        return v
 
 
class ActivityUpdateV2(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    instructions: Optional[str] = None
    activity_type: Optional[str] = None
    activity_type_custom: Optional[str] = None
    format_type: Optional[str] = None
    grading_mode: Optional[str] = None
    max_score: Optional[int] = Field(None, ge=0)
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    is_published: Optional[bool] = None
    questions: Optional[List[QuestionCreate]] = None  # full replace if provided
 
 
class ActivityOutV2(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    activity_type: str
    activity_type_custom: Optional[str] = None
    format_type: str
    grading_mode: str
    module_id: int
    subject_id: Optional[int] = None
    teacher_id: Optional[int] = None
    max_score: Optional[int] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    is_published: bool
    created_at: datetime
    questions: List[QuestionOut] = []
    submission_count: int = 0
    model_config = {"from_attributes": True}
 
 
# ── Submission Schemas ─────────────────────────────────────────────────────────
 
class AnswerSubmit(BaseModel):
    question_id: int
    answer_value: Optional[str] = None  # JSON string for arrays
 
 
class ActivitySubmitRequest(BaseModel):
    answers: List[AnswerSubmit]
 
 
class AnswerOut(BaseModel):
    id: int
    question_id: int
    answer_value: Optional[str] = None
    is_correct: Optional[bool] = None
    points_earned: Optional[int] = None
    model_config = {"from_attributes": True}
 
 
class SubmissionOut(BaseModel):
    id: int
    activity_id: int
    student_id: int
    student_name: Optional[str] = None   # injected by the endpoint
    submitted_at: datetime
    score: Optional[int] = None
    max_score: Optional[int] = None
    grade: Optional[str] = None
    remarks: Optional[str] = None
    is_graded: bool
    answers: List[AnswerOut] = []
    model_config = {"from_attributes": True}
 
 
# ── Manual Grading ─────────────────────────────────────────────────────────────
 
class ManualGradeRequest(BaseModel):
    score: int = Field(ge=0)
    grade: Optional[str] = None
    remarks: Optional[str] = None
from app.schemas.schemas import *
from pydantic import BaseModel
from typing import Optional, List

class ActivityAnswerInput(BaseModel):
    question_id: int
    answer_value: Optional[str] = None

class ActivitySubmitRequest(BaseModel):
    answers: List[ActivityAnswerInput]
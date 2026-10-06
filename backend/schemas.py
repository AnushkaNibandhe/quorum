import re
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ---------------------------------------------------------------------------
# Shared literals (unchanged — extract.py depends on these)
# ---------------------------------------------------------------------------

Level = Literal["HIGH", "MEDIUM", "LOW"]
Review = Literal["pending", "approved", "rejected"]
InputType = Literal["text", "pdf", "image", "audio"]


# ---------------------------------------------------------------------------
# Extraction schemas (unchanged — used by extract.py and Results.jsx)
# ---------------------------------------------------------------------------

class Item(BaseModel):
    evidence: str = ""
    confidence: float = Field(0.5, ge=0, le=1)
    evidence_found: bool = False
    review: Review = "pending"


class Decision(Item):
    decision: str


class ActionItem(Item):
    id: str
    task: str
    owner: Optional[str] = None
    assigned_to_id: Optional[int] = None    # user.id of the assigned member
    due_text: Optional[str] = None
    due_date: Optional[date] = None
    priority: Level = "MEDIUM"
    depends_on: list[str] = []
    dependency_type: str = "BLOCKING"       # extensible: BLOCKING | SEQUENTIAL | INFORMATIONAL
    status: Literal["open", "in_progress", "blocked", "done"] = "open"


class Risk(Item):
    risk: str
    severity: Level = "MEDIUM"
    mitigation: Optional[str] = None


class Extraction(BaseModel):
    summary: str
    tone: Literal["positive", "neutral", "concern", "conflict"] = "neutral"
    decisions: list[Decision] = []
    action_items: list[ActionItem] = []
    risks: list[Risk] = []


# ---------------------------------------------------------------------------
# Meeting analysis request (project_id replaces the old project string)
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=10, max_length=100_000)
    title: str = "Untitled meeting"
    project_id: int                          # required — set by frontend from active project
    team: str = "General"
    meeting_date: Optional[date] = None
    input_type: InputType = "text"


# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------

class SignUpRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=6, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if not _EMAIL_RE.match(v):
            raise ValueError("Not a valid email address")
        return v.lower()


class SignInRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def lower_email(cls, v: str) -> str:
        return v.lower()


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    name: str
    email: str


# ---------------------------------------------------------------------------
# Project schemas
# ---------------------------------------------------------------------------

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class ProjectOut(BaseModel):
    id: int
    name: str
    description: str
    created_by: int
    created_at: datetime
    # Aggregates filled in by the endpoint
    meeting_count: int = 0
    open_action_count: int = 0
    member_count: int = 0


class MemberOut(BaseModel):
    user_id: int
    name: str
    email: str
    role: str
    status: str
    joined_at: datetime


class AddMemberRequest(BaseModel):
    email: str
    role: Literal["OWNER", "MEMBER"] = "MEMBER"


class InvitationOut(BaseModel):
    project_id: int
    project_name: str
    invited_by_name: str
    role: str
    joined_at: datetime

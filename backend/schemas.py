from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Level = Literal["HIGH", "MEDIUM", "LOW"]
Review = Literal["pending", "approved", "rejected"]
InputType = Literal["text", "pdf", "image", "audio"]


class Item(BaseModel):
    # evidence: verbatim quote from the notes; evidence_found is set by our code, not the LLM
    evidence: str = ""
    confidence: float = Field(0.5, ge=0, le=1)
    evidence_found: bool = False
    review: Review = "pending"


class Decision(Item):
    decision: str


class ActionItem(Item):
    id: str
    task: str
    owner: str | None = None
    due_text: str | None = None
    due_date: date | None = None
    priority: Level = "MEDIUM"
    depends_on: list[str] = []
    status: Literal["open", "in_progress", "blocked", "done"] = "open"


class Risk(Item):
    risk: str
    severity: Level = "MEDIUM"
    mitigation: str | None = None


class Extraction(BaseModel):
    summary: str
    tone: Literal["positive", "neutral", "concern", "conflict"] = "neutral"
    decisions: list[Decision] = []
    action_items: list[ActionItem] = []
    risks: list[Risk] = []


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=10, max_length=100_000)
    title: str = "Untitled meeting"
    project: str = "General"
    team: str = "General"
    meeting_date: date | None = None
    input_type: InputType = "text"

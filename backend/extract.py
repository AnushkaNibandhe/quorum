import json
import re
from datetime import date, timedelta

from pydantic import ValidationError

from llm import chat_json
from schemas import Extraction

SYSTEM = """You extract structured outcomes from messy meeting notes.
Return ONLY a JSON object with exactly this shape:
{
  "summary": "2-4 sentence summary",
  "tone": "positive" | "neutral" | "concern" | "conflict",
  "decisions": [{"decision": str, "evidence": str, "confidence": 0-1}],
  "action_items": [{"id": "A1", "task": str, "owner": str|null, "due_text": str|null,
                    "due_date": "YYYY-MM-DD"|null, "priority": "HIGH"|"MEDIUM"|"LOW",
                    "depends_on": ["A2"], "evidence": str, "confidence": 0-1}],
  "risks": [{"risk": str, "severity": "HIGH"|"MEDIUM"|"LOW", "mitigation": str|null,
             "evidence": str, "confidence": 0-1}]
}
Rules:
- "evidence" MUST be copied verbatim from the notes (the exact sentence or fragment). Never paraphrase it.
- Only include items actually present in the notes. Do not invent owners or dates: use null when absent.
- "due_text" is the date phrase as written (e.g. "by Friday"); resolve "due_date" relative to the meeting date given.
- "depends_on" lists ids of other action items that must finish first. Words like "once", "after",
  "when X is done", "blocked on", "depends on" signal a dependency: always fill it in when present.
- "confidence" is how clearly the notes state the item (1 = explicit, 0.5 = implied)."""

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WEEKDAY_RE = re.compile(r"\b(mon|tue|wed|thu|fri|sat|sun)(day|s|sday|nesday|r|rs|rsday|urday)?\b")


def resolve_due(text: str | None, ref: date) -> date | None:
    """Deterministic date for common relative phrases; None means 'leave the LLM's date'.
    ponytail: covers today/tomorrow/weekdays/next week/end of week/in N days|weeks;
    explicit dates ("Oct 10") are left to the LLM."""
    if not text:
        return None
    t = text.lower()
    if "day after tomorrow" in t:
        return ref + timedelta(days=2)
    if "tomorrow" in t:
        return ref + timedelta(days=1)
    if re.search(r"\b(today|eod|end of (the )?day)\b", t):
        return ref
    if m := re.search(r"\bin (\d+) (day|week)s?\b", t):
        return ref + timedelta(days=int(m[1]) * (7 if m[2] == "week" else 1))
    if re.search(r"\b(eow|end of (the )?week)\b", t):
        return ref + timedelta(days=(4 - ref.weekday()) % 7 or 7)
    if m := WEEKDAY_RE.search(t):
        # Next occurrence strictly after the meeting day ("by Friday" said on Friday = a week later).
        return ref + timedelta(days=(WEEKDAYS.index(m[1]) - ref.weekday()) % 7 or 7)
    if re.search(r"\bnext week\b", t):
        return ref + timedelta(days=7)
    return None


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower().strip(".\"'“”")


def verify_evidence(result: Extraction, text: str) -> Extraction:
    """Deterministic check that each quote really appears in the source; unverified items lose confidence."""
    source = _norm(text)
    ids = {a.id for a in result.action_items}
    for item in [*result.decisions, *result.action_items, *result.risks]:
        item.evidence_found = bool(item.evidence) and _norm(item.evidence) in source
        if not item.evidence_found:
            item.confidence = min(item.confidence, 0.6)
    for a in result.action_items:
        a.depends_on = [d for d in a.depends_on if d in ids and d != a.id]
    return result


def parse(raw: str) -> Extraction:
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    return Extraction.model_validate(json.loads(raw))


def extract(text: str, meeting_date: date | None = None) -> Extraction:
    meeting_date = meeting_date or date.today()
    user = f"Meeting date: {meeting_date.isoformat()} ({meeting_date:%A})\n\nNotes:\n{text}"
    raw = chat_json(SYSTEM, user)
    try:
        result = parse(raw)
    except (json.JSONDecodeError, ValidationError) as e:
        # One repair attempt: show the model its own output and the error.
        raw = chat_json(SYSTEM, f"{user}\n\nYour previous output was invalid ({e}). Previous output:\n{raw}\n\nReturn corrected JSON only.")
        result = parse(raw)
    for item in [*result.decisions, *result.action_items, *result.risks]:
        item.review = "pending"  # only a human approves
    for a in result.action_items:
        a.due_date = resolve_due(a.due_text, meeting_date) or a.due_date  # LLMs get weekday math wrong
    return verify_evidence(result, text)

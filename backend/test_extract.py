"""Self-check for parsing, evidence verification and date resolution (no API key needed): python test_extract.py"""
from datetime import date

import extract

NOTES = """Meeting: Project Alpha
Rahul will finish the authentication module by Friday.
Priya said the database migration may cause downtime.
We decided to use PostgreSQL."""

FAKE = """```json
{"summary": "Alpha sync.", "tone": "concern",
 "decisions": [{"decision": "Use PostgreSQL", "evidence": "We decided to use PostgreSQL.", "confidence": 0.95}],
 "action_items": [
   {"id": "A1", "task": "Finish auth", "owner": "Rahul", "due_text": "by Friday", "due_date": "2026-10-08",
    "priority": "HIGH", "depends_on": ["A9", "A1"], "evidence": "Rahul will finish the  authentication module by Friday", "confidence": 0.9},
   {"id": "A2", "task": "Docs", "owner": null, "due_date": null, "evidence": "Amit writes the docs", "confidence": 0.9}],
 "risks": [{"risk": "Downtime", "severity": "HIGH", "evidence": "the database migration may cause downtime", "confidence": 0.8}]}
```"""

MON = date(2026, 10, 5)  # a Monday

extract.chat_json = lambda system, user: FAKE
r = extract.extract(NOTES, MON)
a1, a2 = r.action_items
assert r.decisions[0].evidence_found and r.risks[0].evidence_found
assert a1.evidence_found and a1.confidence == 0.9  # whitespace/case/punctuation tolerant
assert not a2.evidence_found and a2.confidence == 0.6  # hallucinated quote gets capped
assert a1.depends_on == []  # unknown + self references dropped
assert str(a1.due_date) == "2026-10-09"  # LLM said the 8th (Thursday); code corrects to Friday

cases = {
    "by Friday": "2026-10-09", "Wed": "2026-10-07", "next Monday": "2026-10-12", "on Monday": "2026-10-12",
    "tomorrow": "2026-10-06", "day after tomorrow": "2026-10-07", "EOD": "2026-10-05", "in 3 days": "2026-10-08",
    "in 2 weeks": "2026-10-19", "end of the week": "2026-10-09", "next week": "2026-10-12", "Thursday": "2026-10-08",
}
for phrase, want in cases.items():
    assert str(extract.resolve_due(phrase, MON)) == want, (phrase, extract.resolve_due(phrase, MON))
assert extract.resolve_due("Oct 20", MON) is None and extract.resolve_due(None, MON) is None
assert str(extract.resolve_due("by Friday", date(2026, 10, 9))) == "2026-10-16"  # said on Friday -> next Friday
print("ok")

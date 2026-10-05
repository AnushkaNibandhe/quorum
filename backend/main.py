import json
import logging
from contextlib import asynccontextmanager
from datetime import date

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, Form, HTTPException, UploadFile  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from db import Meeting, get_session, init_db  # noqa: E402
from extract import extract, verify_evidence  # noqa: E402
from ingest import ingest  # noqa: E402
from schemas import AnalyzeRequest, Extraction  # noqa: E402

log = logging.getLogger("quorum")
MAX_UPLOAD = 50 * 1024 * 1024


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Quorum", lifespan=lifespan)


def to_dict(m: Meeting) -> dict:
    return {**m.model_dump(exclude={"result"}), "result": json.loads(m.result)}


def get_or_404(session: Session, meeting_id: int) -> Meeting:
    m = session.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    return m


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/ingest")
def ingest_file(file: UploadFile, translate: bool = Form(True)):
    """File -> plain text, returned to the user to check/edit before analysis."""
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File is larger than 50 MB")
    try:
        input_type, text = ingest(data, file.filename or "upload", translate)
    except ValueError as e:
        raise HTTPException(415, str(e))
    except Exception as e:
        log.exception("ingest failed")
        raise HTTPException(502, f"Could not read file: {e}")
    if not text.strip():
        raise HTTPException(422, "No text could be found in this file")
    return {"input_type": input_type, "text": text}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest, session: Session = Depends(get_session)):
    meeting_date = req.meeting_date or date.today()
    try:
        result = extract(req.text, meeting_date)
    except Exception as e:
        log.exception("extraction failed")
        raise HTTPException(502, f"AI extraction failed: {e}")
    m = Meeting(
        title=req.title, project=req.project, team=req.team, meeting_date=meeting_date,
        input_type=req.input_type, raw_text=req.text, result=result.model_dump_json(),
    )
    session.add(m)
    session.commit()
    session.refresh(m)
    return to_dict(m)


@app.get("/api/meetings")
def list_meetings(session: Session = Depends(get_session)):
    meetings = session.exec(select(Meeting).order_by(Meeting.created_at.desc())).all()
    out = []
    for m in meetings:
        r = Extraction.model_validate_json(m.result)
        items = [*r.decisions, *r.action_items, *r.risks]
        out.append({
            "id": m.id, "title": m.title, "project": m.project, "team": m.team,
            "meeting_date": m.meeting_date, "input_type": m.input_type, "tone": r.tone, "summary": r.summary,
            "counts": {
                "decisions": len(r.decisions), "actions": len(r.action_items), "risks": len(r.risks),
                "pending": sum(i.review == "pending" for i in items),
            },
        })
    return out


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: int, session: Session = Depends(get_session)):
    return to_dict(get_or_404(session, meeting_id))


@app.put("/api/meetings/{meeting_id}/result")
def save_review(meeting_id: int, result: Extraction, session: Session = Depends(get_session)):
    """Save human edits/approvals. Evidence is re-checked server-side; the client can't mark a quote verified."""
    m = get_or_404(session, meeting_id)
    m.result = verify_evidence(result, m.raw_text).model_dump_json()
    session.add(m)
    session.commit()
    return to_dict(m)


@app.delete("/api/meetings/{meeting_id}", status_code=204)
def delete_meeting(meeting_id: int, session: Session = Depends(get_session)):
    session.delete(get_or_404(session, meeting_id))
    session.commit()

"""Self-check for ingestion + review API, no API key or real DB needed: python test_api.py"""
import io
import zipfile

import pymupdf
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine

import db
import extract
import ingest
from test_extract import FAKE, NOTES

db.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
extract.chat_json = lambda system, user: FAKE.replace('"confidence": 0.95}', '"confidence": 0.95, "review": "approved"}')
from main import app  # noqa: E402


def make_pdf(text: str | None) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    if text:
        page.insert_text((72, 72), text)
    else:  # image-only page = scanned
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 10, 10), 0)
        page.insert_image(pymupdf.Rect(0, 0, 100, 100), pixmap=pix)
    doc.new_page()  # blank page must not count as scanned
    return doc.tobytes()


# --- ingestion helpers
assert "Rahul owns auth" in ingest.pdf_text(make_pdf("Rahul owns auth by Friday"))
assert ingest.pdf_text(make_pdf(None)) is None
assert [ingest.kind_of(f) for f in ["a.PDF", "b.jpg", "c.webm", "d.docx"]] == ["pdf", "image", "audio", None]

buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    z.writestr("page_10.md", "ten")
    z.writestr("page_2.md", "two")
    z.writestr("meta.json", "{}")
assert ingest.doc_output_text(buf.getvalue()) == "two\n\nten"
assert ingest.doc_output_text(b"# plain md") == "# plain md"

diarized = {"transcript": "x", "diarized_transcript": {"entries": [
    {"speaker_id": "2", "transcript": " I'll do auth. "}, {"speaker_id": "SPEAKER_B", "transcript": "ok"},
    {"speaker_id": "2", "transcript": "thanks"}]}}
assert ingest.transcript_text(diarized) == "Speaker 1: I'll do auth.\nSpeaker 2: ok\nSpeaker 1: thanks"
assert ingest.transcript_text({"transcript": " hi "}) == "hi"

# --- API
with TestClient(app) as c:
    r = c.post("/api/ingest", files={"file": ("n.pdf", make_pdf("We decided to use PostgreSQL."), "application/pdf")})
    assert r.status_code == 200 and r.json()["input_type"] == "pdf", r.text
    assert c.post("/api/ingest", files={"file": ("n.docx", b"x")}).status_code == 415

    m = c.post("/api/analyze", json={"text": NOTES, "title": "T", "input_type": "pdf", "meeting_date": "2026-10-05"}).json()
    res = m["result"]
    assert m["input_type"] == "pdf"
    assert all(i["review"] == "pending" for i in [*res["decisions"], *res["action_items"], *res["risks"]])  # LLM can't approve

    res["action_items"][0].update(review="approved", status="in_progress", owner="Rahul K")
    res["action_items"][1].update(evidence_found=True, confidence=0.6)  # client tries to fake verification
    res["risks"][0]["review"] = "rejected"
    saved = c.put(f"/api/meetings/{m['id']}/result", json=res).json()["result"]
    a1, a2 = saved["action_items"]
    assert (a1["review"], a1["status"], a1["owner"]) == ("approved", "in_progress", "Rahul K")
    assert a2["evidence_found"] is False
    assert c.get("/api/meetings").json()[0]["counts"]["pending"] == 2

    assert c.delete(f"/api/meetings/{m['id']}").status_code == 204
    assert c.get(f"/api/meetings/{m['id']}").status_code == 404
print("ok")

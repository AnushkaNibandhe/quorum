"""Turn an uploaded file (PDF, image, audio) into plain meeting text."""
import io
import json
import os
import re
import tempfile
import time
import zipfile
from pathlib import Path

import pymupdf
import httpx
from sarvamai import SarvamAI

IMAGE_EXT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".mp4", ".ogg", ".opus", ".webm", ".flac", ".aac", ".amr", ".wma"}
DOC_TERMINAL = {"completed", "partially_completed", "failed", "rejected"}


def kind_of(filename: str) -> str | None:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in IMAGE_EXT:
        return "image"
    if ext in AUDIO_EXT:
        return "audio"
    return None


def _client() -> SarvamAI:
    key = os.getenv("SARVAM_API_KEY")
    if not key:
        raise RuntimeError("SARVAM_API_KEY is not set (backend/.env)")
    return SarvamAI(api_subscription_key=key)


def pdf_text(data: bytes) -> str | None:
    """Text layer of a digital PDF; None if any page is a scan (has images but no text)."""
    pages = []
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        for page in doc:
            text = page.get_text().strip()
            if not text and page.get_images():
                return None
            pages.append(text)
    return "\n\n".join(p for p in pages if p)


def _natural(name: str):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name)]


def doc_output_text(content: bytes) -> str:
    """Sarvam Doc AI output is a zip of per-page markdown (or a single file); join it in page order."""
    if content[:2] != b"PK":
        return content.decode("utf-8", "replace").strip()
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        names = [n for n in z.namelist() if n.endswith(".md")] or [n for n in z.namelist() if not n.endswith("/")]
        return "\n\n".join(z.read(n).decode("utf-8", "replace").strip() for n in sorted(names, key=_natural)).strip()


def ocr(data: bytes, filename: str, mime: str) -> str:
    c = _client()
    job = c.doc_ai.digitise(file=[(filename, data, mime)], language="en-IN", output_format="md", content_type="mixed")
    deadline = time.monotonic() + 300
    while (status := c.doc_ai.get_status(job_id=job.job_id).status.lower()) not in DOC_TERMINAL:
        if time.monotonic() > deadline:
            raise TimeoutError("Document OCR took longer than 5 minutes")
        time.sleep(3)
    if status in {"failed", "rejected"}:
        raise RuntimeError(f"Document OCR {status}")
    dl = c.doc_ai.get_download_url(job_id=job.job_id)
    r = httpx.get(dl.url, headers=dl.headers or {}, timeout=60)
    r.raise_for_status()
    return doc_output_text(r.content)


def transcript_text(out: dict) -> str:
    """Prefer speaker-labelled lines when diarization is present."""
    entries = (out.get("diarized_transcript") or {}).get("entries") or []
    if not entries:
        return (out.get("transcript") or "").strip()
    # Renumber speakers 1..n in order of first appearance, whatever ids the API uses.
    labels: dict[str, str] = {}
    lines = []
    for e in entries:
        label = labels.setdefault(str(e.get("speaker_id")), f"Speaker {len(labels) + 1}")
        lines.append(f"{label}: {(e.get('transcript') or '').strip()}")
    return "\n".join(lines)


def transcribe(data: bytes, filename: str, translate: bool) -> str:
    # Batch job (not the 30s sync endpoint) so full-length meetings work and speakers are separated.
    c = _client()
    with tempfile.TemporaryDirectory() as d:
        path = Path(d, "meeting" + Path(filename).suffix.lower())
        path.write_bytes(data)
        job = c.speech_to_text_job.create_job(
            model="saaras:v4", mode="translate" if translate else "transcribe",
            language_code="unknown", with_diarization=True,
        )
        job.upload_files([str(path)], timeout=300)
        job.start()
        if job.wait_until_complete(poll_interval=3, timeout=900).job_state.lower() == "failed":
            raise RuntimeError("Transcription failed")
        job.download_outputs(str(Path(d, "out")))
        out = json.loads(next(Path(d, "out").glob("*.json")).read_text(encoding="utf-8"))
    return transcript_text(out)


def ingest(data: bytes, filename: str, translate: bool = True) -> tuple[str, str]:
    """Returns (input_type, text). Raises ValueError for unsupported files."""
    kind = kind_of(filename)
    if kind == "pdf":
        return kind, pdf_text(data) or ocr(data, "notes.pdf", "application/pdf")
    if kind == "image":
        ext = Path(filename).suffix.lower()
        return kind, ocr(data, "notes" + ext, IMAGE_EXT[ext])
    if kind == "audio":
        return kind, transcribe(data, filename, translate)
    raise ValueError("Unsupported file. Use PDF, PNG/JPG, or audio (mp3, wav, m4a, webm, ogg...).")

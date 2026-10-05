# Quorum

Turns meeting notes into decisions, action items and risks. Every item is backed by a quote from the notes.

## Run

```sh
# backend (http://localhost:8000)
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
cp .env.example .env   # add SARVAM_API_KEY
.venv/Scripts/python -m uvicorn main:app   # restart after code/.env changes (OneDrive breaks --reload)

# frontend (http://localhost:5173, proxies /api to the backend)
cd frontend
npm install && npm run dev
```

Self-checks (need no API key): `cd backend && .venv/Scripts/python test_extract.py && .venv/Scripts/python test_api.py`

## Inputs

| Input | How |
|---|---|
| Text | Pasted directly |
| PDF | Digital text layer via PyMuPDF (local). Scanned pages go to Sarvam Document Intelligence (max 10 pages) |
| Image | Sarvam Document Intelligence (handwriting + print, PNG/JPG) |
| Audio | Sarvam batch speech-to-text `saaras:v4` with speaker diarization (up to 2 h). Optional translation to English |

Every upload returns plain text for the user to check and fix before analysis.

## LLM provider

Set `LLM_PROVIDER` in `backend/.env`. Use `sarvam` for now. `imagine` (Qualcomm) will be wired up once the SDK is available.

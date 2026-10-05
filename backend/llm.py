import os

import httpx

def chat_json(system: str, user: str) -> str:
    """Send one chat turn, return the model's raw JSON string."""
    provider = os.getenv("LLM_PROVIDER", "sarvam")
    if provider == "sarvam":
        return _sarvam(system, user)
    if provider == "imagine":
        # Wire up once the Imagine SDK wheel + docs are available; don't guess its API.
        raise NotImplementedError("Imagine SDK not installed yet")
    raise ValueError(f"Unknown LLM_PROVIDER: {provider}")


def _sarvam(system: str, user: str) -> str:
    key = os.getenv("SARVAM_API_KEY")
    if not key:
        raise RuntimeError("SARVAM_API_KEY is not set (backend/.env)")
    r = httpx.post(
        "https://api.sarvam.ai/v1/chat/completions",
        headers={"api-subscription-key": key},
        json={
            "model": os.getenv("SARVAM_MODEL", "sarvam-105b"),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.1,
            # sarvam-105b reasons before answering (3-5k tokens even at "low"), and that counts here.
            "max_tokens": 16000,
            "reasoning_effort": "low",
            "response_format": {"type": "json_object"},
        },
        timeout=120,
    )
    r.raise_for_status()
    choice = r.json()["choices"][0]
    if not choice["message"].get("content"):
        raise RuntimeError(f"Model returned no answer (finish_reason={choice.get('finish_reason')}); notes may be too long")
    return choice["message"]["content"]

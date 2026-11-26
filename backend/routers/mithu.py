"""Mithu AI voice identity ticket.

Issues a short-lived EdDSA assertion for the separate Mithu voice service.
The caller must already be authenticated by EduConnect's existing dependency.
No database records are written and no production data is accessed.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException

from auth_lib import get_current_user

router = APIRouter(prefix="/api/mithu", tags=["mithu-voice"])


@router.post("/voice-ticket")
async def create_voice_ticket(user: dict = Depends(get_current_user)) -> dict:
    if (os.environ.get("MITHU_VOICE_ENABLED") or "").lower() not in {"true", "1", "yes"}:
        raise HTTPException(status_code=503, detail="Mithu voice is not enabled for this workspace yet.")

    raw_key = os.environ.get("MITHU_IDENTITY_PRIVATE_KEY_PEM") or ""
    private_key = raw_key.replace("\\n", "\n").strip()
    if not private_key:
        raise HTTPException(status_code=503, detail="Mithu voice identity signing is not configured.")

    websocket_url = (os.environ.get("MITHU_VOICE_WS_URL") or "").strip()
    if not websocket_url.startswith(("wss://", "ws://")):
        raise HTTPException(status_code=503, detail="Mithu voice WebSocket URL is not configured.")
    if (os.environ.get("APP_ENV") or "production").lower() == "production" and not websocket_url.startswith("wss://"):
        raise HTTPException(status_code=503, detail="Mithu voice requires a secure WebSocket URL.")

    now = datetime.now(timezone.utc)
    claims = {
        "iss": os.environ.get("MITHU_IDENTITY_ISSUER", "educonnect-pro"),
        "aud": os.environ.get("MITHU_IDENTITY_AUDIENCE", "mithu-ai"),
        "sub": str(user["id"]),
        "iat": now,
        "exp": now + timedelta(seconds=90),
        "jti": str(uuid.uuid4()),
        "scope": user.get("scope", "tenant"),
        "role": user.get("role", "user"),
        "tenant_id": user.get("tenant_id"),
        "office": user.get("office"),
        "permissions": user.get("permissions") or {},
    }
    try:
        assertion = jwt.encode(claims, private_key, algorithm="EdDSA")
    except Exception as exc:
        # Do not expose key parsing details to the browser.
        raise HTTPException(status_code=503, detail="Mithu voice identity signing failed.") from exc

    return {
        "identity_assertion": assertion,
        "websocket_url": websocket_url,
        "expires_in": 90,
        "language_options": ["ml", "manglish", "en"],
    }

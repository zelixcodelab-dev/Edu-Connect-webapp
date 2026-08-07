"""Interakt WhatsApp Business API sender (approved template messages only).

Env: INTERAKT_API_KEY (Basic auth secret), WA_DEFAULT_COUNTRY_CODE,
WA_TEMPLATE_VISIT, WA_TEMPLATE_APPLICATION. Every send is logged to
``db.wa_messages`` for auditing. Failures never raise — callers get
``{"ok": False, "detail": ...}`` so CRM flows keep working without WhatsApp.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx

from db import db
from auth_lib import gen_id, now_iso

log = logging.getLogger("finflow.whatsapp")

INTERAKT_MESSAGE_URL = "https://api.interakt.ai/v1/public/message/"
IST = ZoneInfo("Asia/Kolkata")


def _cfg() -> dict:
    return {
        "key": (os.environ.get("INTERAKT_API_KEY") or "").strip(),
        "cc": (os.environ.get("WA_DEFAULT_COUNTRY_CODE") or "+91").strip(),
        "visit_tpl": (os.environ.get("WA_TEMPLATE_VISIT") or "").strip(),
        "app_tpl": (os.environ.get("WA_TEMPLATE_APPLICATION") or "").strip(),
    }


def split_phone(raw: str, default_cc: str = "+91"):
    """Best-effort split of a raw phone into (country_code, 10-digit number)."""
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        return None
    if len(digits) == 10:
        return default_cc, digits
    if len(digits) == 11 and digits.startswith("0"):
        return default_cc, digits[1:]
    if len(digits) == 12 and digits.startswith("91"):
        return "+91", digits[2:]
    if 11 <= len(digits) <= 15:
        return f"+{digits[:-10]}", digits[-10:]
    return None


def fmt_dt_ist(iso: str | None) -> str:
    """ISO datetime → '03 Jul 2026, 10:30 AM' in IST for WhatsApp bodies."""
    if not iso:
        return "-"
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).strftime("%d %b %Y, %I:%M %p")
    except (TypeError, ValueError):
        return str(iso)


def fmt_date_ist(iso: str | None) -> str:
    """ISO datetime → '03 Jul 2026' (date only, IST)."""
    if not iso:
        return "-"
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).strftime("%d %b %Y")
    except (TypeError, ValueError):
        return str(iso)


async def send_template(phone: str, template_name: str, body_values: list, language: str = "en") -> dict:
    """POST a template message via Interakt. Returns {ok, detail, ...}."""
    cfg = _cfg()
    if not cfg["key"]:
        return {"ok": False, "detail": "WhatsApp not configured (INTERAKT_API_KEY missing)"}
    if not template_name:
        return {"ok": False, "detail": "WhatsApp template name not configured"}
    parts = split_phone(phone, cfg["cc"])
    if not parts:
        return {"ok": False, "detail": f"Invalid phone number: {phone or '(empty)'}"}
    cc, number = parts
    payload = {
        "countryCode": cc,
        "phoneNumber": number,
        "type": "Template",
        "template": {
            "name": template_name,
            "languageCode": language,
            "bodyValues": [str(v).strip() or "-" if v is not None else "-" for v in body_values],
        },
    }
    result: dict
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                INTERAKT_MESSAGE_URL,
                json=payload,
                headers={"Authorization": f"Basic {cfg['key']}", "Content-Type": "application/json"},
            )
        try:
            body = resp.json()
        except ValueError:
            body = {"raw": resp.text[:500]}
        ok = resp.status_code < 400 and bool(body.get("result", True))
        result = {
            "ok": ok,
            "status_code": resp.status_code,
            "message_id": body.get("id"),
            "detail": "sent" if ok else str(body.get("message") or body)[:300],
        }
        if not ok:
            log.warning("interakt send failed [%s]: %s", resp.status_code, result["detail"])
    except httpx.HTTPError as exc:
        log.error("interakt network error: %s", exc)
        result = {"ok": False, "detail": f"WhatsApp network error: {exc}"}

    try:
        await db.wa_messages.insert_one({
            "id": gen_id(),
            "created_at": now_iso(),
            "phone": f"{cc}{number}",
            "template": template_name,
            "body_values": payload["template"]["bodyValues"],
            "ok": result.get("ok", False),
            "detail": result.get("detail"),
            "message_id": result.get("message_id"),
        })
    except Exception:  # pragma: no cover — audit log is best-effort
        pass
    return result


async def send_visit_scheduled(*, name: str, phone: str, institution: str, departure_at: str | None,
                               arrival_at: str | None, travel_mode: str, drop_point: str) -> dict:
    """Approved template vars: 1=name 2=institution 3=visit date 4=departure
    5=mode of travel 6=pickup/drop point. Visit date = arrival day."""
    return await send_template(
        phone, _cfg()["visit_tpl"],
        [name, institution, fmt_date_ist(arrival_at or departure_at),
         fmt_dt_ist(departure_at), travel_mode, drop_point],
    )


async def send_application_link(*, name: str, phone: str, course: str, college: str,
                                city: str, link: str) -> dict:
    """Template vars: 1=name 2=course 3=college 4=city 5=application link."""
    return await send_template(
        phone, _cfg()["app_tpl"],
        [name, course, college, city, link],
    )

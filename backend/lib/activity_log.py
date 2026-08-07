"""Shared activity-log helper. Persists a lightweight per-action audit
event to `db.activity_log` so we can render a CRM Activity timeline and,
where safe, offer one-click undo/restore actions.

Event shape (all fields are optional except `id`, `type`, `actor_id`,
`at`):
  {
    "id":            gen_id(),
    "type":          "user.deleted" | "user.reactivated" | "lead.assigned" | …,
    "actor_id":      "<user_id>",           # who did it
    "actor_name":    "…",                   # denormalised for the UI
    "actor_role":    "super_admin" | …,
    "actor_office":  "KM_BLR" | …,
    "at":            "2026-…Z",             # ISO8601 UTC (string)
    "at_dt":         datetime,              # BSON Date — powers the TTL index
    "subject_type":  "user" | "lead" | "student" | "campaign" | "payment" | "sc_adjustment",
    "subject_id":    "<id>",
    "subject_label": "Ravi Kumar",          # denormalised for the timeline
    "before":        {…},                   # for undo/restore
    "after":         {…},
    "note":          "human-readable summary",
    "office":        "KM_BLR" | None,       # office-scope for filtering
    "reversible":    true | false,          # frontend hint
    "restored":      bool,                  # flipped by /activity-log/{id}/restore
    "restored_at":   ISO string | None,
    "restored_by":   user_id | None,
  }

Callers should use ``log_event(...)`` — it fires-and-forgets and *never*
raises so a logging blip can't break the calling API endpoint.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from db import db
from auth_lib import gen_id, now_iso


_log = logging.getLogger("activity_log")

# 30-day rolling retention (per product decision).
RETENTION_SECONDS = 30 * 24 * 60 * 60


async def ensure_indexes() -> None:
    """Create the TTL index that auto-purges rows older than the retention
    window, plus a few query-friendly compound indexes. Idempotent."""
    try:
        await db.activity_log.create_index("at_dt", expireAfterSeconds=RETENTION_SECONDS)
        await db.activity_log.create_index([("office", 1), ("at_dt", -1)])
        await db.activity_log.create_index([("subject_type", 1), ("at_dt", -1)])
        await db.activity_log.create_index([("type", 1), ("at_dt", -1)])
    except Exception:
        _log.exception("[activity_log] index setup failed")


async def log_event(
    *,
    event_type: str,
    actor: dict,
    subject_type: Optional[str] = None,
    subject_id: Optional[str] = None,
    subject_label: Optional[str] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    note: Optional[str] = None,
    office: Optional[str] = None,
    reversible: bool = False,
    extras: Optional[dict] = None,
) -> Optional[dict]:
    """Insert an activity event. Errors are swallowed after logging — the
    audit log is a nice-to-have and must never break the caller's flow."""
    try:
        doc = {
            "id": gen_id(),
            "type": event_type,
            "actor_id": (actor or {}).get("id"),
            "actor_name": (actor or {}).get("name"),
            "actor_role": (actor or {}).get("role"),
            "actor_office": (actor or {}).get("office"),
            "at": now_iso(),
            "at_dt": datetime.now(timezone.utc),
            "subject_type": subject_type,
            "subject_id": subject_id,
            "subject_label": subject_label,
            "before": before,
            "after": after,
            "note": note,
            "office": office or (actor or {}).get("office"),
            "reversible": bool(reversible),
            "restored": False,
        }
        if extras:
            doc.update({k: v for k, v in extras.items() if k not in doc})
        await db.activity_log.insert_one(doc)
        doc.pop("_id", None)
        return doc
    except Exception:  # pragma: no cover - defensive
        _log.exception("activity_log: failed to persist event type=%s", event_type)
        return None


# --- Convenience wrappers so call sites read cleanly ------------------------

async def log_user_event(*, actor: dict, event_type: str, target: dict,
                         before: Optional[dict] = None, after: Optional[dict] = None,
                         note: Optional[str] = None, reversible: bool = False) -> None:
    """Log an event whose subject is a user row."""
    await log_event(
        event_type=event_type,
        actor=actor,
        subject_type="user",
        subject_id=(target or {}).get("id"),
        subject_label=(target or {}).get("name") or (target or {}).get("email"),
        before=before, after=after, note=note,
        office=(target or {}).get("office"),
        reversible=reversible,
    )


async def log_lead_event(*, actor: dict, event_type: str, lead: dict,
                         before: Optional[dict] = None, after: Optional[dict] = None,
                         note: Optional[str] = None, reversible: bool = False) -> None:
    """Log an event whose subject is a lead row."""
    await log_event(
        event_type=event_type,
        actor=actor,
        subject_type="lead",
        subject_id=(lead or {}).get("id"),
        subject_label=(lead or {}).get("name"),
        before=before, after=after, note=note,
        office=(lead or {}).get("office"),
        reversible=reversible,
    )


async def log_student_event(*, actor: dict, event_type: str, student: dict,
                            before: Optional[dict] = None, after: Optional[dict] = None,
                            note: Optional[str] = None, reversible: bool = False) -> None:
    """Log an event whose subject is a student row."""
    await log_event(
        event_type=event_type,
        actor=actor,
        subject_type="student",
        subject_id=(student or {}).get("id"),
        subject_label=(student or {}).get("name"),
        before=before, after=after, note=note,
        office=(student or {}).get("home_office"),
        reversible=reversible,
    )


async def log_campaign_event(*, actor: dict, event_type: str, campaign: dict,
                             before: Optional[dict] = None, after: Optional[dict] = None,
                             note: Optional[str] = None, reversible: bool = False) -> None:
    """Log an event whose subject is a campaign row."""
    await log_event(
        event_type=event_type,
        actor=actor,
        subject_type="campaign",
        subject_id=(campaign or {}).get("id"),
        subject_label=(campaign or {}).get("name"),
        before=before, after=after, note=note,
        office=(campaign or {}).get("office"),
        reversible=reversible,
    )

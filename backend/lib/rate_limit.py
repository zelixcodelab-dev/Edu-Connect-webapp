"""Lightweight IP-based rate limiter backed by MongoDB.

Used to protect PUBLIC (unauthenticated) endpoints against spam / abuse —
today only ``POST /api/public/applications`` uses it, but the helpers are
generic so more routes can opt-in later.

Design:
  * A single collection ``rate_limits`` with a compound _id = ``bucket:key``.
    ``bucket`` is a caller-defined string (e.g. "apply-hour"), ``key`` is
    typically the client IP but can be anything (email, phone …).
  * We track a rolling window by pushing timestamps and evicting anything
    older than ``window_seconds``. If the trimmed list exceeds ``max_hits``
    the caller is blocked (429).
  * ``expires_at`` field powers a TTL index so old records are auto-purged
    without a cron.
  * Errors are logged and *fail-open* — if MongoDB blips we prefer letting
    a real user through over blocking every submission.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request

from db import db

_log = logging.getLogger("finflow.rate_limit")

# Set FINFLOW_DISABLE_RATE_LIMITS=1 in test env if you need to bypass.
_DISABLED = os.environ.get("FINFLOW_DISABLE_RATE_LIMITS") == "1"


def client_ip(request: Request) -> str:
    """Pick the best client IP, respecting ``X-Forwarded-For`` from our ingress."""
    xff = request.headers.get("x-forwarded-for") or ""
    if xff:
        # First hop is the original client; strip any port suffix.
        first = xff.split(",")[0].strip()
        if first:
            return first.split(":")[0]
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip().split(":")[0]
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def hit(*, bucket: str, key: str, max_hits: int, window_seconds: int) -> None:
    """Increment the counter and raise 429 if the caller is over budget."""
    if _DISABLED:
        return
    doc_id = f"{bucket}:{key}"
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=window_seconds)
    try:
        # Pull the row, trim the sliding window, then push the new hit.
        rec = await db.rate_limits.find_one({"_id": doc_id}, {"hits": 1})
        hits: list[datetime] = []
        if rec and rec.get("hits"):
            # MongoDB stores datetimes as UTC but returns them tz-naive; re-add
            # tzinfo so comparisons don't blow up.
            for t in rec["hits"]:
                if t is None:
                    continue
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                if t > cutoff:
                    hits.append(t)
        if len(hits) >= max_hits:
            retry_after = max(1, int((min(hits) + timedelta(seconds=window_seconds) - now).total_seconds()))
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests. Try again in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )
        hits.append(now)
        await db.rate_limits.update_one(
            {"_id": doc_id},
            {"$set": {"hits": hits, "expires_at": now + timedelta(seconds=window_seconds)}},
            upsert=True,
        )
    except HTTPException:
        raise
    except Exception:
        _log.exception("[rate_limit] hit() failed — failing open bucket=%s key=%s", bucket, key)


async def ensure_indexes() -> None:
    """Create the TTL index on ``expires_at`` (idempotent). Called at startup."""
    try:
        await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    except Exception:
        _log.exception("[rate_limit] TTL index setup failed — old rows may accumulate")


def mask_phone(raw: Optional[str]) -> str:
    """PII-safe representation of a phone number for logs (SEC-002).

    Keeps the last 2 digits so support can still triangulate rows against
    the DB without leaking the full number into log aggregators.
    Examples:
      "9876543210"       → "********10"
      "+91 98765 43210"  → "+91 ***** ***10"
    """
    if not raw:
        return ""
    s = str(raw)
    keep = 2
    out = []
    remaining_non_masked = keep
    for ch in reversed(s):
        if ch.isdigit():
            if remaining_non_masked > 0:
                out.append(ch)
                remaining_non_masked -= 1
            else:
                out.append("*")
        else:
            out.append(ch)
    return "".join(reversed(out))

"""Per-company subscription (manual plans), seat limits, login history and session revocation."""
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request

from db import db, gdb, get_current_tenant

SUB_STATUSES = ["trial", "active", "past_due", "cancelled"]
EXPIRY_ACTIONS = ["keep", "read_only", "block"]
NEAR_DAYS = 7
REVOKED_MSG = "Your session was ended by the administrator. Please sign in again."
TRIAL_BLOCKED_MSG = "Your trial has ended. Contact your platform provider to upgrade and restore access."
TRIAL_READONLY_MSG = "Your trial has ended, so this workspace is read-only. Contact your platform provider to upgrade."


def trial_info(sub: dict | None) -> dict | None:
    """Trial countdown for a subscription; expired = the day after trial_ends_at."""
    sub = sub or {}
    end = sub.get("trial_ends_at")
    if sub.get("status") != "trial" or not end:
        return None
    try:
        end_day = datetime.fromisoformat(str(end)[:10]).date()
    except ValueError:
        return None
    days_left = (end_day - datetime.now(timezone.utc).date()).days
    return {
        "trial_ends_at": end_day.isoformat(), "days_left": days_left, "expired": days_left < 0,
        "near": 0 <= days_left <= NEAR_DAYS, "expiry_action": sub.get("expiry_action") or "keep",
    }
_revoked_cache: dict = {}
_CACHE_TTL = 10


async def seat_usage(tdb) -> int:
    return await tdb.users.count_documents({"deleted_at": {"$in": [None, ""]}})


async def enforce_seat_limit() -> None:
    """Raise 403 when the current company has used every seat on its plan."""
    tid = get_current_tenant()
    t = await gdb.tenants.find_one({"id": tid}, {"_id": 0, "subscription": 1, "plan": 1})
    limit = ((t or {}).get("subscription") or {}).get("seat_limit")
    if not limit:
        return
    used = await seat_usage(db)
    if used >= limit:
        plan = ((t.get("subscription") or {}).get("plan_name")) or t.get("plan") or "current"
        raise HTTPException(
            status_code=403,
            detail=f"Seat limit reached: {used} of {limit} users on the {plan} plan. Ask your platform provider to add seats or upgrade.",
        )


async def tenant_access(tenant_id: str) -> dict:
    """Cached {revoked, trial} snapshot used on every tenant request."""
    hit = _revoked_cache.get(tenant_id)
    now = time.monotonic()
    if hit and now - hit[1] < _CACHE_TTL:
        return hit[0]
    t = await gdb.tenants.find_one({"id": tenant_id}, {"_id": 0, "sessions_revoked_at": 1, "subscription": 1}) or {}
    val = {"revoked": float(t.get("sessions_revoked_at") or 0), "trial": trial_info(t.get("subscription"))}
    _revoked_cache[tenant_id] = (val, now)
    return val


def forget_revoked(tenant_id: str) -> None:
    _revoked_cache.pop(tenant_id, None)


def _client_ip(request: Request | None):
    if request is None or not request.client:
        return None
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or request.client.host


async def record_login_event(request: Request | None, email: str, tenant_id: str | None,
                             success: bool, reason: str = "", user_id: str | None = None) -> None:
    try:
        await gdb.login_events.insert_one({
            "tenant_id": tenant_id, "email": email, "user_id": user_id,
            "success": success, "reason": reason, "ip": _client_ip(request),
            "user_agent": (request.headers.get("user-agent", "")[:200] if request else ""),
            "at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:  # noqa: BLE001 - best-effort logging
        pass


def since_iso(hours: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

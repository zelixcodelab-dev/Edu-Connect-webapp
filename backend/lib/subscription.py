"""Per-company subscription (manual plans), seat limits, login history and session revocation."""
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request

from db import db, gdb, get_current_tenant

SUB_STATUSES = ["trial", "active", "past_due", "cancelled"]
_revoked_cache: dict = {}
_CACHE_TTL = 10


async def seat_usage(tdb) -> int:
    return await tdb.users.count_documents({"deleted_at": {"$exists": False}})


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


async def tenant_revoked_at(tenant_id: str) -> float:
    hit = _revoked_cache.get(tenant_id)
    now = time.monotonic()
    if hit and now - hit[1] < _CACHE_TTL:
        return hit[0]
    t = await gdb.tenants.find_one({"id": tenant_id}, {"_id": 0, "sessions_revoked_at": 1})
    val = float((t or {}).get("sessions_revoked_at") or 0)
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

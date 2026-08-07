"""Pure helpers to compute the next available follow-up slot.

Follow-ups are booked on a per-user timeline at fixed 5-minute intervals
inside a working window (10:00-19:00 IST). The first booking on an empty
timeline is manual; every subsequent one is auto-assigned to latest + 5 min,
rolling over to the next day's window start once the day is full.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional, Tuple

# India has no DST, so a fixed offset is safe and dependency-free.
IST = timezone(timedelta(hours=5, minutes=30))
SLOT_MINUTES = 5
WORK_START_HOUR = 10   # 10:00 inclusive
WORK_END_HOUR = 19     # 19:00 exclusive (last bookable slot is 18:55)


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


def _ceil_to_slot(dt: datetime) -> datetime:
    dt = dt.replace(second=0, microsecond=0)
    rem = dt.minute % SLOT_MINUTES
    if rem:
        dt += timedelta(minutes=SLOT_MINUTES - rem)
    return dt


def _normalize_window(dt: datetime) -> datetime:
    """Snap a candidate into the [10:00, 19:00) IST working window."""
    day_start = dt.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
    day_end = dt.replace(hour=WORK_END_HOUR, minute=0, second=0, microsecond=0)
    if dt < day_start:
        return day_start
    if dt >= day_end:
        return (dt + timedelta(days=1)).replace(
            hour=WORK_START_HOUR, minute=0, second=0, microsecond=0
        )
    return dt


def compute_next_slot(
    booked_iso: Iterable[str], now: datetime, exclude_iso: Optional[str] = None
) -> Tuple[str, bool]:
    """Return (slot_iso_utc, is_first).

    booked_iso : ISO datetimes already booked on the caller's timeline.
    now        : timezone-aware 'now' (UTC).
    exclude_iso: an ISO slot to drop from the set (e.g. the lead being edited).

    is_first is True when there are no future booked slots — the UI then lets
    the user pick the time manually; otherwise the slot is auto-assigned.
    """
    now_ist = now.astimezone(IST).replace(second=0, microsecond=0)
    floor_now = _ceil_to_slot(now_ist)
    exclude_dt = _parse_iso(exclude_iso)
    exclude_ist = (
        exclude_dt.astimezone(IST).replace(second=0, microsecond=0) if exclude_dt else None
    )

    future = set()
    for s in booked_iso:
        dt = _parse_iso(s)
        if not dt:
            continue
        ist = dt.astimezone(IST).replace(second=0, microsecond=0)
        if exclude_ist and ist == exclude_ist:
            continue
        if ist >= floor_now:
            future.add(ist)

    is_first = len(future) == 0
    if future:
        candidate = max(future) + timedelta(minutes=SLOT_MINUTES)
    else:
        candidate = floor_now
    if candidate < floor_now:
        candidate = floor_now
    candidate = _normalize_window(candidate)

    guard = 0
    while candidate in future and guard < 100000:
        candidate = _normalize_window(candidate + timedelta(minutes=SLOT_MINUTES))
        guard += 1

    return candidate.astimezone(timezone.utc).isoformat(), is_first

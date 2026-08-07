"""Helpers for the Office-Admin dashboard aggregation.

Extracted from ``routers/dashboard.py::office_admin_dashboard`` to drop the
function below ~25 cyclomatic complexity and gain unit-test coverage.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable


def window_bounds(window: str, now: datetime) -> tuple[datetime, datetime]:
    """Return (start, end) for the dashboard windows ``week|month|year``.

    Mirrors the existing private ``_window_bounds`` in routers/dashboard so
    callers can use either entry point.
    """
    end = now
    if window == "week":
        start = end - timedelta(days=6)
    elif window == "year":
        start = end - timedelta(days=364)
    else:  # default: month
        start = end - timedelta(days=29)
    return start.replace(hour=0, minute=0, second=0, microsecond=0), end


def student_admission_dt(s: dict) -> datetime:
    """Resolve a datetime for an admission. Falls back to "epoch" so the
    student is naturally excluded from window filters."""
    raw = s.get("enrollment_date") or s.get("created_at") or ""
    try:
        if len(raw) >= 10:
            return datetime.strptime(raw[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        pass
    return datetime.fromtimestamp(0, tz=timezone.utc)


def days_until_birthday(dob: str, now: datetime) -> int:
    """Days until the next anniversary of ``dob`` (YYYY-MM-DD). Same-day → 0."""
    try:
        d = datetime.strptime(dob[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return 9999
    next_year = now.year if (d.month, d.day) >= (now.month, now.day) else now.year + 1
    target = d.replace(year=next_year, tzinfo=timezone.utc)
    return (target.date() - now.date()).days


def compute_staff_month_counts(students: Iterable[dict]) -> dict[tuple, int]:
    """Tally how many admissions each (staff_name_norm, YYYY-MM) bucket has.

    Used to decide which admissions become "eligible" — the rule is: any staff
    with 3+ admissions in a calendar month earns incentive for ALL of that
    month's admissions.
    """
    counts: dict[tuple, int] = {}
    for s in students:
        ref = (s.get("reference") or "").strip().lower()
        if not ref:
            continue
        dt = student_admission_dt(s)
        key = (ref, f"{dt.year:04d}-{dt.month:02d}")
        counts[key] = counts.get(key, 0) + 1
    return counts


def build_staff_breakdown(
    students: Iterable[dict],
    staffs: Iterable[dict],
    *,
    win_start: datetime,
    win_end: datetime,
    month_counts: dict[tuple, int],
) -> list[dict]:
    """Build the per-staff aggregation rows for the window.

    Returns a sorted list (most admissions first, then alphabetical).
    """
    staff_by_name = {s["name"].strip().lower(): s for s in staffs}
    staff_rows: dict[str, dict] = {}

    for s in students:
        ref = (s.get("reference") or "").strip().lower()
        if not ref:
            continue
        dt = student_admission_dt(s)
        if dt < win_start or dt > win_end:
            continue
        staff = staff_by_name.get(ref)
        # Skip references that don't map to a registered staff (legacy free-text refs)
        if not staff:
            continue
        month_key = (ref, f"{dt.year:04d}-{dt.month:02d}")
        is_eligible_month = month_counts.get(month_key, 0) >= 3

        row = staff_rows.setdefault(staff["id"], {
            "staff_id": staff["id"],
            "name": staff["name"],
            "office": staff.get("office"),
            "eligible_incentive": staff.get("eligible_incentive") or 0,
            "date_of_birth": staff.get("date_of_birth"),
            "admissions": [],
            "admissions_count": 0,
            "eligible_count": 0,
            "incentive_earned": 0.0,
            "incentive_paid": 0.0,
        })
        incentive_amount = float(staff.get("eligible_incentive") or 0)
        admission = {
            "student_id": s["id"],
            "student_name": s.get("name"),
            "college": s.get("college"),
            "course": s.get("course"),
            "enrolled_at": dt.isoformat(),
            "month": month_key[1],
            "eligible": is_eligible_month,
            "incentive_amount": incentive_amount if is_eligible_month else 0.0,
            "incentive_paid": bool(s.get("incentive_paid")),
            "incentive_paid_at": s.get("incentive_paid_at"),
        }
        row["admissions"].append(admission)
        row["admissions_count"] += 1
        if is_eligible_month:
            row["eligible_count"] += 1
            row["incentive_earned"] += incentive_amount
            if admission["incentive_paid"]:
                row["incentive_paid"] += incentive_amount

    breakdown: list[dict] = []
    for row in staff_rows.values():
        row["admissions"].sort(key=lambda a: a["enrolled_at"], reverse=True)
        row["incentive_pending"] = round(row["incentive_earned"] - row["incentive_paid"], 2)
        row["incentive_earned"] = round(row["incentive_earned"], 2)
        row["incentive_paid"] = round(row["incentive_paid"], 2)
        breakdown.append(row)
    breakdown.sort(key=lambda r: (-r["admissions_count"], r["name"].lower()))
    return breakdown


def upcoming_birthdays_30d(staffs: Iterable[dict], now: datetime) -> list[dict]:
    """Return staff with DOB within the next 30 days, sorted by proximity."""
    out: list[dict] = []
    for staff in staffs:
        dob = staff.get("date_of_birth")
        if not dob:
            continue
        days = days_until_birthday(dob, now)
        if days <= 30:
            out.append({
                "staff_id": staff["id"],
                "name": staff["name"],
                "office": staff.get("office"),
                "date_of_birth": dob,
                "days_until": days,
            })
    out.sort(key=lambda u: u["days_until"])
    return out


def count_admissions_in_window(
    students: Iterable[dict], win_start: datetime, win_end: datetime
) -> int:
    """Total admissions in the window, regardless of staff-reference match."""
    return sum(
        1 for s in students
        if win_start <= student_admission_dt(s) <= win_end
    )

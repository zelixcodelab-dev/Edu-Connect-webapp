"""Pure helpers for client/student incentive math.

Extracted from `routers/clients.py::client_detail` and shared with the office
dashboard. Pure → unit-testable without DB or HTTP fixtures.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional


def _admission_dt(student: dict) -> Optional[datetime]:
    """Resolve a UTC datetime for an admission (enrollment_date first, then
    created_at, then None). Tolerates malformed strings."""
    raw = student.get("enrollment_date") or student.get("created_at") or ""
    if len(raw) < 10:
        return None
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _name_norm(name: Optional[str]) -> str:
    return (name or "").strip().lower()


def filter_admissions_by_reference(
    students: Iterable[dict], client_name: str
) -> list[dict]:
    """Return students whose ``reference`` matches the client name
    (case + leading/trailing whitespace insensitive)."""
    target = _name_norm(client_name)
    return [s for s in students if _name_norm(s.get("reference")) == target]


def compute_monthly_admission_counts(students: Iterable[dict]) -> dict[str, int]:
    """Map ``YYYY-MM`` → number of admissions in that month."""
    out: dict[str, int] = {}
    for s in students:
        dt = _admission_dt(s)
        if dt is None:
            continue
        key = f"{dt.year:04d}-{dt.month:02d}"
        out[key] = out.get(key, 0) + 1
    return out


def enrich_student_with_incentive(
    student: dict,
    *,
    is_staff: bool,
    incentive_amount: float,
    month_counts: dict[str, int],
) -> dict:
    """Return a UI-friendly student row with incentive eligibility flags.

    Eligibility rule: staff who admit 3+ students in a calendar month become
    eligible for *all* admissions in that month (the rule the OfficeDashboard
    implements via ``mark-paid``).
    """
    dt = _admission_dt(student)
    month_key = f"{dt.year:04d}-{dt.month:02d}" if dt else None
    is_eligible_month = (
        is_staff and month_key is not None and month_counts.get(month_key, 0) >= 3
    )
    paid = bool(student.get("incentive_paid"))
    return {
        "id": student["id"],
        "name": student.get("name"),
        "course": student.get("course"),
        "college": student.get("college"),
        "status": student.get("status"),
        "enrollment_date": student.get("enrollment_date") or student.get("created_at"),
        "sc_out_fixed": float(student.get("sc_out_fixed") or 0),
        "incentive_eligible": bool(is_eligible_month),
        "incentive_paid": paid,
        "incentive_amount": incentive_amount if is_eligible_month else 0.0,
    }


def build_client_detail_totals(
    enriched_students: list[dict],
    transactions: list[dict],
    *,
    incentive_amount: float,
) -> dict:
    """Aggregate sc_earned / incentive / credits-debits totals from
    pre-enriched students + linked transactions."""
    eligible_count = sum(1 for s in enriched_students if s["incentive_eligible"])
    incentive_paid = round(
        sum(incentive_amount for s in enriched_students
            if s["incentive_eligible"] and s["incentive_paid"]),
        2,
    )
    incentive_earned = round(eligible_count * incentive_amount, 2)

    sc_earned = round(sum(s["sc_out_fixed"] for s in enriched_students), 2)
    total_income = round(
        sum(float(t.get("amount") or 0) for t in transactions if t.get("type") == "income"),
        2,
    )
    total_expense = round(
        sum(float(t.get("amount") or 0) for t in transactions if t.get("type") == "expense"),
        2,
    )
    return {
        "students_count": len(enriched_students),
        "sc_earned": sc_earned,
        "incentive_earned": incentive_earned,
        "incentive_paid": incentive_paid,
        "incentive_pending": round(incentive_earned - incentive_paid, 2),
        "eligible_count": eligible_count,
        "total_income": total_income,
        "total_expense": total_expense,
        "net": round(total_income - total_expense, 2),
    }

"""Pure helpers for Student fee math.

Extracted from ``routers/students.py::_summarize`` to drop function complexity
and make the SC / scholarship / adjustment math unit-testable.
"""
from __future__ import annotations

from typing import Iterable


def coerce_float(v, default: float = 0.0) -> float:
    """Best-effort float coercion. Returns ``default`` for None / bad strings."""
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def fees_plan_total(fees_plan: dict | None) -> tuple[float, float]:
    """Return ``(total_after_scholarship, scholarship_amount)`` from a fees_plan."""
    fp = fees_plan or {}
    raw_years = sum(coerce_float(fp.get(k)) for k in ("year_1", "year_2", "year_3", "year_4"))
    scholarship = max(0.0, coerce_float(fp.get("scholarship_amount"))) if fp.get("has_scholarship") else 0.0
    return round(raw_years - scholarship, 2), round(scholarship, 2)


def sum_sc_adjusted(payments: Iterable[dict]) -> float:
    """Total of all ``sc_adjusted`` adjustments across the given payments."""
    total = 0.0
    for p in payments:
        for adj in p.get("adjustments") or []:
            if adj.get("kind") == "sc_adjusted":
                total += coerce_float(adj.get("amount"))
    return round(total, 2)


def compute_summary(student: dict) -> dict:
    """Compute summary fields for a student doc.

    Pure: takes the (already legacy-normalized) student doc and returns a dict
    with the new fields. Mirrors the shape ``routers/students.py::_summarize``
    used to assign inline.
    """
    schedules = student.get("schedules") or []
    payments = student.get("payments") or []

    scheduled_total = round(sum(coerce_float(x.get("amount")) for x in schedules), 2)
    collected_total = round(sum(coerce_float(x.get("amount")) for x in payments), 2)
    sc_fixed = coerce_float(student.get("sc_out_fixed"))

    total_fees, scholarship_amount = fees_plan_total(student.get("fees_plan"))
    sc_adjusted_total = sum_sc_adjusted(payments)
    sc_earned_effective = round(max(0.0, sc_fixed - scholarship_amount), 2)
    balance_vs_sc = round(sc_earned_effective - sc_adjusted_total, 2)

    return {
        "scheduled_total": scheduled_total,
        "collected_total": collected_total,
        "scholarship_amount": scholarship_amount,
        "sc_adjusted_total": sc_adjusted_total,
        "sc_earned_effective": sc_earned_effective,
        "balance_vs_scheduled": round(scheduled_total - collected_total, 2),
        "balance_vs_sc": balance_vs_sc,
        "fees_plan_total": total_fees,
    }

"""Pure helpers to distribute campaign leads across employees.

Three methods:
  - equal      : round-robin every lead across the selected employees.
  - count      : assign a fixed number of leads to each employee (in order),
                 leaving any surplus leads unassigned.
  - percentage : split leads by percentage per employee; rounding remainder
                 goes to the employees with the largest fractional shares.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple


def distribute(
    lead_ids: List[str],
    method: str,
    employee_ids: List[str],
    counts: Optional[Dict[str, int]] = None,
    percentages: Optional[Dict[str, float]] = None,
) -> List[Tuple[str, str]]:
    """Return a list of (lead_id, employee_id) assignments."""
    leads = list(lead_ids)
    n = len(leads)
    emps = [e for e in (employee_ids or [])]
    if n == 0 or not emps:
        return []

    assignments: List[Tuple[str, str]] = []

    if method == "equal":
        for i, lid in enumerate(leads):
            assignments.append((lid, emps[i % len(emps)]))
        return assignments

    if method == "count":
        idx = 0
        counts = counts or {}
        for emp in emps:
            take = max(0, int(counts.get(emp, 0)))
            for lid in leads[idx: idx + take]:
                assignments.append((lid, emp))
            idx += take
            if idx >= n:
                break
        return assignments

    if method == "percentage":
        pcts = percentages or {}
        raw = {emp: (float(pcts.get(emp, 0)) / 100.0) * n for emp in emps}
        base = {emp: int(raw[emp]) for emp in emps}
        remainder = n - sum(base.values())
        if remainder > 0:
            order = sorted(emps, key=lambda e: raw[e] - int(raw[e]), reverse=True)
            i = 0
            while remainder > 0 and order:
                base[order[i % len(order)]] += 1
                remainder -= 1
                i += 1
        idx = 0
        for emp in emps:
            take = base[emp]
            for lid in leads[idx: idx + take]:
                assignments.append((lid, emp))
            idx += take
            if idx >= n:
                break
        return assignments

    raise ValueError(f"Unknown distribution method: {method}")

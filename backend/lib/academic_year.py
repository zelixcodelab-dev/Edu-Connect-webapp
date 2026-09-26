"""Academic-year filtering helpers.

Per product decision, an academic year runs January → December, so the
"academic year" is simply the calendar year (label = the year number).

A year filter is applied by constraining a document's primary date field to
``[YYYY-01-01, (YYYY+1)-01-01)``. All stored dates are ISO strings
("YYYY-MM-DD" or full ISO datetimes), so lexical string comparison is correct.

When ``year`` is None (the "All years" option) every helper degrades to a
no-op, so existing behaviour is preserved untouched.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from db import db


def current_year() -> int:
    return datetime.now(timezone.utc).year


def year_bounds(year: Optional[int]) -> Optional[tuple[str, str]]:
    if year is None:
        return None
    try:
        y = int(year)
    except (TypeError, ValueError):
        return None
    return (f"{y:04d}-01-01", f"{y + 1:04d}-01-01")


def date_filter(field: str, year: Optional[int]) -> dict:
    """Mongo fragment restricting ``field`` to the given calendar year."""
    b = year_bounds(year)
    if not b:
        return {}
    return {field: {"$gte": b[0], "$lt": b[1]}}


def with_year(base: dict, field: str, year: Optional[int]) -> dict:
    """Combine an existing query ``base`` with a year filter on ``field``.
    Uses ``$and`` so it never clobbers an existing constraint on the field."""
    f = date_filter(field, year)
    if not f:
        return base
    if not base:
        return f
    return {"$and": [base, f]}


def in_year(value: Optional[str], year: Optional[int]) -> bool:
    """True when the ISO date string ``value`` falls in the calendar ``year``.
    When ``year`` is None every value passes (no filtering)."""
    b = year_bounds(year)
    if not b:
        return True
    if not value:
        return False
    s = str(value)
    return b[0] <= s < b[1]


async def available_years() -> list[int]:
    """Distinct calendar years present across the app's dated collections,
    newest first, always including the current year."""
    years: set[int] = set()
    sources = [
        ("transactions", "date"),
        ("students", "enrollment_date"),
        ("students", "created_at"),
        ("leads", "created_at"),
        ("invoices", "issue_date"),
        ("clients", "created_at"),
    ]
    for coll, field in sources:
        try:
            vals = await db[coll].distinct(field)
        except Exception:
            continue
        for v in vals:
            s = str(v or "")
            if len(s) >= 4 and s[:4].isdigit():
                years.add(int(s[:4]))
    years.add(current_year())
    return sorted(years, reverse=True)

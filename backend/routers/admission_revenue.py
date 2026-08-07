"""Admission Revenue Dashboard — SUPER ADMIN ONLY.

Aggregates the confidential per-college service-charge (SC) revenue across
all enrolled students within a given Indian financial year (Apr → Mar).

Revenue per admission = (per-student override) OR (college.sc_rates[course])
When neither is available the admission is counted but contributes 0.

The endpoint returns a 3-tier breakdown of the SAME cohort of enrolled
students, keyed off how "confirmed" the revenue is:

  - **committed** : student.status ∈ {enrolled, completed}
  - **accrued**   : committed + at least one recorded payment
  - **confirmed** : student.status == "completed" OR the full scheduled fees
                    have been collected (collected_total >= scheduled_total)

Also returned:
  - by_college — [{college, count, amount}], top-first
  - by_client   — [{client, office, count, amount, sc_out, net}], top-first

**PIN gate (per super-admin, per user_id)**
The page itself is protected by a 4-digit PIN each super admin sets once.
The PIN is stored as a bcrypt hash on the users doc (``admission_revenue_pin_hash``).
Brute-force protection locks out for 5 minutes after 5 wrong attempts.
Endpoints: ``/pin-status``, ``/pin/set``, ``/pin/verify``, ``/pin/change``.
"""
from __future__ import annotations

import time
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db import db
from auth_lib import get_current_user, hash_password, verify_password
from lib.student_math import compute_summary


router = APIRouter(prefix="/api/admission-revenue", tags=["admission-revenue"])


ENROLLED_STATUSES = ("enrolled", "completed")


def _current_fy_label(today: Optional[date] = None) -> str:
    """Return the current Indian financial year in 'YYYY-YY' form (Apr → Mar)."""
    d = today or date.today()
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def _parse_fy(label: str) -> tuple[str, str]:
    """Turn ``'2025-26'`` into ISO-date bounds ``('2025-04-01', '2026-04-01')``
    (upper bound is exclusive). Also accepts a bare ``'2025'`` for the FY
    that starts in that calendar year."""
    label = (label or "").strip()
    if "-" in label:
        start_str, _ = label.split("-", 1)
    else:
        start_str = label
    try:
        start_year = int(start_str)
    except ValueError:
        raise HTTPException(400, f"Invalid financial year: {label!r}")
    return (f"{start_year}-04-01", f"{start_year + 1}-04-01")


def _student_fy_date(s: dict) -> Optional[str]:
    """Best-effort admission date for FY bucketing. Prefer explicit
    enrollment_date, fall back to created_at (ISO 8601 in the DB)."""
    d = s.get("enrollment_date")
    if d:
        # enrollment_date is stored as 'YYYY-MM-DD' — good enough.
        return str(d)[:10]
    c = s.get("created_at")
    if c:
        return str(c)[:10]
    return None


def _sc_for_student(s: dict, college_rates: dict[str, dict[str, float]]) -> float:
    """Resolve the SC revenue attributed to a single admission.
    Priority: per-student override > college.sc_rates[course] > 0."""
    override = s.get("sc_from_college_override")
    if override is not None:
        try:
            return round(max(0.0, float(override)), 2)
        except (TypeError, ValueError):
            pass
    college = (s.get("college") or "").strip()
    course = (s.get("course") or "").strip()
    if not college or not course:
        return 0.0
    rates = college_rates.get(college.lower())
    if not rates:
        return 0.0
    # Case-insensitive course match.
    for k, v in rates.items():
        if (k or "").strip().lower() == course.lower():
            try:
                return round(max(0.0, float(v)), 2)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def _is_fully_paid(s: dict) -> bool:
    """True when the student's collected total meets or exceeds the scheduled
    total. Reuses the canonical student_math summary so the definition
    matches the rest of the app."""
    try:
        summary = compute_summary(s)
    except Exception:
        return False
    scheduled = float(summary.get("scheduled_total") or 0)
    collected = float(summary.get("collected_total") or 0)
    if scheduled <= 0:
        return False
    return collected + 0.5 >= scheduled  # 50-paise tolerance


@router.get("/summary")
async def revenue_summary(
    fy: Optional[str] = Query(default=None, description="Financial year label, e.g. '2025-26'. Defaults to the current FY."),
    user: dict = Depends(get_current_user),
) -> dict:
    """Super-admin-only. Returns the tiered admission revenue for the given
    financial year (Apr → Mar) plus a per-college / per-course breakdown."""
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")

    fy_label = (fy or _current_fy_label()).strip()
    start_iso, end_iso = _parse_fy(fy_label)

    # Load all confidential college SC rates in ONE query so per-student lookup
    # stays O(1). Key by lower-cased name for case-insensitive matching.
    colleges = await db.colleges.find(
        {}, {"_id": 0, "name": 1, "sc_rates": 1}
    ).to_list(5000)
    college_rates: dict[str, dict[str, float]] = {}
    for c in colleges:
        rates = c.get("sc_rates") or {}
        if rates:
            college_rates[(c.get("name") or "").strip().lower()] = rates

    # Fetch enrolled students within the FY. We filter in Python for the
    # date bucketing so an FY that spans two calendar years handles the
    # created_at fallback cleanly (some rows have no enrollment_date).
    cursor = db.students.find(
        {"status": {"$in": list(ENROLLED_STATUSES)}}, {"_id": 0}
    )
    students = await cursor.to_list(10000)

    tiers = {
        "committed": {"count": 0, "amount": 0.0, "sc_out": 0.0, "net": 0.0},
        "accrued":   {"count": 0, "amount": 0.0, "sc_out": 0.0, "net": 0.0},
        "confirmed": {"count": 0, "amount": 0.0, "sc_out": 0.0, "net": 0.0},
    }
    by_college: dict[str, dict] = {}
    by_client: dict[tuple, dict] = {}

    # Lookup of catalogue clients by lower-cased name — attaches `client_type`
    # ("associate_consultant" / "sub_agent_associate" / "km_blr_office" / …)
    # and optionally a canonical home_office so we can group cleanly by office.
    clients = await db.clients.find(
        {}, {"_id": 0, "name": 1, "client_type": 1, "home_office": 1}
    ).to_list(5000)
    client_meta: dict[str, dict] = {}
    for c in clients:
        key = (c.get("name") or "").strip().lower()
        if key:
            client_meta[key] = {
                "client_type": c.get("client_type"),
                "home_office": c.get("home_office"),
            }

    for s in students:
        fy_date = _student_fy_date(s)
        if not fy_date or not (start_iso <= fy_date < end_iso):
            continue

        amount = _sc_for_student(s, college_rates)
        # SC paid OUT to the referring sub-agent / consultant for this
        # admission — comes from the canonical student_math summary.
        try:
            summary = compute_summary(s)
        except Exception:
            summary = {"sc_earned_effective": 0.0, "scheduled_total": 0.0, "collected_total": 0.0}
        sc_out = float(summary.get("sc_earned_effective") or 0)
        net = round(amount - sc_out, 2)

        has_payment = bool(s.get("payments"))
        is_completed = (s.get("status") or "").lower() == "completed"
        scheduled = float(summary.get("scheduled_total") or 0)
        collected = float(summary.get("collected_total") or 0)
        fully_paid = is_completed or (scheduled > 0 and collected + 0.5 >= scheduled)

        for tier_key, condition in (
            ("committed", True),
            ("accrued", has_payment),
            ("confirmed", fully_paid),
        ):
            if not condition:
                continue
            t = tiers[tier_key]
            t["count"] += 1
            t["amount"] += amount
            t["sc_out"] += sc_out
            t["net"] += net

        college_name = (s.get("college") or "—").strip() or "—"
        # Client / referrer name — falls back to the free-text `reference`,
        # then to "Direct" when a student was enrolled without a sub-agent.
        client_name = (
            (s.get("referrer_name") or "").strip()
            or (s.get("reference") or "").strip()
            or "Direct"
        )
        # Prefer the student's home_office; when that's blank (many legacy
        # rows), fall back to the client's catalogue-recorded office. That
        # way rows still land under a real office group instead of "No office".
        student_office = (s.get("home_office") or "").strip()
        client_meta_row = client_meta.get(client_name.lower(), {})
        client_type = client_meta_row.get("client_type")
        client_home_office = (client_meta_row.get("home_office") or "").strip()
        office = student_office or client_home_office or "—"

        bc = by_college.setdefault(
            college_name,
            {"college": college_name, "count": 0, "amount": 0.0, "sc_out": 0.0, "net": 0.0},
        )
        bc["count"] += 1
        bc["amount"] += amount
        bc["sc_out"] += sc_out
        bc["net"] += net

        client_key = (client_name.lower(), office)
        bcl = by_client.setdefault(
            client_key,
            {
                "client": client_name,
                "office": office,
                "client_type": client_type,
                "count": 0,
                "amount": 0.0,
                "sc_out": 0.0,
                "net": 0.0,
            },
        )
        bcl["count"] += 1
        bcl["amount"] += amount
        bcl["sc_out"] += sc_out
        bcl["net"] += net

    # Round outputs.
    for t in tiers.values():
        t["amount"] = round(t["amount"], 2)
        t["sc_out"] = round(t["sc_out"], 2)
        t["net"] = round(t["net"], 2)
    by_college_list = sorted(
        (
            {**v, "amount": round(v["amount"], 2), "sc_out": round(v["sc_out"], 2), "net": round(v["net"], 2)}
            for v in by_college.values()
        ),
        key=lambda r: (-r["net"], -r["amount"], r["college"]),
    )
    by_client_list = sorted(
        (
            {**v, "amount": round(v["amount"], 2), "sc_out": round(v["sc_out"], 2), "net": round(v["net"], 2)}
            for v in by_client.values()
        ),
        key=lambda r: (-r["net"], -r["count"], r["client"]),
    )

    return {
        "fy": fy_label,
        "range": {"start": start_iso, "end": end_iso},
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "tiers": tiers,
        "by_college": by_college_list,
        "by_client": by_client_list,
    }


@router.get("/fy-options")
async def fy_options(user: dict = Depends(get_current_user)) -> dict:
    """Return the list of financial years the super admin can pick from —
    based on the earliest & latest enrollment/created dates on record. Always
    includes the current FY."""
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    cur = _current_fy_label()
    # Cheap min/max scan — enrollment_date first, then created_at as fallback.
    dates = await db.students.find(
        {"status": {"$in": list(ENROLLED_STATUSES)}},
        {"_id": 0, "enrollment_date": 1, "created_at": 1},
    ).to_list(20000)
    years: set[int] = set()
    for row in dates:
        d = row.get("enrollment_date") or row.get("created_at")
        if not d:
            continue
        try:
            year = int(str(d)[:4])
            month = int(str(d)[5:7]) if len(str(d)) >= 7 else 4
        except ValueError:
            continue
        start = year if month >= 4 else year - 1
        years.add(start)
    # Include current FY start so the dropdown always has an option.
    cur_start = int(cur.split("-")[0])
    years.add(cur_start)
    labels = [f"{y}-{str(y+1)[-2:]}" for y in sorted(years, reverse=True)]
    return {"options": labels, "current": cur}



@router.get("/college-courses")
async def college_courses(
    college: str = Query(..., description="Exact college name (case-insensitive)"),
    fy: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
) -> dict:
    """Course-wise revenue drilldown for a single college in a given FY.
    Super-admin only. Powers the click-through from the By-College table."""
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")

    fy_label = (fy or _current_fy_label()).strip()
    start_iso, end_iso = _parse_fy(fy_label)
    college_needle = (college or "").strip()
    if not college_needle:
        raise HTTPException(400, "college is required")

    # Load ONLY the requested college's confidential rates.
    col_doc = await db.colleges.find_one(
        {"name_lower": college_needle.lower()},
        {"_id": 0, "name": 1, "sc_rates": 1},
    )
    college_rates = {college_needle.lower(): (col_doc.get("sc_rates") or {})} if col_doc else {}
    canonical_name = (col_doc.get("name") if col_doc else college_needle).strip()

    # Load enrolled/completed students whose college matches — done in Python
    # because case-insensitivity + a Mongo regex would need proper escaping.
    students = await db.students.find(
        {"status": {"$in": list(ENROLLED_STATUSES)}, "college": {"$nin": [None, ""]}},
        {"_id": 0},
    ).to_list(20000)

    by_course: dict[str, dict] = {}
    grand = {"count": 0, "amount": 0.0, "sc_out": 0.0, "net": 0.0}

    for s in students:
        if (s.get("college") or "").strip().lower() != college_needle.lower():
            continue
        fy_date = _student_fy_date(s)
        if not fy_date or not (start_iso <= fy_date < end_iso):
            continue

        amount = _sc_for_student(
            {**s, "college": college_needle},  # ensure lookup uses the same key
            college_rates,
        )
        try:
            summary = compute_summary(s)
        except Exception:
            summary = {"sc_earned_effective": 0.0}
        sc_out = float(summary.get("sc_earned_effective") or 0)
        net = round(amount - sc_out, 2)

        course = (s.get("course") or "—").strip() or "—"
        row = by_course.setdefault(
            course,
            {"course": course, "count": 0, "amount": 0.0, "sc_out": 0.0, "net": 0.0},
        )
        row["count"] += 1
        row["amount"] += amount
        row["sc_out"] += sc_out
        row["net"] += net

        grand["count"] += 1
        grand["amount"] += amount
        grand["sc_out"] += sc_out
        grand["net"] += net

    courses_list = sorted(
        (
            {**v, "amount": round(v["amount"], 2), "sc_out": round(v["sc_out"], 2), "net": round(v["net"], 2)}
            for v in by_course.values()
        ),
        key=lambda r: (-r["net"], -r["count"], r["course"]),
    )
    grand["amount"] = round(grand["amount"], 2)
    grand["sc_out"] = round(grand["sc_out"], 2)
    grand["net"] = round(grand["net"], 2)
    return {
        "college": canonical_name,
        "fy": fy_label,
        "range": {"start": start_iso, "end": end_iso},
        "totals": grand,
        "courses": courses_list,
    }




# ============================================================================
# 4-digit PIN gate — protects the Admission Revenue page from shoulder-surfing.
# ============================================================================

PIN_LOCKOUT_SECONDS = 5 * 60          # 5-minute cool-down
PIN_MAX_ATTEMPTS = 5                  # wrong-attempt threshold
PIN_HASH_FIELD = "admission_revenue_pin_hash"
PIN_FAILS_FIELD = "admission_revenue_pin_fails"
PIN_LOCK_UNTIL_FIELD = "admission_revenue_pin_lockout_until"


def _validate_pin_format(pin: str) -> str:
    p = (pin or "").strip()
    if len(p) != 4 or not p.isdigit():
        raise HTTPException(400, "PIN must be exactly 4 digits")
    return p


def _now_epoch() -> float:
    return time.time()


# ── Pydantic models ─────────────────────────────────────────────────────────

class PinSetIn(BaseModel):
    pin: str = Field(min_length=4, max_length=4)
    # When the user already has a PIN set, they must provide the current
    # one to change it. First-time set omits this.
    current_pin: Optional[str] = None


class PinVerifyIn(BaseModel):
    pin: str = Field(min_length=4, max_length=4)


class PinResetWithPasswordIn(BaseModel):
    """Recover from a forgotten PIN by re-authenticating with the login
    password. Also used to clear a lockout without waiting out the timer."""
    password: str = Field(min_length=1)
    new_pin: str = Field(min_length=4, max_length=4)


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/pin/reset-with-password")
async def reset_pin_with_password(
    payload: PinResetWithPasswordIn,
    user: dict = Depends(get_current_user),
) -> dict:
    """Rotate the Admission Revenue PIN using the caller's login password.
    Also clears any active lockout + fail counter."""
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    new_pin = _validate_pin_format(payload.new_pin)

    row = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 1}) or {}
    stored = row.get("password_hash")
    if not stored or not verify_password(payload.password, stored):
        raise HTTPException(401, "Wrong login password")

    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {PIN_HASH_FIELD: hash_password(new_pin), PIN_FAILS_FIELD: 0},
            "$unset": {PIN_LOCK_UNTIL_FIELD: ""},
        },
    )
    return {"ok": True}


@router.post("/pin/remove")
async def remove_pin(
    payload: PinVerifyIn,
    user: dict = Depends(get_current_user),
) -> dict:
    """Delete the caller's Admission Revenue PIN entirely. Requires the
    current PIN so an unattended session can't silently disable the lock.
    Next visit to the page will show the first-time setup screen again."""
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")

    row = await db.users.find_one({"id": user["id"]}, {"_id": 0, PIN_HASH_FIELD: 1}) or {}
    stored = row.get(PIN_HASH_FIELD)
    if not stored:
        raise HTTPException(400, "No PIN set")
    if not verify_password(payload.pin, stored):
        raise HTTPException(401, "Wrong PIN")

    await db.users.update_one(
        {"id": user["id"]},
        {"$unset": {PIN_HASH_FIELD: "", PIN_FAILS_FIELD: "", PIN_LOCK_UNTIL_FIELD: ""}},
    )
    return {"ok": True}


@router.get("/pin-status")
async def pin_status(user: dict = Depends(get_current_user)) -> dict:
    """Whether the caller has an Admission Revenue PIN set, plus any active
    lockout window. Super admin only."""
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    row = await db.users.find_one(
        {"id": user["id"]},
        {"_id": 0, PIN_HASH_FIELD: 1, PIN_LOCK_UNTIL_FIELD: 1},
    ) or {}
    lock_until = float(row.get(PIN_LOCK_UNTIL_FIELD) or 0)
    now = _now_epoch()
    locked = lock_until > now
    return {
        "is_set": bool(row.get(PIN_HASH_FIELD)),
        "locked": locked,
        "seconds_remaining": int(lock_until - now) if locked else 0,
    }


@router.post("/pin/set")
async def set_pin(payload: PinSetIn, user: dict = Depends(get_current_user)) -> dict:
    """Create or rotate the Admission Revenue PIN for the caller. When a PIN
    already exists, ``current_pin`` is required (defense-in-depth against
    someone hijacking a briefly-unlocked session)."""
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    new_pin = _validate_pin_format(payload.pin)

    row = await db.users.find_one({"id": user["id"]}, {"_id": 0, PIN_HASH_FIELD: 1}) or {}
    existing_hash = row.get(PIN_HASH_FIELD)
    if existing_hash:
        if not payload.current_pin:
            raise HTTPException(400, "Current PIN is required to change the PIN")
        if not verify_password(payload.current_pin, existing_hash):
            raise HTTPException(401, "Current PIN is wrong")

    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {PIN_HASH_FIELD: hash_password(new_pin), PIN_FAILS_FIELD: 0},
            "$unset": {PIN_LOCK_UNTIL_FIELD: ""},
        },
    )
    return {"ok": True}


@router.post("/pin/verify")
async def verify_pin(payload: PinVerifyIn, user: dict = Depends(get_current_user)) -> dict:
    """Verify the 4-digit PIN. On success returns ``{"ok": True}``; on 5+
    wrong attempts locks the caller out for 5 minutes with HTTP 429."""
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    row = await db.users.find_one(
        {"id": user["id"]},
        {"_id": 0, PIN_HASH_FIELD: 1, PIN_FAILS_FIELD: 1, PIN_LOCK_UNTIL_FIELD: 1},
    ) or {}
    stored = row.get(PIN_HASH_FIELD)
    if not stored:
        raise HTTPException(400, "No PIN set yet")

    now = _now_epoch()
    lock_until = float(row.get(PIN_LOCK_UNTIL_FIELD) or 0)
    if lock_until > now:
        raise HTTPException(
            429,
            f"Too many wrong attempts. Try again in {int(lock_until - now)}s",
        )

    if not verify_password(payload.pin, stored):
        fails = int(row.get(PIN_FAILS_FIELD) or 0) + 1
        update: dict = {PIN_FAILS_FIELD: fails}
        if fails >= PIN_MAX_ATTEMPTS:
            update[PIN_LOCK_UNTIL_FIELD] = now + PIN_LOCKOUT_SECONDS
            update[PIN_FAILS_FIELD] = 0  # reset counter, lockout owns the state
        await db.users.update_one({"id": user["id"]}, {"$set": update})
        remaining = max(0, PIN_MAX_ATTEMPTS - fails)
        if fails >= PIN_MAX_ATTEMPTS:
            raise HTTPException(
                429,
                f"Too many wrong attempts. Locked for {PIN_LOCKOUT_SECONDS // 60} minutes.",
            )
        raise HTTPException(401, f"Wrong PIN. {remaining} attempt(s) left.")

    # Success — reset counters and clear lockout.
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {PIN_FAILS_FIELD: 0}, "$unset": {PIN_LOCK_UNTIL_FIELD: ""}},
    )
    return {"ok": True}

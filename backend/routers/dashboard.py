"""Dashboard summary / cashflow / expense-by-category endpoints."""
from typing import Optional
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends

from db import db
from auth_lib import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
async def summary(
    user: dict = Depends(get_current_user),
    start: Optional[str] = None,
    end: Optional[str] = None,
    year: Optional[int] = None,
):
    user_id = user["id"]
    now = datetime.now(timezone.utc)
    # A selected academic (calendar) year overrides the ad-hoc period window.
    if year is not None:
        period_start = f"{int(year):04d}-01-01"
        period_end = f"{int(year):04d}-12-31"
    else:
        period_start = start or now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).date().isoformat()
        period_end = end

    accounts = await db.accounts.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    total_opening = sum(a.get("opening_balance", 0) for a in accounts)

    # All-time totals — scoped to the selected year when one is chosen.
    all_match: dict = {"user_id": user_id}
    if year is not None:
        all_match["date"] = {"$gte": period_start, "$lt": f"{int(year) + 1:04d}-01-01"}
    agg_all = await db.transactions.aggregate([
        {"$match": all_match},
        {"$group": {"_id": "$type", "total": {"$sum": "$amount"}}},
    ]).to_list(10)
    all_income = sum(x["total"] for x in agg_all if x["_id"] == "income")
    all_expense = sum(x["total"] for x in agg_all if x["_id"] == "expense")
    total_balance = round(total_opening + all_income - all_expense, 2)

    period_match = {"$gte": period_start}
    if period_end:
        period_match["$lte"] = period_end
    agg_month = await db.transactions.aggregate([
        {"$match": {"user_id": user_id, "date": period_match}},
        {"$group": {"_id": "$type", "total": {"$sum": "$amount"}}},
    ]).to_list(10)
    month_income = round(sum(x["total"] for x in agg_month if x["_id"] == "income"), 2)
    month_expense = round(sum(x["total"] for x in agg_month if x["_id"] == "expense"), 2)

    outstanding_match: dict = {"user_id": user_id, "status": {"$in": ["sent", "overdue"]}}
    if year is not None:
        outstanding_match["issue_date"] = {"$gte": period_start, "$lt": f"{int(year) + 1:04d}-01-01"}
    outstanding_agg = await db.invoices.aggregate([
        {"$match": outstanding_match},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}},
    ]).to_list(1)
    outstanding = round(outstanding_agg[0]["total"], 2) if outstanding_agg else 0.0

    return {
        "total_balance": total_balance,
        "month_income": month_income,
        "month_expense": month_expense,
        "month_cashflow": round(month_income - month_expense, 2),
        "outstanding_invoices": outstanding,
        "currency": user.get("currency", "USD"),
        "period_start": period_start,
        "period_end": period_end,
    }


@router.get("/cashflow")
async def cashflow(user: dict = Depends(get_current_user), months: int = 6, year: Optional[int] = None):
    user_id = user["id"]
    now = datetime.now(timezone.utc)
    buckets = []
    if year is not None:
        # Show every month of the selected calendar year (Jan → Dec).
        for m in range(1, 13):
            buckets.append((int(year), m))
    else:
        y, month = now.year, now.month
        for _ in range(months):
            buckets.append((y, month))
            month -= 1
            if month == 0:
                month = 12
                y -= 1
        buckets.reverse()

    result = []
    for y, m in buckets:
        start = datetime(y, m, 1, tzinfo=timezone.utc).date().isoformat()
        end = (datetime(y + 1, 1, 1, tzinfo=timezone.utc) if m == 12
               else datetime(y, m + 1, 1, tzinfo=timezone.utc)).date().isoformat()
        agg = await db.transactions.aggregate([
            {"$match": {"user_id": user_id, "date": {"$gte": start, "$lt": end}}},
            {"$group": {"_id": "$type", "total": {"$sum": "$amount"}}},
        ]).to_list(10)
        income = round(sum(x["total"] for x in agg if x["_id"] == "income"), 2)
        expense = round(sum(x["total"] for x in agg if x["_id"] == "expense"), 2)
        label = datetime(y, m, 1).strftime("%b")
        result.append({"month": label, "income": income, "expense": expense})
    return result


@router.get("/expense-by-category")
async def expense_by_category(
    user: dict = Depends(get_current_user),
    start: Optional[str] = None,
    end: Optional[str] = None,
    year: Optional[int] = None,
):
    user_id = user["id"]
    now = datetime.now(timezone.utc)
    if year is not None:
        date_match = {"$gte": f"{int(year):04d}-01-01", "$lt": f"{int(year) + 1:04d}-01-01"}
    else:
        period_start = start or now.replace(day=1).date().isoformat()
        date_match = {"$gte": period_start}
        if end:
            date_match["$lte"] = end
    agg = await db.transactions.aggregate([
        {"$match": {"user_id": user_id, "type": "expense", "date": date_match}},
        {"$group": {"_id": "$category_id", "total": {"$sum": "$amount"}}},
    ]).to_list(100)
    cats = await db.categories.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    cat_map = {c["id"]: c for c in cats}
    out = []
    for row in agg:
        c = cat_map.get(row["_id"])
        out.append({
            "category_id": row["_id"],
            "name": c["name"] if c else "Uncategorized",
            "color": c["color"] if c else "#a8a29e",
            "total": round(row["total"], 2),
        })
    out.sort(key=lambda x: x["total"], reverse=True)
    return out



# ---------- Office Admin dashboard ----------
def _window_bounds(window: str, now: datetime):
    """Return (start_iso, end_iso) for the requested window."""
    if window == "week":
        start = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    elif window == "year":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:  # month (default)
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start, now


def _student_admission_dt(student: dict) -> datetime:
    """Best-effort admission date — enrollment_date if present, else created_at."""
    val = student.get("enrollment_date") or student.get("created_at")
    if not val:
        return datetime.now(timezone.utc)
    try:
        # enrollment_date might be 'YYYY-MM-DD'; created_at is ISO with tz
        if len(val) == 10:
            return datetime.strptime(val, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


def _days_until_birthday(dob_iso: str, today: datetime) -> int:
    """Days until the next occurrence of this birthday (0..365)."""
    try:
        dob = datetime.strptime(dob_iso[:10], "%Y-%m-%d")
    except Exception:
        return 999
    this_year_bday = dob.replace(year=today.year)
    if this_year_bday.date() < today.date():
        this_year_bday = dob.replace(year=today.year + 1)
    return (this_year_bday.date() - today.date()).days


@router.get("/office-admin")
async def office_admin_dashboard(
    user: dict = Depends(get_current_user),
    window: str = "month",
    office: Optional[str] = None,
) -> dict:
    """Aggregated view for office admins (or super admin in office_admin shoes).

    - admissions: total students enrolled in window (any reference)
    - staff_breakdown: per-staff admissions + eligibility + incentive_earned/paid/pending
    - upcoming_birthdays: staff with DOB within next 30 days
    - totals: incentive_earned, incentive_paid, incentive_pending
    """
    from lib.office_dashboard import (
        build_staff_breakdown,
        compute_staff_month_counts,
        count_admissions_in_window,
        upcoming_birthdays_30d,
    )

    if window not in ("week", "month", "year"):
        window = "month"
    now = datetime.now(timezone.utc)
    win_start, win_end = _window_bounds(window, now)

    # Super admin can inspect a specific office's overview by passing ?office=
    # — aggregates across every user (office admins + staff) in that office.
    if user.get("role") == "super_admin" and office:
        owner_users = await db.users.find({"office": office}, {"_id": 0, "id": 1}).to_list(1000)
        owner_ids = [u["id"] for u in owner_users]
        staff_query = {"user_id": {"$in": owner_ids}, "client_type": "staff"}
        students_query = {"user_id": {"$in": owner_ids}}
        office_label = office
    else:
        user_id = user["id"]
        staff_query = {"user_id": user_id, "client_type": "staff"}
        students_query = {"user_id": user_id}
        office_label = user.get("office")

    staffs = await db.clients.find(staff_query, {"_id": 0}).to_list(500)
    students = await db.students.find(students_query, {"_id": 0}).to_list(2000)

    total_admissions_in_window = count_admissions_in_window(students, win_start, win_end)
    month_counts = compute_staff_month_counts(students)
    breakdown = build_staff_breakdown(
        students, staffs,
        win_start=win_start, win_end=win_end,
        month_counts=month_counts,
    )
    upcoming = upcoming_birthdays_30d(staffs, now)

    return {
        "window": window,
        "window_start": win_start.isoformat(),
        "window_end": win_end.isoformat(),
        "office": office_label,
        "totals": {
            "admissions": total_admissions_in_window,
            "staff_attributed_admissions": sum(r["admissions_count"] for r in breakdown),
            "eligible_admissions": sum(r["eligible_count"] for r in breakdown),
            "staff_count": len(staffs),
            "incentive_earned": round(sum(r["incentive_earned"] for r in breakdown), 2),
            "incentive_paid": round(sum(r["incentive_paid"] for r in breakdown), 2),
            "incentive_pending": round(sum(r["incentive_pending"] for r in breakdown), 2),
        },
        "staff_breakdown": breakdown,
        "upcoming_birthdays": upcoming,
    }


# ─────────── Overview: trending highlights + team strip (company admins) ───────────
from collections import Counter  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from lib.academic_year import in_year  # noqa: E402

CLOSED = {"enrolled", "completed"}
ADMIN_ROLES = {"super_admin", "office_admin"}


def _admin_only(user: dict) -> None:
    if user.get("role") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")


def _top(counter: Counter, people: dict) -> Optional[dict]:
    if not counter:
        return None
    name, count = counter.most_common(1)[0]
    return {"name": name, "count": count, "faces": people.get(name, [])[:4]}


@router.get("/trending")
async def trending(user: dict = Depends(get_current_user), year: Optional[int] = None):
    """Top course, top college and best closer (staff or associate) for the year."""
    _admin_only(user)
    courses, colleges, closers = Counter(), Counter(), Counter()
    course_people, college_people = {}, {}
    async for s in db.students.find({"status": {"$in": list(CLOSED)}},
                                    {"_id": 0, "name": 1, "course": 1, "college": 1, "user_id": 1, "enrollment_date": 1, "created_at": 1}):
        if not in_year(s.get("enrollment_date") or s.get("created_at"), year):
            continue
        for key, counter, people in (("course", courses, course_people), ("college", colleges, college_people)):
            val = (s.get(key) or "").strip()
            if val:
                counter[val] += 1
                people.setdefault(val, []).append(s.get("name") or "")
        if s.get("user_id"):
            closers[s["user_id"]] += 1
    best = None
    if closers:
        uid, count = closers.most_common(1)[0]
        u = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "name": 1, "role": 1, "linked_client_id": 1}) or {"id": uid, "name": "Former user"}
        from routers.auth import _resolve_user_photo_url
        best = {"id": uid, "name": u.get("name"), "role": "associate" if u.get("role") == "user" else u.get("role"),
                "count": count, "photo_url": await _resolve_user_photo_url(u) if u.get("role") else ""}
    return {"top_course": _top(courses, course_people), "top_college": _top(colleges, college_people), "best_closer": best}


@router.get("/team")
async def team(user: dict = Depends(get_current_user), year: Optional[int] = None):
    """Team members (staff + admins) with photo and admissions closed this year."""
    _admin_only(user)
    from routers.auth import _resolve_user_photo_url
    closed = Counter()
    async for s in db.students.find({"status": {"$in": list(CLOSED)}}, {"_id": 0, "user_id": 1, "enrollment_date": 1, "created_at": 1}):
        if s.get("user_id") and in_year(s.get("enrollment_date") or s.get("created_at"), year):
            closed[s["user_id"]] += 1
    out = []
    async for u in db.users.find({"deleted_at": {"$in": [None, ""]}, "role": {"$in": ["super_admin", "office_admin", "staff"]}},
                                 {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "office": 1, "phone": 1, "linked_client_id": 1}).limit(60):
        u["photo_url"] = await _resolve_user_photo_url(u)
        u["admissions_closed"] = closed.get(u["id"], 0)
        u.pop("linked_client_id", None)
        out.append(u)
    out.sort(key=lambda x: (-x["admissions_closed"], x.get("name") or ""))
    return {"members": out}

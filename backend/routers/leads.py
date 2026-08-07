"""Leads CRM router.

Super Admin / Office Admin / Staff manage sales leads (prospective students):
manual + CSV bulk upload, status pipeline, assignment, scheduled follow-ups
with reminders, and a "Missed leads" view.

Scope rules:
  - super_admin  → every lead
  - office_admin → leads in their office
  - staff        → leads assigned to them
"""
from __future__ import annotations

import csv
import io
import os
import re
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from db import db
from auth_lib import get_current_user, gen_id, now_iso, require_edit
from lib.followup_slots import compute_next_slot, SLOT_MINUTES, WORK_START_HOUR, WORK_END_HOUR
from lib.whatsapp import send_visit_scheduled, send_application_link, fmt_dt_ist
from lib.activity_log import log_event
from lib.user_photo import resolve_photos_for_users
from routers.notifications import notify_users, notify_super_admins

router = APIRouter(prefix="/api/leads", tags=["leads"])

LEAD_STATUSES = (
    "new", "not_connected", "interested", "follow_up", "converted",
    "application_submitted", "admission_confirmed", "fee_paid", "completed",
    "not_turned", "lost",
)
LEAD_SOURCES = ("walk_in", "referral", "social", "website", "csv", "other")
OPEN_STATUSES = ("new", "not_connected", "interested", "follow_up")
VISIT_STATUSES = (
    "scheduled", "assigned", "picked_up", "ongoing", "confused",
    "admission_taken", "fees_paid", "admission_letter_taken", "lost",
)
# Legacy → new stage mapping applied on read + at migration time.
VISIT_STATUS_LEGACY = {"admitted": "admission_taken", "completed": "admission_letter_taken"}
CONVERTED_STATUSES = ("converted", "application_submitted", "admission_confirmed", "fee_paid", "completed")

LeadStatus = str
LeadSource = str


class LeadIn(BaseModel):
    name: str = Field(min_length=1)
    phone: Optional[str] = ""
    email: Optional[str] = ""
    course: Optional[str] = ""
    place: Optional[str] = ""
    source: str = "other"
    status: str = "new"
    assigned_to_user_id: Optional[str] = None
    next_follow_up: Optional[str] = None  # ISO datetime (UTC) or null
    notes: Optional[str] = ""


class LeadUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    course: Optional[str] = None
    place: Optional[str] = None
    source: Optional[str] = None
    status: Optional[str] = None
    assigned_to_user_id: Optional[str] = None
    next_follow_up: Optional[str] = None
    notes: Optional[str] = None
    lost_reason: Optional[str] = None


class BulkLeadActionIn(BaseModel):
    """Payload for POST /api/leads/bulk-actions."""
    ids: List[str] = Field(min_length=1)
    action: str  # "delete" | "assign" | "status" | "campaign"
    assigned_to_user_id: Optional[str] = None  # for action="assign"
    status: Optional[str] = None               # for action="status"
    campaign_id: Optional[str] = None          # for action="campaign" (null → detach)


class FollowUpIn(BaseModel):
    at: str  # scheduled ISO datetime (UTC)
    note: Optional[str] = ""
    status: Optional[str] = None  # optionally move the lead's status


class FollowUpUpdate(BaseModel):
    """Update payload for an existing follow-up entry.

    Only ``at`` and ``note`` are editable — the status transition that
    happened alongside the original follow-up is kept in ``status_history``
    for audit and can't be rewritten here (per product decision).
    """
    at: Optional[str] = None
    note: Optional[str] = None


class VisitIn(BaseModel):
    departure_at: Optional[str] = None  # ISO datetime (UTC)
    arrival_at: Optional[str] = None
    institution: Optional[str] = ""  # campus/college being visited
    travel_mode: Optional[str] = ""
    who_comes: Optional[str] = ""
    drop_point: Optional[str] = ""


class InterestedIn(BaseModel):
    parent_number: Optional[str] = ""
    alternate_number: Optional[str] = ""
    campus_visit_interested: bool = False
    visit: Optional[VisitIn] = None


class VisitUpdate(BaseModel):
    status: Optional[str] = None  # scheduled | confused | admitted | lost
    attending_admin_id: Optional[str] = None  # "" clears the assignment


class ConvertIn(BaseModel):
    city: Optional[str] = ""
    course: Optional[str] = ""
    college: Optional[str] = ""
    send_link: bool = True
    campus_visit_interested: bool = False
    visit: Optional[VisitIn] = None


# ---------- helpers ----------
def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


def _scope_filter(user: dict) -> dict:
    role = user.get("role")
    if role == "super_admin":
        return {}
    if role == "office_admin":
        return {"office": user.get("office")}
    if role == "staff":
        return {"assigned_to_user_id": user["id"]}
    return {"id": "__none__"}  # deny everyone else


def _is_missed(lead: dict, now: datetime) -> bool:
    if lead.get("status") not in OPEN_STATUSES:
        return False
    dt = _parse_dt(lead.get("next_follow_up"))
    return bool(dt and dt < now)


async def _validate_assignee(assignee_id: str, office: Optional[str], require_office: bool) -> dict:
    assignee = await db.users.find_one(
        {"id": assignee_id}, {"_id": 0, "id": 1, "name": 1, "role": 1, "office": 1}
    )
    if not assignee or assignee.get("role") not in ("staff", "office_admin"):
        raise HTTPException(400, "Assignee must be a staff member or office admin")
    if require_office and assignee.get("office") != office:
        raise HTTPException(400, "Assignee must belong to your office")
    return assignee


def _normalize_phone(raw: Optional[str]) -> str:
    """Keep only digits, drop leading country code (91 for India) so a lead
    stored as '9876543210' still matches an application submitted as '+91
    98765 43210'. Returns the last 10 digits (India assumption)."""
    if not raw:
        return ""
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


async def bump_lead_on_application(
    *,
    student_id: str,
    phone: Optional[str],
    applicant_name: Optional[str],
    has_registration_payment: bool,
    registration_amount: float = 0.0,
    system_user: Optional[dict] = None,
) -> Optional[dict]:
    """Auto-advance a matching CRM lead when its student submits the
    online application form (POST /api/public/applications).

    **Match strategy** (relaxed 2026-07-06 based on user feedback that the
    old "converted-only" gate silently dropped most real-world cases):
      * Compare phone by last-10-digits via ``_normalize_phone`` so different
        formats (`+91 …`, `-`, spaces) still map to the same lead.
      * Match ANY lead in a *pre-application* stage — i.e. status IN
        ``("new", "not_connected", "interested", "follow_up", "converted",
        "application_submitted")``. Leads already past application (fee_paid,
        completed, lost, not_turned, admission_confirmed) are LEFT ALONE.

    **Cascade**:
      * → ``application_submitted`` (always — the app was actually submitted).
      * → ``fee_paid`` (additionally, only if ``has_registration_payment`` and
        the lead is now at ``application_submitted``).

    ``status_history`` gains one entry per transition, actored as
    "System · Application submitted" (or the caller-supplied ``system_user``).
    Best-effort: never raises. Returns the updated lead or ``None`` if
    nothing matched / nothing to do.
    """
    key = _normalize_phone(phone)
    if not key:
        return None
    # Only auto-advance from pre-application statuses. Once a lead is at
    # fee_paid/completed/admission_confirmed/lost/not_turned, a new /apply
    # submission is treated as noise (probably a duplicate or resubmit).
    pre_app = ("new", "not_connected", "interested", "follow_up", "converted", "application_submitted")
    candidates = await db.leads.find(
        {"status": {"$in": list(pre_app)}},
        {"_id": 0, "id": 1, "phone": 1, "status": 1, "name": 1},
    ).to_list(2000)
    matched = None
    for c in candidates:
        if _normalize_phone(c.get("phone")) == key:
            matched = c
            break
    if not matched:
        return None
    actor = system_user or {"id": "system", "name": "System · Application submitted"}
    now = now_iso()
    events: list[dict] = []
    sets: dict = {"updated_at": now, "application_student_id": student_id}
    current = matched.get("status") or "new"

    if current != "application_submitted":
        events.append(_status_event(
            current, "application_submitted", actor,
            note=f"Application submitted by {applicant_name}" if applicant_name else "",
            metadata={"student_id": student_id},
        ))
        sets["status"] = "application_submitted"
        current = "application_submitted"

    if has_registration_payment and current == "application_submitted":
        events.append(_status_event(
            "application_submitted", "fee_paid", actor,
            note=f"Registration paid · ₹{registration_amount:,.0f}" if registration_amount else "Registration payment",
            metadata={"student_id": student_id, "amount": registration_amount},
        ))
        sets["status"] = "fee_paid"

    if not events:
        return None
    await db.leads.update_one(
        {"id": matched["id"]},
        {"$set": sets, "$push": {"status_history": {"$each": events}}},
    )
    return await db.leads.find_one({"id": matched["id"]}, {"_id": 0})


def _public(lead: dict) -> dict:
    lead.pop("_id", None)
    return lead


async def _referral_link(referrer_user_id: str) -> str:
    """Build the public application link for a referrer.

    Emits a human-readable slug segment (``/ref=jishna-jeemon``) by resolving
    the referrer's ``name`` and slugifying it. Falls back to the UUID if the
    user has no name on record — the public ``/api/public/referrer/{slug}``
    endpoint accepts both slug and UUID, so old links keep working.
    """
    base = (os.environ.get("APPLY_PUBLIC_URL") or "").rstrip("/")
    ref = referrer_user_id
    if referrer_user_id:
        try:
            user = await db.users.find_one({"id": referrer_user_id}, {"_id": 0, "name": 1})
            # Inline slugify — avoids circular import with routers.applications
            # (which imports bump_lead_on_application from here). Matches the
            # implementation in applications.py exactly.
            name = ((user or {}).get("name") or "").strip().lower()
            slug = re.sub(r"[^a-z0-9]+", "-", name).strip("-")
            if slug:
                ref = slug
        except Exception:
            pass  # keep UUID fallback
    return f"{base}/ref={ref}" if base else f"/apply?ref={ref}"


def _status_event(from_status, to_status, user: dict, note: str = "", metadata: Optional[dict] = None) -> dict:
    """One entry in a lead's status_history journey log.

    ``metadata`` (optional) carries structured side-effect results — e.g.
    ``{"whatsapp": {"ok": True, "message_id": "..."}}`` — surfaced in the UI's
    Lead Journey timeline.
    """
    doc = {
        "id": gen_id(),
        "at": now_iso(),
        "from": from_status,
        "to": to_status,
        "by_user_id": user["id"],
        "by_name": user.get("name"),
        "note": note,
    }
    if metadata:
        doc["metadata"] = metadata
    return doc


async def _notify_visit_admins(lead: dict, title: str, message: str, actor_id: str) -> None:
    """Best-effort notification to super admins + the lead office's admins.

    The notification link deep-links straight into the lead detail dialog via
    the ``?lead=<id>`` query param so recipients can jump to it in one click.
    """
    link = f"/leads?lead={lead.get('id')}"
    try:
        await notify_super_admins(
            type="campus_visit", title=title, message=message,
            link=link, actor_user_id=actor_id,
        )
        q: dict = {"role": "office_admin", "approval_status": "approved"}
        if lead.get("office"):
            q["office"] = lead["office"]
        offs = await db.users.find(q, {"_id": 0, "id": 1}).to_list(50)
        if offs:
            await notify_users(
                [o["id"] for o in offs],
                type="campus_visit", title=title, message=message,
                link=link, actor_user_id=actor_id,
            )
    except Exception:
        pass


async def _schedule_visit(lead: dict, visit_in: VisitIn, user: dict) -> tuple[dict, dict]:
    """Store a campus visit on the lead, WhatsApp the student, notify admins."""
    now = now_iso()
    doc = {
        "id": gen_id(),
        "status": "scheduled",
        "departure_at": visit_in.departure_at,
        "arrival_at": visit_in.arrival_at,
        "institution": (visit_in.institution or "").strip(),
        "travel_mode": (visit_in.travel_mode or "").strip(),
        "who_comes": (visit_in.who_comes or "").strip(),
        "drop_point": (visit_in.drop_point or "").strip(),
        "attending_admin_id": None,
        "attending_admin_name": None,
        "created_by_user_id": user["id"],
        "created_by_name": user.get("name"),
        "created_at": now,
        "updated_at": now,
    }
    wa = await send_visit_scheduled(
        name=lead.get("name") or "",
        phone=lead.get("phone") or "",
        institution=doc["institution"] or "KM Foundation partner campus",
        departure_at=visit_in.departure_at,
        arrival_at=visit_in.arrival_at,
        travel_mode=doc["travel_mode"],
        drop_point=doc["drop_point"],
    )
    doc["whatsapp_sent"] = bool(wa.get("ok"))
    await db.leads.update_one(
        {"id": lead["id"]},
        {"$set": {"visit": doc, "campus_visit_interested": True, "updated_at": now}},
    )
    await _notify_visit_admins(
        lead,
        "Campus visit scheduled",
        f"{lead.get('name')} · departure {fmt_dt_ist(visit_in.departure_at)}",
        user["id"],
    )
    return doc, wa


# ---------- list / stats ----------
SUPER_ADMIN_OFFICES = ("KM_BLR", "KM_TCR", "KM_KMLY")


def _apply_office_override(user: dict, base: dict, office: Optional[str]) -> dict:
    """Super admin can narrow their view to a single office via `?office=`;
    everyone else has hard scope enforced by _scope_filter() already."""
    if user.get("role") == "super_admin" and office in SUPER_ADMIN_OFFICES:
        return {**base, "office": office}
    return base


@router.get("")
async def list_leads(
    user: dict = Depends(get_current_user),
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    source: Optional[str] = None,
    campaign_id: Optional[str] = None,
    uncategorized: Optional[bool] = None,
    q: Optional[str] = None,
    view: Optional[str] = None,  # "missed" | "today" | None
    office: Optional[str] = None,  # super_admin only — narrow to one office
):
    if user.get("role") not in ("super_admin", "office_admin", "staff"):
        raise HTTPException(403, "Not allowed")
    query = _apply_office_override(user, _scope_filter(user), office)
    if status and status in LEAD_STATUSES:
        query["status"] = status
    if assigned_to:
        query["assigned_to_user_id"] = assigned_to
    if source and source in LEAD_SOURCES:
        query["source"] = source
    if campaign_id:
        query["campaign_id"] = campaign_id
    if uncategorized:
        query["$and"] = [{"$or": [{"campaign_id": None}, {"campaign_id": {"$exists": False}}]}]
    if q:
        rx = {"$regex": q.strip(), "$options": "i"}
        or_clause = [{"name": rx}, {"phone": rx}, {"email": rx}, {"course": rx}, {"place": rx}]
        if uncategorized:
            query["$and"].append({"$or": or_clause})
        else:
            query["$or"] = or_clause
    docs = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)

    now = datetime.now(timezone.utc)
    for d in docs:
        d["is_missed"] = _is_missed(d, now)
    if view == "missed":
        docs = [d for d in docs if d["is_missed"]]

    # Enrich assignee names + photos for the UI (bulk lookups keep this O(1))
    ids = list({d.get("assigned_to_user_id") for d in docs if d.get("assigned_to_user_id")})
    if ids:
        users = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        umap = {u["id"]: u.get("name") for u in users}
        photo_map = await resolve_photos_for_users(ids)
        for d in docs:
            uid = d.get("assigned_to_user_id")
            d["assigned_to_name"] = umap.get(uid)
            d["assigned_to_photo_url"] = photo_map.get(uid) or ""
    return docs


class AssignCampaignIn(BaseModel):
    campaign_id: Optional[str] = None


@router.post("/{lead_id}/campaign")
async def assign_lead_campaign(
    lead_id: str,
    payload: AssignCampaignIn,
    user: dict = Depends(require_edit("leads")),
):
    """Attach a lead to a campaign (or detach with campaign_id=null).
    Super/Office Admin only; the campaign must be in the caller's scope."""
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Not allowed")
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    update = {"updated_at": now_iso()}
    if payload.campaign_id:
        cscope = {} if user["role"] == "super_admin" else {"office": user.get("office")}
        campaign = await db.campaigns.find_one(
            {**cscope, "id": payload.campaign_id}, {"_id": 0, "id": 1, "office": 1}
        )
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        update["campaign_id"] = payload.campaign_id
        update["office"] = campaign["office"]
    else:
        update["campaign_id"] = None
    await db.leads.update_one({"id": lead_id}, {"$set": update})
    fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if fresh.get("assigned_to_user_id"):
        u = await db.users.find_one({"id": fresh["assigned_to_user_id"]}, {"_id": 0, "name": 1})
        fresh["assigned_to_name"] = u.get("name") if u else None
        photo_map = await resolve_photos_for_users([fresh["assigned_to_user_id"]])
        fresh["assigned_to_photo_url"] = photo_map.get(fresh["assigned_to_user_id"]) or ""
    return fresh


@router.get("/stats")
async def lead_stats(
    user: dict = Depends(get_current_user),
    campaign_id: Optional[str] = None,
    uncategorized: Optional[bool] = None,
    office: Optional[str] = None,
):
    if user.get("role") not in ("super_admin", "office_admin", "staff"):
        raise HTTPException(403, "Not allowed")
    scope = _apply_office_override(user, _scope_filter(user), office)
    if campaign_id:
        scope = {**scope, "campaign_id": campaign_id}
    if uncategorized:
        scope = {**scope, "$or": [{"campaign_id": None}, {"campaign_id": {"$exists": False}}]}
    docs = await db.leads.find(scope, {"_id": 0, "status": 1, "next_follow_up": 1}).to_list(50000)
    now = datetime.now(timezone.utc)
    by_status = {s: 0 for s in LEAD_STATUSES}
    missed = 0
    for d in docs:
        st = d.get("status")
        if st in by_status:
            by_status[st] += 1
        if _is_missed(d, now):
            missed += 1
    return {"total": len(docs), "by_status": by_status, "missed": missed}


@router.get("/staff-performance")
async def staff_performance(
    user: dict = Depends(get_current_user),
    window: str = "today",
    office: Optional[str] = None,
):
    """Daily/weekly/monthly staff performance for the CRM Overview.

    Returns one row per staff/office_admin in the caller's scope, showing:
      • ``touched`` — count of leads worked on inside the window (updated_at gte)
      • ``by_status`` — those touched leads grouped by their current status
      • ``follow_ups`` — count of touched leads with a scheduled follow-up
      • ``missed`` — count of touched leads whose follow-up is overdue

    Scope rules:
      • super_admin → every approved staff + office_admin (optionally narrowed
        to a single ``?office=KM_BLR|KM_TCR|KM_KMLY``)
      • office_admin → same, restricted to their office (``?office=`` ignored)
      • staff / others → 403 (staff can already see their own stats via /leads/stats)
    """
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Not allowed")
    if window not in ("live", "today", "week", "month"):
        raise HTTPException(400, "window must be live|today|week|month")

    now = datetime.now(timezone.utc)
    if window == "live":
        # Rolling 60-minute window — the "Live" tab feels near-real-time.
        start = now - timedelta(minutes=60)
    elif window == "today":
        # Rolling last 24h so early-morning viewers still see yesterday
        # afternoon activity — matches operator expectation better than
        # a hard midnight-UTC cutoff.
        start = now - timedelta(hours=24)
    elif window == "week":
        start = now - timedelta(days=7)
    else:
        start = now - timedelta(days=30)
    start_iso = start.isoformat()

    user_q: dict = {
        "role": {"$in": ["staff", "office_admin"]},
        "approval_status": "approved",
    }
    if user.get("role") == "office_admin":
        user_q["office"] = user.get("office")
    elif user.get("role") == "super_admin" and office in SUPER_ADMIN_OFFICES:
        user_q["office"] = office
    users = await db.users.find(
        user_q,
        {"_id": 0, "id": 1, "name": 1, "role": 1, "office": 1},
    ).sort("name", 1).to_list(500)
    if not users:
        return {"window": window, "range": {"start": start_iso, "end": now.isoformat()}, "staff": []}

    ids = [u["id"] for u in users]

    # Batch aggregate touched-leads grouped by (user, status)
    pipeline = [
        {"$match": {"assigned_to_user_id": {"$in": ids}, "updated_at": {"$gte": start_iso}}},
        {"$group": {
            "_id": {"user": "$assigned_to_user_id", "status": "$status"},
            "n": {"$sum": 1},
        }},
    ]
    agg_rows = await db.leads.aggregate(pipeline).to_list(len(ids) * len(LEAD_STATUSES) + 10)

    # Missed = touched + status in OPEN_STATUSES + next_follow_up < now
    # We still need to pull per-lead next_follow_up so use one extra query.
    missed_docs = await db.leads.find(
        {"assigned_to_user_id": {"$in": ids}, "updated_at": {"$gte": start_iso},
         "status": {"$in": list(OPEN_STATUSES)}, "next_follow_up": {"$ne": None}},
        {"_id": 0, "assigned_to_user_id": 1, "next_follow_up": 1},
    ).to_list(50000)
    missed_map: dict[str, int] = {}
    followup_map: dict[str, int] = {}
    for d in missed_docs:
        uid = d.get("assigned_to_user_id")
        if not uid:
            continue
        followup_map[uid] = followup_map.get(uid, 0) + 1
        if _is_missed(d, now):
            missed_map[uid] = missed_map.get(uid, 0) + 1

    # Batch photo lookups
    photos = await resolve_photos_for_users(ids)

    by_user: dict[str, dict] = {
        u["id"]: {
            "user_id": u["id"],
            "name": u["name"],
            "role": u["role"],
            "office": u.get("office"),
            "photo_url": photos.get(u["id"]) or "",
            "touched": 0,
            "by_status": {s: 0 for s in LEAD_STATUSES},
            "follow_ups": followup_map.get(u["id"], 0),
            "missed": missed_map.get(u["id"], 0),
        } for u in users
    }
    for row in agg_rows:
        uid = row["_id"]["user"]
        st = row["_id"]["status"]
        n = row["n"]
        if uid not in by_user or st not in by_user[uid]["by_status"]:
            continue
        by_user[uid]["by_status"][st] += n
        by_user[uid]["touched"] += n

    staff = sorted(by_user.values(), key=lambda r: (-r["touched"], r["name"].lower()))
    return {
        "window": window,
        "range": {"start": start_iso, "end": now.isoformat()},
        "staff": staff,
    }


@router.get("/staff-performance/{user_id}")
async def staff_performance_leads(
    user_id: str,
    user: dict = Depends(get_current_user),
    window: str = "today",
    limit: int = 100,
):
    """Drill-down: individual leads a specific staff touched in the window."""
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Not allowed")
    if window not in ("live", "today", "week", "month"):
        raise HTTPException(400, "window must be live|today|week|month")
    target = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "id": 1, "office": 1, "role": 1},
    )
    if not target:
        raise HTTPException(404, "Staff not found")
    if user.get("role") == "office_admin" and target.get("office") != user.get("office"):
        raise HTTPException(403, "Out of scope")

    now = datetime.now(timezone.utc)
    if window == "live":
        start = now - timedelta(minutes=60)
    elif window == "today":
        start = now - timedelta(hours=24)
    elif window == "week":
        start = now - timedelta(days=7)
    else:
        start = now - timedelta(days=30)

    docs = await db.leads.find(
        {"assigned_to_user_id": user_id, "updated_at": {"$gte": start.isoformat()}},
        {"_id": 0, "id": 1, "name": 1, "phone": 1, "status": 1, "next_follow_up": 1,
         "updated_at": 1, "campaign_id": 1, "office": 1},
    ).sort("updated_at", -1).limit(max(1, min(limit, 500))).to_list(500)
    return {"user_id": user_id, "window": window, "leads": docs, "total": len(docs)}



@router.get("/next-followup-slot")
async def next_followup_slot(
    user: dict = Depends(get_current_user),
    exclude_lead_id: Optional[str] = None,
):
    """Compute the next available follow-up slot on the caller's own timeline.

    Slots are 5-minute steps inside a 10:00-19:00 IST working window. Returns
    `is_first=True` when the caller has no future follow-ups booked — the UI
    then lets them pick the time manually; every later one is auto-assigned."""
    if user.get("role") not in ("super_admin", "office_admin", "staff"):
        raise HTTPException(403, "Not allowed")
    now = datetime.now(timezone.utc)
    docs = await db.leads.find(
        {"assigned_to_user_id": user["id"], "next_follow_up": {"$ne": None}},
        {"_id": 0, "id": 1, "next_follow_up": 1},
    ).to_list(5000)
    booked = [
        d["next_follow_up"] for d in docs
        if d.get("next_follow_up") and d.get("id") != exclude_lead_id
    ]
    slot, is_first = compute_next_slot(booked, now)
    return {
        "slot": slot,
        "is_first": is_first,
        "window": {
            "start": f"{WORK_START_HOUR:02d}:00",
            "end": f"{WORK_END_HOUR:02d}:00",
            "step_minutes": SLOT_MINUTES,
        },
    }


LOST_REASONS = ("Admission Taken", "No Response", "Joined Competitor", "Not Eligible", "Other")


def _student_scope_for_analytics(user: dict) -> dict:
    if user.get("role") == "super_admin":
        return {}
    office = user.get("office")
    return {"$or": [{"user_id": user["id"]}, {"home_office": office}, {"home_office": "ALL"}]}


@router.get("/analytics")
async def lead_analytics(user: dict = Depends(get_current_user), office: Optional[str] = None):
    """Aggregated CRM analytics for the Office Admin / Super Admin dashboard:
    KPIs, lead funnel, college- & course-wise admissions, monthly seat trend
    and lost-reason breakdown — all scoped to the caller's office.

    A super admin may pass ?office=KM_BLR to inspect a specific office."""
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Not allowed")
    now = datetime.now(timezone.utc)

    if user.get("role") == "super_admin" and office:
        owner_users = await db.users.find({"office": office}, {"_id": 0, "id": 1}).to_list(1000)
        owner_ids = [u["id"] for u in owner_users]
        lead_scope = {"office": office}
        student_scope = {"$or": [
            {"user_id": {"$in": owner_ids}},
            {"home_office": office},
            {"home_office": "ALL"},
        ]}
    else:
        lead_scope = _scope_filter(user)
        student_scope = _student_scope_for_analytics(user)

    leads = await db.leads.find(
        lead_scope, {"_id": 0, "status": 1, "next_follow_up": 1, "lost_reason": 1}
    ).to_list(20000)
    by_status = {s: 0 for s in LEAD_STATUSES}
    missed = 0
    lost_reasons: dict = {}
    for d in leads:
        st = d.get("status")
        if st in by_status:
            by_status[st] += 1
        if _is_missed(d, now):
            missed += 1
        if st == "lost":
            lr = (d.get("lost_reason") or "").strip() or "Unspecified"
            lost_reasons[lr] = lost_reasons.get(lr, 0) + 1
    total_leads = len(leads)
    converted = sum(by_status[s] for s in CONVERTED_STATUSES)
    lost = by_status["lost"]
    positive = by_status["not_connected"] + by_status["interested"] + by_status["follow_up"]

    students = await db.students.find(
        student_scope,
        {"_id": 0, "status": 1, "college": 1, "course": 1, "enrollment_date": 1, "created_at": 1},
    ).to_list(50000)
    admissions = [s for s in students if s.get("status") != "cancelled"]
    total_admissions = len(admissions)

    college_counts: dict = {}
    course_counts: dict = {}
    monthly: dict = {}
    for s in admissions:
        col = (s.get("college") or "").strip() or "Unknown"
        college_counts[col] = college_counts.get(col, 0) + 1
        crs = (s.get("course") or "").strip() or "Unknown"
        course_counts[crs] = course_counts.get(crs, 0) + 1
        ym = (s.get("enrollment_date") or s.get("created_at") or "")[:7]
        if len(ym) == 7:
            monthly[ym] = monthly.get(ym, 0) + 1

    conv_rate = round(converted / total_leads * 100, 1) if total_leads else 0.0
    college_wise = sorted(
        ({"name": k, "value": v} for k, v in college_counts.items()), key=lambda x: -x["value"]
    )[:8]
    course_wise = sorted(
        ({"name": k, "value": v} for k, v in course_counts.items()), key=lambda x: -x["value"]
    )[:8]
    monthly_trend = [{"month": k, "value": monthly[k]} for k in sorted(monthly.keys())][-12:]
    funnel = [
        {"stage": "Leads", "value": total_leads},
        {"stage": "Interested", "value": by_status["interested"]},
        {"stage": "Converted", "value": converted},
        {"stage": "Completed", "value": by_status["completed"]},
        {"stage": "Lost", "value": lost + by_status["not_turned"]},
    ]
    lost_reasons_list = sorted(
        ({"name": k, "value": v} for k, v in lost_reasons.items()), key=lambda x: -x["value"]
    )

    return {
        "kpis": {
            "total_leads": total_leads,
            "total_admissions": total_admissions,
            "conversion_rate": conv_rate,
            "pending_followups": missed,
            "lost_leads": lost,
        },
        "funnel": funnel,
        "by_status": by_status,
        "college_wise": college_wise,
        "course_wise": course_wise,
        "monthly_trend": monthly_trend,
        "lost_reasons": lost_reasons_list,
    }


# ---------- create / update / delete ----------
@router.post("", status_code=201)
async def create_lead(payload: LeadIn, user: dict = Depends(require_edit("leads"))):
    role = user.get("role")
    assigned_to = payload.assigned_to_user_id
    office: Optional[str] = None

    if role == "staff":
        assigned_to = user["id"]
        office = user.get("office")
    elif role == "office_admin":
        office = user.get("office")
        if assigned_to:
            await _validate_assignee(assigned_to, office, require_office=True)
        else:
            assigned_to = user["id"]
    else:  # super_admin
        if assigned_to:
            assignee = await _validate_assignee(assigned_to, None, require_office=False)
            office = assignee.get("office")

    if payload.status not in LEAD_STATUSES:
        raise HTTPException(400, "Invalid status")
    src = payload.source if payload.source in LEAD_SOURCES else "other"

    doc = {
        "id": gen_id(),
        "name": payload.name.strip(),
        "phone": (payload.phone or "").strip(),
        "email": (payload.email or "").strip(),
        "course": (payload.course or "").strip(),
        "place": (payload.place or "").strip(),
        "source": src,
        "status": payload.status,
        "assigned_to_user_id": assigned_to,
        "office": office,
        "next_follow_up": payload.next_follow_up or None,
        "notes": (payload.notes or "").strip(),
        "follow_ups": [],
        "created_by_user_id": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.leads.insert_one(doc)
    await _notify_assignment(doc, actor=user)
    return _public(doc)


@router.patch("/{lead_id}")
async def update_lead(lead_id: str, payload: LeadUpdate, user: dict = Depends(require_edit("leads"))):
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id})
    if not lead:
        raise HTTPException(404, "Lead not found")
    data = payload.model_dump(exclude_unset=True)
    patch: dict = {}
    for k in ("name", "phone", "email", "course", "place", "notes"):
        if k in data and data[k] is not None:
            patch[k] = str(data[k]).strip()
    if "status" in data and data["status"]:
        if data["status"] not in LEAD_STATUSES:
            raise HTTPException(400, "Invalid status")
        patch["status"] = data["status"]
        # Clear the lost reason if the lead moves out of "lost"
        if data["status"] != "lost":
            patch["lost_reason"] = ""
    if "lost_reason" in data:
        patch["lost_reason"] = (data["lost_reason"] or "").strip()
    if "source" in data and data["source"]:
        patch["source"] = data["source"] if data["source"] in LEAD_SOURCES else "other"
    if "next_follow_up" in data:
        patch["next_follow_up"] = data["next_follow_up"] or None
        patch["follow_up_reminded_for"] = None  # re-arm the reminder
    new_assignee = None
    if "assigned_to_user_id" in data and data["assigned_to_user_id"] != lead.get("assigned_to_user_id"):
        if user.get("role") == "staff":
            raise HTTPException(403, "Staff cannot reassign leads")
        if data["assigned_to_user_id"]:
            require_office = user.get("role") == "office_admin"
            assignee = await _validate_assignee(
                data["assigned_to_user_id"], user.get("office"), require_office
            )
            patch["assigned_to_user_id"] = assignee["id"]
            if user.get("role") == "super_admin":
                patch["office"] = assignee.get("office")
            new_assignee = assignee["id"]
        else:
            patch["assigned_to_user_id"] = None
    patch["updated_at"] = now_iso()
    ops: dict = {"$set": patch}
    if patch.get("status") and patch["status"] != lead.get("status"):
        ops["$push"] = {"status_history": _status_event(lead.get("status"), patch["status"], user)}
    await db.leads.update_one({"id": lead_id}, ops)
    fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if new_assignee:
        await _notify_assignment(fresh, actor=user)
    return fresh


@router.delete("/{lead_id}")
async def delete_lead(lead_id: str, user: dict = Depends(require_edit("leads"))):
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id})
    if not lead:
        raise HTTPException(404, "Lead not found")
    lead.pop("_id", None)
    await db.leads.delete_one({"id": lead_id})
    # Audit + restorable — full row snapshot goes into `before`.
    await log_event(
        event_type="lead.deleted", actor=user,
        subject_type="lead", subject_id=lead_id, subject_label=lead.get("name"),
        before=lead,
        office=lead.get("office"),
        note=f"Deleted lead {lead.get('name')}",
        reversible=True,
    )
    return {"ok": True}


@router.post("/bulk-actions")
async def bulk_actions_leads(
    payload: BulkLeadActionIn, user: dict = Depends(require_edit("leads"))
) -> dict:
    """Apply one action to many leads at once.

    Actions:
      * ``delete``   — remove the leads (staff blocked)
      * ``assign``   — reassign to ``assigned_to_user_id`` (null → unassign; staff blocked)
      * ``status``   — move all to a new pipeline stage (validated against LEAD_STATUSES)
      * ``campaign`` — attach to ``campaign_id`` (null → detach; staff blocked)

    Every affected lead is scoped through ``_scope_filter`` so office admins
    can't touch other offices. Returns counts + the list of updated ids so
    the UI can refresh precisely.
    """
    role = user.get("role")
    scope = _scope_filter(user)
    ids = list({i for i in payload.ids if i})
    if not ids:
        raise HTTPException(400, "No leads selected")
    # Restrict the id set to leads the caller can actually see.
    docs = await db.leads.find(
        {**scope, "id": {"$in": ids}}, {"_id": 0, "id": 1, "status": 1, "assigned_to_user_id": 1, "office": 1}
    ).to_list(len(ids))
    if not docs:
        raise HTTPException(404, "No matching leads in your scope")
    visible_ids = [d["id"] for d in docs]
    action = payload.action

    if action == "delete":
        if role == "staff":
            raise HTTPException(403, "Staff cannot bulk delete leads")
        # Full snapshot for restore.
        snap = await db.leads.find({"id": {"$in": visible_ids}}).to_list(len(visible_ids))
        for r in snap:
            r.pop("_id", None)
        res = await db.leads.delete_many({"id": {"$in": visible_ids}})
        # Human-friendly label: show the lead's actual name when just one row
        # was deleted, otherwise the count. Note text mirrors the label so the
        # Activity feed lists the specific name, not a generic "1 leads".
        if res.deleted_count == 1 and snap:
            _name = snap[0].get("name") or "1 lead"
            _label = _name
            _note = f"Bulk deleted lead {_name}"
        else:
            _label = f"{res.deleted_count} leads"
            _note = f"Bulk deleted {res.deleted_count} leads"
        await log_event(
            event_type="lead.bulk_delete", actor=user,
            subject_type="lead", subject_id=None, subject_label=_label,
            before={"leads": snap},
            note=_note,
            extras={"lead_ids": visible_ids},
            reversible=True,
        )
        return {"ok": True, "action": action, "affected_ids": visible_ids, "count": res.deleted_count}

    if action == "assign":
        if role == "staff":
            raise HTTPException(403, "Staff cannot reassign leads")
        set_doc: dict = {"updated_at": now_iso()}
        new_assignee = payload.assigned_to_user_id
        if new_assignee:
            require_office = role == "office_admin"
            assignee = await _validate_assignee(new_assignee, user.get("office"), require_office)
            set_doc["assigned_to_user_id"] = assignee["id"]
            if role == "super_admin":
                set_doc["office"] = assignee.get("office")
        else:
            set_doc["assigned_to_user_id"] = None
        res = await db.leads.update_many({"id": {"$in": visible_ids}}, {"$set": set_doc})
        # Best-effort assignee notification (one push per lead so their inbox
        # links deep-link correctly).
        if new_assignee:
            for lid in visible_ids:
                fresh = await db.leads.find_one({"id": lid}, {"_id": 0})
                if fresh:
                    await _notify_assignment(fresh, actor=user)
        await log_event(
            event_type="lead.bulk_assign", actor=user,
            subject_type="lead", subject_label=f"{res.modified_count} leads",
            after={"assigned_to_user_id": new_assignee},
            note=(f"Bulk assigned to {new_assignee}" if new_assignee else "Bulk unassigned"),
            extras={"lead_ids": visible_ids},
        )
        return {"ok": True, "action": action, "affected_ids": visible_ids, "count": res.modified_count}

    if action == "status":
        if not payload.status or payload.status not in LEAD_STATUSES:
            raise HTTPException(400, "Invalid status")
        # Push a status_history entry per doc so timelines stay accurate.
        now = now_iso()
        for d in docs:
            if d.get("status") == payload.status:
                continue
            await db.leads.update_one(
                {"id": d["id"]},
                {
                    "$set": {
                        "status": payload.status,
                        "lost_reason": "" if payload.status != "lost" else None,
                        "updated_at": now,
                    },
                    "$push": {"status_history": _status_event(d.get("status"), payload.status, user, note="bulk update")},
                },
            )
        return {"ok": True, "action": action, "affected_ids": visible_ids, "count": len(visible_ids)}

    if action == "campaign":
        if role == "staff":
            raise HTTPException(403, "Staff cannot manage campaigns")
        set_doc = {"updated_at": now_iso()}
        if payload.campaign_id:
            cscope = {} if role == "super_admin" else {"office": user.get("office")}
            campaign = await db.campaigns.find_one(
                {**cscope, "id": payload.campaign_id}, {"_id": 0, "id": 1, "office": 1}
            )
            if not campaign:
                raise HTTPException(404, "Campaign not found")
            set_doc["campaign_id"] = payload.campaign_id
            set_doc["office"] = campaign["office"]
        else:
            set_doc["campaign_id"] = None
        res = await db.leads.update_many({"id": {"$in": visible_ids}}, {"$set": set_doc})
        await log_event(
            event_type="lead.bulk_campaign", actor=user,
            subject_type="lead", subject_label=f"{res.modified_count} leads",
            after={"campaign_id": payload.campaign_id},
            note=(f"Attached to campaign {payload.campaign_id}" if payload.campaign_id else "Detached from campaign"),
            extras={"lead_ids": visible_ids},
        )
        return {"ok": True, "action": action, "affected_ids": visible_ids, "count": res.modified_count}

    raise HTTPException(400, f"Unknown action: {action}")


@router.post("/{lead_id}/convert", status_code=201)
async def convert_lead(lead_id: str, payload: Optional[ConvertIn] = None, user: dict = Depends(require_edit("leads"))):
    """Convert a lead into an inquiry Student, credited to the lead's assignee
    (referrer_user_id). Optionally records city/course/college, WhatsApps the
    referral application link and schedules a campus visit. Idempotent —
    returns the existing student if already converted."""
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id})
    if not lead:
        raise HTTPException(404, "Lead not found")
    if lead.get("converted_student_id"):
        return {"ok": True, "student_id": lead["converted_student_id"], "already_converted": True}

    admin = await db.users.find_one({"role": "super_admin"}, {"_id": 0, "id": 1})
    owner_id = (admin or {}).get("id") or user["id"]
    referrer_user_id = lead.get("assigned_to_user_id") or user["id"]
    referrer = await db.users.find_one({"id": referrer_user_id}, {"_id": 0, "name": 1})
    student_id = gen_id()
    now = now_iso()
    note_bits = []
    if lead.get("phone"):
        note_bits.append(f"Phone: {lead['phone']}")
    if lead.get("email"):
        note_bits.append(f"Email: {lead['email']}")
    if lead.get("place"):
        note_bits.append(f"Place: {lead['place']}")
    if payload and payload.city:
        note_bits.append(f"City: {payload.city}")
    student_doc = {
        "id": student_id,
        "user_id": owner_id,
        "created_at": now,
        "name": lead.get("name"),
        "course": ((payload.course if payload else "") or lead.get("course") or ""),
        "college": ((payload.college or "") if payload else ""),
        "reference": (referrer or {}).get("name") or "",
        "referrer_user_id": referrer_user_id,
        "referrer_name": (referrer or {}).get("name"),
        "sc_out_fixed": 0.0,
        "status": "inquiry",
        "enrollment_date": now[:10],
        "notes": " · ".join(["Converted from CRM lead"] + note_bits),
        "fees_plan": None,
        "schedules": [],
        "payments": [],
        "application_source": "lead_conversion",
        "lead_id": lead_id,
    }
    await db.students.insert_one(student_doc)

    # Send the referral application link via WhatsApp FIRST so the result can be
    # embedded in the status_history "converted" event (surfaced in the UI's
    # Lead Journey timeline as "WA Sent · <message_id>" or "WA Failed · <detail>").
    wa_link = None
    if payload and payload.send_link and lead.get("phone"):
        wa_link = await send_application_link(
            name=lead.get("name") or "",
            phone=lead["phone"],
            course=((payload.course or "") or lead.get("course") or ""),
            college=payload.college or "",
            city=payload.city or "",
            link=await _referral_link(referrer_user_id),
        )

    lead_patch = {"status": "converted", "converted_student_id": student_id, "updated_at": now}
    if payload and (payload.city or payload.course or payload.college):
        lead_patch["conversion_details"] = {
            "city": payload.city or "",
            "course": payload.course or "",
            "college": payload.college or "",
        }
    if wa_link is not None:
        lead_patch["application_wa"] = wa_link  # latest send result (for Resend UI)
    convert_meta: Optional[dict] = None
    if wa_link is not None:
        convert_meta = {"whatsapp": wa_link}
    await db.leads.update_one({"id": lead_id}, {
        "$set": lead_patch,
        "$push": {"status_history": _status_event(
            lead.get("status"), "converted", user,
            note="application link sent" if wa_link and wa_link.get("ok") else "",
            metadata=convert_meta,
        )},
    })

    wa_visit = None
    if payload and payload.campus_visit_interested and payload.visit and (
        payload.visit.departure_at or payload.visit.arrival_at
    ):
        _, wa_visit = await _schedule_visit(lead, payload.visit, user)
    try:
        await notify_super_admins(
            type="student_application",
            title="Lead converted to student",
            message=f"{lead.get('name')} · {lead.get('course') or ''}",
            link=f"/students/{student_id}",
            actor_user_id=user["id"],
        )
    except Exception:
        pass
    return {"ok": True, "student_id": student_id, "whatsapp": wa_link, "visit_whatsapp": wa_visit}


@router.post("/{lead_id}/resend-application-link")
async def resend_application_link(lead_id: str, user: dict = Depends(require_edit("leads"))):
    """Retry the WhatsApp application link for an already-converted lead.

    Uses the same referral link resolution as the initial convert flow. The
    latest result is persisted in ``lead.application_wa`` and pushed onto
    ``status_history`` (as a same-status event) so the Journey timeline shows
    each retry attempt inline.
    """
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Only super or office admins can resend the link")
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    if not lead.get("converted_student_id"):
        raise HTTPException(400, "Lead is not converted yet")
    if not lead.get("phone"):
        raise HTTPException(400, "No phone number on this lead")

    referrer_user_id = lead.get("assigned_to_user_id") or user["id"]
    cd = lead.get("conversion_details") or {}
    wa_link = await send_application_link(
        name=lead.get("name") or "",
        phone=lead["phone"],
        course=cd.get("course") or lead.get("course") or "",
        college=cd.get("college") or "",
        city=cd.get("city") or "",
        link=await _referral_link(referrer_user_id),
    )
    now = now_iso()
    await db.leads.update_one(
        {"id": lead_id},
        {
            "$set": {"application_wa": wa_link, "updated_at": now},
            "$push": {"status_history": _status_event(
                "converted", "converted", user,
                note="application link resent" if wa_link.get("ok") else "resend failed",
                metadata={"whatsapp": wa_link},
            )},
        },
    )
    fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    return {"ok": bool(wa_link.get("ok")), "whatsapp": wa_link, "lead": fresh}


@router.get("/visits/today")
async def visits_today(
    user: dict = Depends(get_current_user),
    office: Optional[str] = None,
):
    """Live 'today's campus visits' board for the CRM Overview.

    Time-window semantics (per user request):
      * Card appears **24 hours before** the visit's ``departure_at`` (or
        ``arrival_at`` if departure is unset) — tagged ``phase="preview"``
        with a "Tomorrow Visit" pill on the frontend.
      * Card is ``phase="live"`` once the anchor time (departure/arrival)
        has passed — the whole visit day stays visible.
      * Card auto-disappears at end-of-day (server UTC) of the arrival
        timestamp (or the anchor + 1 day if arrival is unset).

    Scope: staff → own leads only, office_admin → own office, super_admin →
    everything (optionally narrowed with ``?office=KM_BLR|KM_TCR|KM_KMLY``).
    Sorted live-first, then preview, both by departure asc.
    """
    if user.get("role") not in ("super_admin", "office_admin", "staff"):
        raise HTTPException(403, "Not allowed")
    now_dt = datetime.now(timezone.utc)
    scope = _apply_office_override(user, _scope_filter(user), office)
    scope["visit"] = {"$ne": None}
    docs = await db.leads.find(
        scope,
        {
            "_id": 0, "id": 1, "name": 1, "phone": 1, "course": 1, "office": 1,
            "assigned_to_user_id": 1, "visit": 1, "status": 1,
        },
    ).to_list(500)

    def _parse(iso: Optional[str]) -> Optional[datetime]:
        if not iso:
            return None
        try:
            # Mongo stores ISO 8601 UTC strings — handle both `Z` and offset forms.
            return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        except Exception:
            return None

    out: list[dict] = []
    for d in docs:
        v = d.get("visit") or {}
        v["status"] = VISIT_STATUS_LEGACY.get(v.get("status"), v.get("status"))
        dep = _parse(v.get("departure_at"))
        arr = _parse(v.get("arrival_at"))
        anchor = dep or arr
        if not anchor:
            continue
        preview_start = anchor - timedelta(hours=24)
        # Visit is over at end-of-day of the arrival timestamp (fallback: anchor
        # + 1 day so single-timestamp visits still linger through the day).
        end_marker = (arr or (anchor + timedelta(days=1))).replace(
            hour=23, minute=59, second=59, microsecond=999999
        )
        if now_dt < preview_start or now_dt > end_marker:
            continue
        phase = "live" if now_dt >= anchor else "preview"
        out.append({
            "id": d["id"],
            "name": d.get("name"),
            "phone": d.get("phone"),
            "course": d.get("course"),
            "office": d.get("office"),
            "assigned_to_user_id": d.get("assigned_to_user_id"),
            "status": d.get("status"),
            "visit": v,
            "phase": phase,
        })
    # Live cards float to the top; within a phase, earliest departure first.
    out.sort(key=lambda r: (
        0 if r["phase"] == "live" else 1,
        r["visit"].get("departure_at") or "9999",
        r["visit"].get("arrival_at") or "9999",
    ))
    return {
        "date": now_dt.date().isoformat(),
        "count": len(out),
        "live_count": sum(1 for r in out if r["phase"] == "live"),
        "preview_count": sum(1 for r in out if r["phase"] == "preview"),
        "visits": out,
    }


# ---------- interested + campus visit ----------
@router.get("/attending-admins")
async def attending_admins(user: dict = Depends(get_current_user)):
    """Super + Office admins who can attend a campus visit."""
    if user.get("role") not in ("super_admin", "office_admin", "staff"):
        raise HTTPException(403, "Not allowed")
    return await db.users.find(
        {"role": {"$in": ["super_admin", "office_admin"]}, "approval_status": "approved"},
        {"_id": 0, "id": 1, "name": 1, "role": 1, "office": 1},
    ).sort("name", 1).to_list(100)


@router.post("/{lead_id}/interested")
async def mark_interested(lead_id: str, payload: InterestedIn, user: dict = Depends(require_edit("leads"))):
    """Mark a lead Interested, capturing parent/alternate numbers and an
    optional campus-visit schedule (WhatsApps the student + notifies admins)."""
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    ops: dict = {"$set": {
        "status": "interested",
        "lost_reason": "",
        "parent_number": (payload.parent_number or "").strip(),
        "alternate_number": (payload.alternate_number or "").strip(),
        "campus_visit_interested": bool(payload.campus_visit_interested),
        "updated_at": now_iso(),
    }}
    if lead.get("status") != "interested":
        ops["$push"] = {"status_history": _status_event(lead.get("status"), "interested", user)}
    await db.leads.update_one({"id": lead_id}, ops)
    wa = None
    if payload.campus_visit_interested and payload.visit and (
        payload.visit.departure_at or payload.visit.arrival_at
    ):
        _, wa = await _schedule_visit(lead, payload.visit, user)
    fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    return {"lead": fresh, "whatsapp": wa}


@router.patch("/{lead_id}/visit")
async def update_visit(lead_id: str, payload: VisitUpdate, user: dict = Depends(require_edit("leads"))):
    """Assign the attending admin and/or move the visit outcome status."""
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Only super or office admins manage visits")
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id}, {"_id": 0})
    if not lead or not lead.get("visit"):
        raise HTTPException(404, "No scheduled visit on this lead")
    sets: dict = {}
    notify_attending = None
    if payload.attending_admin_id is not None:
        if payload.attending_admin_id == "":
            sets["visit.attending_admin_id"] = None
            sets["visit.attending_admin_name"] = None
        else:
            admin = await db.users.find_one(
                {"id": payload.attending_admin_id, "role": {"$in": ["super_admin", "office_admin"]},
                 "approval_status": "approved"},
                {"_id": 0, "id": 1, "name": 1},
            )
            if not admin:
                raise HTTPException(400, "Attending person must be a super or office admin")
            sets["visit.attending_admin_id"] = admin["id"]
            sets["visit.attending_admin_name"] = admin.get("name")
            notify_attending = admin["id"]
    if payload.status:
        if payload.status not in VISIT_STATUSES:
            raise HTTPException(400, "Invalid visit status")
        sets["visit.status"] = payload.status
    # Convenience: assigning an attending admin while the visit is still
    # "scheduled" auto-bumps the stage to "assigned" so the timeline reflects
    # the assignment without a second click.
    elif (
        notify_attending
        and (lead.get("visit") or {}).get("status") == "scheduled"
    ):
        sets["visit.status"] = "assigned"
    if not sets:
        raise HTTPException(400, "Nothing to update")
    sets["visit.updated_at"] = now_iso()
    sets["updated_at"] = now_iso()
    await db.leads.update_one({"id": lead_id}, {"$set": sets})
    fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if notify_attending and notify_attending != user["id"]:
        try:
            await notify_users(
                [notify_attending],
                type="campus_visit",
                title="You're attending a campus visit",
                message=f"{lead.get('name')} · departure {fmt_dt_ist((lead.get('visit') or {}).get('departure_at'))}",
                link=f"/leads?lead={lead_id}",
                actor_user_id=user["id"],
            )
        except Exception:
            pass
    return fresh


# ---------- follow-ups ----------
@router.post("/{lead_id}/followups", status_code=201)
async def add_followup(lead_id: str, payload: FollowUpIn, user: dict = Depends(require_edit("leads"))):
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id})
    if not lead:
        raise HTTPException(404, "Lead not found")
    entry = {
        "id": gen_id(),
        "at": payload.at,
        "note": (payload.note or "").strip(),
        "created_by_user_id": user["id"],
        "created_by_name": user.get("name"),
        "created_at": now_iso(),
    }
    patch: dict = {
        "next_follow_up": payload.at or None,
        "follow_up_reminded_for": None,
        "last_followup_at": now_iso(),
        "updated_at": now_iso(),
    }
    if payload.status and payload.status in LEAD_STATUSES:
        patch["status"] = payload.status
    push_ops: dict = {"follow_ups": entry}
    if patch.get("status") and patch["status"] != lead.get("status"):
        push_ops["status_history"] = _status_event(lead.get("status"), patch["status"], user, note="via follow-up")
    await db.leads.update_one(
        {"id": lead_id},
        {"$push": push_ops, "$set": patch},
    )
    fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    # Tell the assignee a follow-up was scheduled (if someone else scheduled it)
    assignee_id = fresh.get("assigned_to_user_id")
    if assignee_id and assignee_id != user["id"]:
        await notify_users(
            [assignee_id],
            type="lead_followup",
            title="Follow-up scheduled",
            message=f"{fresh.get('name')} · {(payload.at or '')[:16].replace('T', ' ')}",
            link=f"/leads?lead={lead_id}",
            actor_user_id=user["id"],
            metadata={"lead_id": lead_id},
        )
    return fresh


def _can_edit_followup(entry: dict, user: dict) -> bool:
    """Follow-up edits allowed to (a) the creator or (b) any admin.
    Staff cannot rewrite another teammate's follow-up (protects calendars)."""
    if user.get("role") in ("super_admin", "office_admin"):
        return True
    return entry.get("created_by_user_id") == user.get("id")


async def _notify_assignment(lead: dict, actor: dict) -> None:
    assignee_id = lead.get("assigned_to_user_id")
    if not assignee_id or assignee_id == actor.get("id"):
        return
    await notify_users(
        [assignee_id],
        type="lead_assigned",
        title="New lead assigned to you",
        message=f"{lead.get('name')}{' · ' + lead.get('course') if lead.get('course') else ''}",
        link=f"/leads?lead={lead.get('id')}",
        actor_user_id=actor.get("id"),
        metadata={"lead_id": lead.get("id")},
    )


@router.patch("/{lead_id}/followups/{followup_id}")
async def update_followup(
    lead_id: str, followup_id: str, payload: FollowUpUpdate,
    user: dict = Depends(require_edit("leads")),
):
    """Edit an existing follow-up — reschedule (``at``) and/or amend the
    note. Status transitions attached at creation time are NOT rewritten
    (they live in ``status_history`` for audit).

    Permission: creator OR admin (see ``_can_edit_followup``).
    """
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id})
    if not lead:
        raise HTTPException(404, "Lead not found")
    followups = lead.get("follow_ups") or []
    entry = next((f for f in followups if f.get("id") == followup_id), None)
    if not entry:
        raise HTTPException(404, "Follow-up not found")
    if not _can_edit_followup(entry, user):
        raise HTTPException(403, "You can only edit your own follow-ups")

    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "Nothing to update")
    new_at = data.get("at")
    new_note = data.get("note")
    old_at = entry.get("at")

    # Apply changes to the specific array item using its id.
    set_ops: dict = {"updated_at": now_iso()}
    if new_at is not None:
        set_ops["follow_ups.$.at"] = new_at
    if new_note is not None:
        set_ops["follow_ups.$.note"] = (new_note or "").strip()
    set_ops["follow_ups.$.edited_at"] = now_iso()
    set_ops["follow_ups.$.edited_by_user_id"] = user["id"]
    set_ops["follow_ups.$.edited_by_name"] = user.get("name")

    # If we're moving the LATEST follow-up (== next_follow_up), the surface
    # field on the lead also has to move; otherwise older edits don't touch it.
    if new_at is not None and old_at == lead.get("next_follow_up"):
        set_ops["next_follow_up"] = new_at
        set_ops["follow_up_reminded_for"] = None  # re-arm reminder for the new time

    await db.leads.update_one(
        {"id": lead_id, "follow_ups.id": followup_id},
        {"$set": set_ops},
    )
    fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    await log_event(
        event_type="lead.followup.edited", actor=user,
        subject_type="lead", subject_id=lead_id, subject_label=fresh.get("name"),
        before={"at": old_at, "note": entry.get("note", ""), "follow_up_id": followup_id},
        after={"at": new_at if new_at is not None else old_at,
               "note": new_note if new_note is not None else entry.get("note", "")},
        office=fresh.get("office"),
        note=f"Follow-up rescheduled" if new_at is not None else "Follow-up note edited",
        reversible=True,
    )

    # Notify the assignee if their follow-up moved and they weren't the editor.
    if new_at is not None and new_at != old_at:
        assignee_id = fresh.get("assigned_to_user_id")
        if assignee_id and assignee_id != user["id"]:
            await notify_users(
                [assignee_id],
                type="lead_followup",
                title="Follow-up rescheduled",
                message=f"{fresh.get('name')} · {new_at[:16].replace('T', ' ')}",
                link=f"/leads?lead={lead_id}",
                actor_user_id=user["id"],
                metadata={"lead_id": lead_id},
            )
    return fresh


@router.delete("/{lead_id}/followups/{followup_id}")
async def delete_followup(
    lead_id: str, followup_id: str,
    user: dict = Depends(require_edit("leads")),
):
    """Remove a follow-up entry. Same auth rules as PATCH.

    If the deleted follow-up was the *latest* one (i.e. the one surfaced as
    ``next_follow_up``), we recompute ``next_follow_up`` from the remaining
    future entries so reminders don't fire on a stale timestamp.
    """
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id})
    if not lead:
        raise HTTPException(404, "Lead not found")
    followups = lead.get("follow_ups") or []
    entry = next((f for f in followups if f.get("id") == followup_id), None)
    if not entry:
        raise HTTPException(404, "Follow-up not found")
    if not _can_edit_followup(entry, user):
        raise HTTPException(403, "You can only delete your own follow-ups")

    remaining = [f for f in followups if f.get("id") != followup_id]
    set_ops: dict = {"follow_ups": remaining, "updated_at": now_iso()}
    if entry.get("at") == lead.get("next_follow_up"):
        # Recompute the surface follow-up from whichever remaining entry has
        # the latest scheduled time. Avoids relying on array insertion order
        # (bulk imports may not be strictly chronological).
        set_ops["next_follow_up"] = (
            max((r["at"] for r in remaining if r.get("at")), default=None)
        )
        set_ops["follow_up_reminded_for"] = None
    await db.leads.update_one({"id": lead_id}, {"$set": set_ops})
    fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    # Restorable — the whole follow-up row goes into `before` so /activity-log
    # /restore can $push it back into place if the operator changes their mind.
    await log_event(
        event_type="lead.followup.deleted", actor=user,
        subject_type="lead", subject_id=lead_id, subject_label=fresh.get("name"),
        before={"follow_up": entry, "prev_next_follow_up": lead.get("next_follow_up")},
        office=fresh.get("office"),
        note=f"Follow-up deleted ({entry.get('at', '')[:16].replace('T', ' ')})",
        reversible=True,
    )
    return fresh


# ---------- Attachments (admin-only) ----------
def _require_admin(user: dict) -> None:
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Only admins can manage lead attachments")


@router.post("/{lead_id}/attachments", status_code=201)
async def attach_document(
    lead_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_edit("leads")),
):
    """Upload a document and attach it to the lead in one call.

    Admin-only (staff blocked by ``_require_admin``). Delegates to the
    uploads router's validation logic (size, MIME allowlist) via the
    shared storage helpers, then pushes a lightweight reference into
    ``leads.attachments`` so the detail dialog can render it without a
    second round-trip.
    """
    _require_admin(user)
    from routers.uploads import (
        DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, _sniff_ext, _persist_file_record,
    )
    from lib.storage import put_object, APP_NAME as _APP
    import uuid as _uuid

    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")

    ct = (file.content_type or "").lower()
    if ct not in DOCUMENT_TYPES:
        raise HTTPException(400, "Only PDF or image uploads (JPG/PNG/WebP/GIF) are allowed")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise HTTPException(400, "Document must be 10MB or smaller")

    ext = _sniff_ext(file.filename, DOCUMENT_TYPES[ct])
    path = f"{_APP}/leads/{lead_id}/{_uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, ct)
    except Exception as e:
        raise HTTPException(502, "Upload failed — storage unavailable") from e
    stored_path = result.get("path", path)
    record = await _persist_file_record(
        storage_path=stored_path, filename=file.filename or f"attachment.{ext}",
        content_type=ct, size=result.get("size", len(data)),
        owner=user, purpose="lead_document", lead_id=lead_id,
    )
    # Attachment reference kept inline on the lead for quick reads.
    attachment = {
        "file_id": record["id"],
        "path": stored_path,
        "url": f"/api/files/{stored_path}",
        "original_filename": record["original_filename"],
        "content_type": record["content_type"],
        "size": record["size"],
        "uploaded_by_user_id": user["id"],
        "uploaded_by_name": user.get("name"),
        "uploaded_at": record["created_at"],
    }
    await db.leads.update_one(
        {"id": lead_id},
        {"$push": {"attachments": attachment}, "$set": {"updated_at": now_iso()}},
    )
    return attachment


@router.delete("/{lead_id}/attachments/{file_id}")
async def detach_document(
    lead_id: str, file_id: str, user: dict = Depends(require_edit("leads")),
):
    """Remove an attachment from the lead + soft-delete the underlying
    file row. Storage bytes remain (no delete API) but future GETs 404.
    """
    _require_admin(user)
    lead = await db.leads.find_one({**_scope_filter(user), "id": lead_id}, {"_id": 0, "attachments": 1})
    if not lead:
        raise HTTPException(404, "Lead not found")
    matched = next((a for a in (lead.get("attachments") or []) if a.get("file_id") == file_id), None)
    if not matched:
        raise HTTPException(404, "Attachment not found on this lead")
    await db.leads.update_one(
        {"id": lead_id},
        {"$pull": {"attachments": {"file_id": file_id}}, "$set": {"updated_at": now_iso()}},
    )
    await db.files.update_one(
        {"id": file_id},
        {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by_user_id": user["id"]}},
    )
    return {"ok": True}


# ---------- CSV bulk upload ----------
@router.get("/template", response_class=PlainTextResponse)
async def csv_template(user: dict = Depends(get_current_user)) -> str:
    if user.get("role") not in ("super_admin", "office_admin", "staff"):
        raise HTTPException(403, "Not allowed")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["name", "phone", "email", "course", "place", "source", "notes", "employee"])
    w.writerow(["Aravind Kumar", "9876543210", "aravind@example.com", "B.Tech CSE", "Bangalore", "walk_in", "Walked in, interested in CSE", "Anjali Telecaller"])
    w.writerow(["Priya Nair", "9988776655", "", "B.Sc Nursing", "Kochi", "referral", "", ""])
    return buf.getvalue()


@router.post("/bulk", status_code=201)
async def bulk_upload(
    file: UploadFile = File(...),
    assigned_to_user_id: Optional[str] = Form(None),
    campaign_id: Optional[str] = Form(None),
    user: dict = Depends(require_edit("leads")),
) -> dict:
    """Bulk-add leads from a CSV with header
    name,phone,email,course,place,source,notes,employee.

    Each lead is assigned to the default assignee (the chosen ``assigned_to_user_id``
    or the uploader). When a row's optional ``employee`` cell names a staff member
    or office admin (scoped to the uploader's office for office admins), that row is
    assigned to them instead — unmatched names fall back to the default.

    When ``campaign_id`` is supplied (super/office admin only), rows are tagged to
    that campaign, scoped to its office and left UNASSIGNED by default so they can
    be distributed afterwards; a matching ``employee`` cell still overrides."""
    role = user.get("role")
    # Resolve the default assignee for all rows
    assignee_id = user["id"]
    office = user.get("office")
    if role == "staff":
        assignee_id = user["id"]
        office = user.get("office")
    elif role == "office_admin":
        office = user.get("office")
        if assigned_to_user_id:
            await _validate_assignee(assigned_to_user_id, office, require_office=True)
            assignee_id = assigned_to_user_id
    else:  # super_admin
        if assigned_to_user_id:
            a = await _validate_assignee(assigned_to_user_id, None, require_office=False)
            assignee_id = a["id"]
            office = a.get("office")
        else:
            office = None  # super admin without assignee → unassigned/global

    # Campaign uploads: tag + scope to the campaign's office, default unassigned.
    if campaign_id:
        if role == "staff":
            raise HTTPException(403, "Staff cannot upload to a campaign")
        cscope = {} if role == "super_admin" else {"office": user.get("office")}
        campaign = await db.campaigns.find_one(
            {**cscope, "id": campaign_id}, {"_id": 0, "id": 1, "office": 1}
        )
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        office = campaign["office"]
        assignee_id = None

    # Per-row employee lookup (office/super admins only) — name → user.
    # Scoped to the campaign's office when uploading to a campaign, otherwise the
    # office admin's own office.
    emp_map: dict = {}
    if role != "staff":
        eq = {"role": {"$in": ["staff", "office_admin"]}, "approval_status": "approved"}
        emp_office = office if campaign_id else (user.get("office") if role == "office_admin" else None)
        if emp_office:
            eq["office"] = emp_office
        emp_docs = await db.users.find(
            eq, {"_id": 0, "id": 1, "name": 1, "office": 1}
        ).to_list(2000)
        for e in emp_docs:
            key = (e.get("name") or "").strip().lower()
            if key:
                emp_map.setdefault(key, []).append(e)

    def resolve_employee(raw):
        key = (raw or "").strip().lower()
        if not key:
            return None  # no employee specified → use default
        matches = emp_map.get(key)
        if matches and len(matches) == 1:
            return matches[0]
        return False  # named but unmatched / ambiguous

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only .csv files are supported")
    try:
        text = (await file.read()).decode("utf-8-sig")
    except UnicodeDecodeError:
        text = (await file.read()).decode("latin-1", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(400, "CSV is empty")
    norm = {(h or "").strip().lower(): h for h in reader.fieldnames}
    name_h = norm.get("name")
    if not name_h:
        raise HTTPException(400, "CSV must include a 'name' column")

    def cell(row, key):
        h = norm.get(key)
        return str(row.get(h) or "").strip() if h else ""

    created: list[dict] = []
    skipped_rows: list[int] = []
    unmatched_employees: list[str] = []
    now = now_iso()
    for idx, row in enumerate(reader, start=2):
        name = str(row.get(name_h) or "").strip()
        if not name:
            skipped_rows.append(idx)
            continue
        src = cell(row, "source").lower()
        row_assignee = assignee_id
        row_office = office
        if role != "staff":
            emp_raw = cell(row, "employee") or cell(row, "assigned_to")
            if emp_raw:
                matched = resolve_employee(emp_raw)
                if matched:
                    row_assignee = matched["id"]
                    row_office = matched.get("office")
                else:
                    unmatched_employees.append(emp_raw)
        created.append({
            "id": gen_id(),
            "name": name,
            "phone": cell(row, "phone"),
            "email": cell(row, "email"),
            "course": cell(row, "course"),
            "place": cell(row, "place"),
            "source": src if src in LEAD_SOURCES else "csv",
            "status": "new",
            "assigned_to_user_id": row_assignee,
            "office": row_office,
            "campaign_id": campaign_id,
            "next_follow_up": None,
            "notes": cell(row, "notes"),
            "follow_ups": [],
            "created_by_user_id": user["id"],
            "created_at": now,
            "updated_at": now,
        })

    if created:
        await db.leads.insert_many([dict(d) for d in created])
    # Log the bulk import for the CRM Activity feed.
    if created:
        created_ids = [c["id"] for c in created]
        await log_event(
            event_type="lead.bulk_upload", actor=user,
            subject_type="lead", subject_label=f"{len(created)} leads",
            after={"count": len(created), "campaign_id": campaign_id},
            office=office,
            note=f"Uploaded {len(created)} leads" + (f" to a campaign" if campaign_id else ""),
            reversible=True,
            extras={"lead_ids": created_ids, "campaign_id": campaign_id},
        )
    # De-dupe unmatched names (case-insensitive) while preserving first spelling.
    seen: set = set()
    unmatched_unique: list[str] = []
    for n in unmatched_employees:
        k = n.strip().lower()
        if k and k not in seen:
            seen.add(k)
            unmatched_unique.append(n.strip())
    return {
        "created_count": len(created),
        "skipped_blank_rows": skipped_rows,
        "created_sample": [c["name"] for c in created[:10]],
        "unmatched_employees": unmatched_unique,
    }


# ---------- background reminder sweep ----------
async def sweep_due_followups() -> int:
    """Find open leads whose next_follow_up is due (<= now) and not yet
    reminded for that value, then notify the assignee. Idempotent per
    follow-up value. Returns the number of reminders sent."""
    now = datetime.now(timezone.utc)
    cursor = db.leads.find(
        {
            "status": {"$in": list(OPEN_STATUSES)},
            "next_follow_up": {"$ne": None},
            "assigned_to_user_id": {"$ne": None},
        },
        {"_id": 0, "id": 1, "name": 1, "next_follow_up": 1, "assigned_to_user_id": 1, "follow_up_reminded_for": 1},
    )
    sent = 0
    async for lead in cursor:
        nfu = lead.get("next_follow_up")
        if lead.get("follow_up_reminded_for") == nfu:
            continue
        dt = _parse_dt(nfu)
        if not dt or dt > now:
            continue
        await notify_users(
            [lead["assigned_to_user_id"]],
            type="lead_followup_due",
            title="Follow-up due",
            message=f"{lead.get('name')} — follow up now",
            link="/leads",
            metadata={"lead_id": lead["id"]},
        )
        await db.leads.update_one({"id": lead["id"]}, {"$set": {"follow_up_reminded_for": nfu}})
        sent += 1
    return sent

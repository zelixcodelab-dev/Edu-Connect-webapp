"""Campaigns router — group leads into campaigns and distribute them to staff.

Super Admin / Office Admin only. A campaign tags a batch of leads; admins
populate it (manual add or CSV upload, both unassigned by default) and then
distribute its leads across employees by equal / count / percentage methods.

Scope:
  - super_admin  → every campaign; must pick a target office per campaign.
  - office_admin → campaigns in their own office only.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import UpdateOne

from db import db
from auth_lib import get_current_user, gen_id, now_iso
from models import OfficeCode
from lib.lead_distribution import distribute
from lib.activity_log import log_event
from routers.leads import LEAD_SOURCES
from routers.notifications import notify_users

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])

TAG_TYPES = ("course", "place", "source")
DISTRIBUTE_METHODS = ("equal", "count", "percentage")
CAMPAIGN_STATUSES = ("draft", "active", "paused", "completed")


class CampaignIn(BaseModel):
    name: str = Field(min_length=1)
    description: Optional[str] = ""
    tag_type: Optional[str] = None      # course | place | source | None
    tag_value: Optional[str] = ""
    office: Optional[OfficeCode] = None  # required for super_admin
    # 3-step wizard extensions (all optional so existing callers still work)
    status: Optional[str] = "draft"                     # draft | active | paused | completed
    source_type: Optional[str] = None                   # walk_in / referral / social / …
    start_date: Optional[str] = None                    # ISO date (YYYY-MM-DD)
    end_date: Optional[str] = None
    owner_user_id: Optional[str] = None                 # any admin (super_admin or office_admin)
    distribute_method: Optional[str] = None             # equal | count | percentage
    distribute_employee_ids: Optional[List[str]] = None  # persisted plan for drafts


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tag_type: Optional[str] = None
    tag_value: Optional[str] = None
    status: Optional[str] = None
    source_type: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    owner_user_id: Optional[str] = None
    distribute_method: Optional[str] = None
    distribute_employee_ids: Optional[List[str]] = None


class LeadRowIn(BaseModel):
    name: str = Field(min_length=1)
    phone: Optional[str] = ""
    email: Optional[str] = ""
    course: Optional[str] = ""
    place: Optional[str] = ""
    source: Optional[str] = "other"
    notes: Optional[str] = ""


class CampaignLeadsIn(BaseModel):
    leads: List[LeadRowIn]


class DistributeIn(BaseModel):
    method: str
    employee_ids: List[str]
    counts: Optional[Dict[str, int]] = None
    percentages: Optional[Dict[str, float]] = None
    scope: str = "unassigned"  # unassigned | all


# ---------- helpers ----------
async def campaign_manager(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Not allowed")
    return user


def _scope(user: dict) -> dict:
    if user.get("role") == "super_admin":
        return {}
    return {"office": user.get("office")}


async def _get_campaign(campaign_id: str, user: dict) -> dict:
    c = await db.campaigns.find_one({**_scope(user), "id": campaign_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Campaign not found")
    return c


async def _active_user_id_set(assignee_ids: List[str]) -> set:
    """Return the subset of ``assignee_ids`` that still resolve to a real,
    non-soft-deleted user. Empty set for empty input.

    Used to distinguish real assignments from orphaned ones (a lead was
    assigned to someone who has since been deleted). Orphaned assignments
    should be treated as unassigned in stats + distribute scope."""
    if not assignee_ids:
        return set()
    users = await db.users.find(
        {"id": {"$in": list(set(assignee_ids))},
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}, {"deleted_at": ""}]},
        {"_id": 0, "id": 1},
    ).to_list(len(assignee_ids))
    return {u["id"] for u in users}


async def _stats(campaign_id: str) -> dict:
    leads = await db.leads.find(
        {"campaign_id": campaign_id}, {"_id": 0, "status": 1, "assigned_to_user_id": 1}
    ).to_list(50000)
    total = len(leads)
    assignee_ids = [l.get("assigned_to_user_id") for l in leads if l.get("assigned_to_user_id")]
    active = await _active_user_id_set(assignee_ids)
    # A lead only counts as "assigned" when its owner still exists in the
    # ``users`` collection AND is not soft-deleted. Orphaned assignments
    # (deleted employee, transferred office …) fall back to "unassigned"
    # so the Distribute dialog surfaces them again.
    assigned = sum(1 for l in leads if l.get("assigned_to_user_id") in active)
    converted = sum(1 for l in leads if l.get("status") == "converted")
    return {"total": total, "assigned": assigned, "unassigned": total - assigned, "converted": converted}


async def _office_employees(office: str) -> List[dict]:
    docs = await db.users.find(
        {"role": {"$in": ["staff", "office_admin"]}, "approval_status": "approved", "office": office},
        {"_id": 0, "id": 1, "name": 1, "role": 1, "office": 1},
    ).sort("name", 1).to_list(2000)
    return docs


# ---------- CRUD ----------
@router.post("", status_code=201)
async def create_campaign(payload: CampaignIn, user: dict = Depends(campaign_manager)):
    role = user.get("role")
    if role == "office_admin":
        office = user.get("office")
    else:
        if not payload.office:
            raise HTTPException(400, "Select a target office for the campaign")
        office = payload.office
    tag_type = payload.tag_type if payload.tag_type in TAG_TYPES else None
    status = payload.status if payload.status in CAMPAIGN_STATUSES else "draft"
    source_type = (payload.source_type or "").strip() or None
    if source_type and source_type not in LEAD_SOURCES:
        # Accept freetext but nudge unknown values to "other" so downstream
        # filters that expect a LEAD_SOURCES member don't blow up.
        source_type = "other"
    # Owner must be an approved admin if provided (defense-in-depth — the UI
    # already restricts the dropdown to super_admin / office_admin).
    owner_user_id: Optional[str] = None
    if payload.owner_user_id:
        owner = await db.users.find_one(
            {"id": payload.owner_user_id, "approval_status": "approved",
             "role": {"$in": ["super_admin", "office_admin"]}},
            {"_id": 0, "id": 1},
        )
        if not owner:
            raise HTTPException(400, "Owner must be an approved admin")
        owner_user_id = owner["id"]
    distribute_method = payload.distribute_method if payload.distribute_method in DISTRIBUTE_METHODS else None
    doc = {
        "id": gen_id(),
        "name": payload.name.strip(),
        "description": (payload.description or "").strip(),
        "tag_type": tag_type,
        "tag_value": (payload.tag_value or "").strip() if tag_type else "",
        "office": office,
        "status": status,
        "source_type": source_type,
        "start_date": (payload.start_date or "").strip() or None,
        "end_date": (payload.end_date or "").strip() or None,
        "owner_user_id": owner_user_id,
        "distribute_method": distribute_method,
        "distribute_employee_ids": payload.distribute_employee_ids or [],
        "created_by_user_id": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.campaigns.insert_one(doc)
    doc.pop("_id", None)
    return {**doc, "stats": {"total": 0, "assigned": 0, "unassigned": 0, "converted": 0}}


@router.get("")
async def list_campaigns(user: dict = Depends(campaign_manager)):
    docs = await db.campaigns.find(_scope(user), {"_id": 0}).sort("created_at", -1).to_list(2000)
    for d in docs:
        d["stats"] = await _stats(d["id"])
    return docs


@router.get("/{campaign_id}")
async def get_campaign(campaign_id: str, user: dict = Depends(campaign_manager)):
    campaign = await _get_campaign(campaign_id, user)
    employees = await _office_employees(campaign["office"])
    # Current per-employee distribution within this campaign.
    leads = await db.leads.find(
        {"campaign_id": campaign_id, "assigned_to_user_id": {"$ne": None}},
        {"_id": 0, "assigned_to_user_id": 1},
    ).to_list(50000)
    # Filter out orphaned assignees (deleted users) so the distribution row
    # never contains phantom "—" entries. Their leads are already counted as
    # unassigned by ``_stats``.
    active_ids = await _active_user_id_set([l.get("assigned_to_user_id") for l in leads])
    name_map = {e["id"]: e["name"] for e in employees}
    counts: dict = {}
    for l in leads:
        eid = l.get("assigned_to_user_id")
        if eid not in active_ids:
            continue
        counts[eid] = counts.get(eid, 0) + 1
    distribution = sorted(
        ({"id": eid, "name": name_map.get(eid, "—"), "count": c} for eid, c in counts.items()),
        key=lambda x: -x["count"],
    )
    return {
        "campaign": campaign,
        "stats": await _stats(campaign_id),
        "employees": employees,
        "distribution": distribution,
    }


@router.patch("/{campaign_id}")
async def update_campaign(campaign_id: str, payload: CampaignUpdate, user: dict = Depends(campaign_manager)):
    await _get_campaign(campaign_id, user)
    data = payload.model_dump(exclude_unset=True)
    patch: dict = {}
    if "name" in data and data["name"]:
        patch["name"] = str(data["name"]).strip()
    if "description" in data:
        patch["description"] = str(data["description"] or "").strip()
    if "tag_type" in data:
        tt = data["tag_type"] if data["tag_type"] in TAG_TYPES else None
        patch["tag_type"] = tt
        if tt is None:
            patch["tag_value"] = ""
    if "tag_value" in data:
        patch["tag_value"] = str(data["tag_value"] or "").strip()
    if "status" in data:
        v = data["status"]
        if v in CAMPAIGN_STATUSES:
            patch["status"] = v
    if "source_type" in data:
        v = (data["source_type"] or "").strip() or None
        if v and v not in LEAD_SOURCES:
            v = "other"
        patch["source_type"] = v
    for k in ("start_date", "end_date"):
        if k in data:
            patch[k] = (data[k] or "").strip() or None
    if "owner_user_id" in data:
        v = data["owner_user_id"]
        if v:
            owner = await db.users.find_one(
                {"id": v, "approval_status": "approved",
                 "role": {"$in": ["super_admin", "office_admin"]}},
                {"_id": 0, "id": 1},
            )
            if not owner:
                raise HTTPException(400, "Owner must be an approved admin")
            patch["owner_user_id"] = owner["id"]
        else:
            patch["owner_user_id"] = None
    if "distribute_method" in data:
        v = data["distribute_method"]
        patch["distribute_method"] = v if v in DISTRIBUTE_METHODS else None
    if "distribute_employee_ids" in data:
        patch["distribute_employee_ids"] = list(data["distribute_employee_ids"] or [])
    if patch:
        patch["updated_at"] = now_iso()
        await db.campaigns.update_one({"id": campaign_id}, {"$set": patch})
    fresh = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    return {**fresh, "stats": await _stats(campaign_id)}


@router.delete("/{campaign_id}")
async def delete_campaign(
    campaign_id: str,
    delete_leads: bool = Query(False, description="Also delete the campaign's leads"),
    user: dict = Depends(campaign_manager),
):
    campaign = await _get_campaign(campaign_id, user)
    # Snapshot the leads we're about to purge so a restore can bring them
    # back verbatim. Skip when we're only detaching (leads stay in DB).
    purged_snapshot: list = []
    if delete_leads:
        purged_snapshot = await db.leads.find({"campaign_id": campaign_id}).to_list(50000)
        for row in purged_snapshot:
            row.pop("_id", None)
        removed = await db.leads.delete_many({"campaign_id": campaign_id})
        removed_leads = removed.deleted_count
    else:
        await db.leads.update_many({"campaign_id": campaign_id}, {"$set": {"campaign_id": None}})
        removed_leads = 0
    await db.campaigns.delete_one({"id": campaign_id})
    campaign.pop("_id", None)
    await log_event(
        event_type="campaign.deleted", actor=user,
        subject_type="campaign", subject_id=campaign_id, subject_label=campaign.get("name"),
        before={"campaign": campaign, "leads": purged_snapshot, "delete_leads": delete_leads},
        office=campaign.get("office"),
        note=f"Deleted campaign {campaign.get('name')}"
             + (f" (+ {removed_leads} leads)" if removed_leads else ""),
        reversible=True,
    )
    return {"ok": True, "removed_leads": removed_leads}


class BulkCampaignIdsIn(BaseModel):
    ids: List[str] = Field(min_length=1)
    delete_leads: bool = False


@router.post("/bulk-delete")
async def bulk_delete_campaigns(
    payload: BulkCampaignIdsIn, user: dict = Depends(campaign_manager)
) -> dict:
    """Delete multiple campaigns in one shot.

    * ``delete_leads=False`` (default) → leads keep their rows but their
      ``campaign_id`` is cleared.
    * ``delete_leads=True``            → each lead attached to the deleted
      campaigns is also purged from ``leads``.

    Scope: super_admin (all offices) / office_admin (own office only)."""
    ids = list({i for i in payload.ids if i})
    if not ids:
        raise HTTPException(400, "No campaigns selected")
    visible = await db.campaigns.find(
        {**_scope(user), "id": {"$in": ids}}, {"_id": 0, "id": 1}
    ).to_list(len(ids))
    if not visible:
        raise HTTPException(404, "No matching campaigns in your scope")
    visible_ids = [d["id"] for d in visible]
    # Snapshot campaigns + optionally their leads so /activity-log/restore
    # can bring them back.
    snap_campaigns = await db.campaigns.find({"id": {"$in": visible_ids}}).to_list(len(visible_ids))
    for c in snap_campaigns:
        c.pop("_id", None)
    snap_leads: list = []
    removed_leads = 0
    if payload.delete_leads:
        snap_leads = await db.leads.find({"campaign_id": {"$in": visible_ids}}).to_list(50000)
        for l in snap_leads:
            l.pop("_id", None)
        purged = await db.leads.delete_many({"campaign_id": {"$in": visible_ids}})
        removed_leads = purged.deleted_count
    else:
        await db.leads.update_many({"campaign_id": {"$in": visible_ids}}, {"$set": {"campaign_id": None}})
    res = await db.campaigns.delete_many({"id": {"$in": visible_ids}})
    # Human-friendly label: when just one campaign was deleted, show its name
    # so the Activity page reads "Campaign deleted — <name>" instead of the
    # generic "1 campaigns".
    if res.deleted_count == 1 and snap_campaigns:
        _cname = snap_campaigns[0].get("name") or "1 campaign"
        _label = _cname
        _note = f"Deleted campaign {_cname}" + (
            f" (+ {removed_leads} leads)" if removed_leads else ""
        )
    else:
        _label = f"{res.deleted_count} campaigns"
        _note = f"Bulk deleted {res.deleted_count} campaigns" + (
            f" (+ {removed_leads} leads)" if removed_leads else ""
        )
    await log_event(
        event_type="campaign.bulk_delete", actor=user,
        subject_type="campaign", subject_label=_label,
        before={"campaigns": snap_campaigns, "leads": snap_leads, "delete_leads": payload.delete_leads},
        note=_note,
        extras={"campaign_ids": visible_ids, "removed_leads": removed_leads},
        reversible=True,
    )
    return {"ok": True, "affected_ids": visible_ids, "count": res.deleted_count,
            "removed_leads": removed_leads}


# ---------- populate ----------
@router.post("/{campaign_id}/leads", status_code=201)
async def add_campaign_leads(campaign_id: str, payload: CampaignLeadsIn, user: dict = Depends(campaign_manager)):
    campaign = await _get_campaign(campaign_id, user)
    now = now_iso()
    docs = []
    for row in payload.leads:
        if not (row.name or "").strip():
            continue
        src = row.source if row.source in LEAD_SOURCES else "other"
        docs.append({
            "id": gen_id(),
            "name": row.name.strip(),
            "phone": (row.phone or "").strip(),
            "email": (row.email or "").strip(),
            "course": (row.course or "").strip(),
            "place": (row.place or "").strip(),
            "source": src,
            "status": "new",
            "assigned_to_user_id": None,
            "office": campaign["office"],
            "campaign_id": campaign_id,
            "next_follow_up": None,
            "notes": (row.notes or "").strip(),
            "follow_ups": [],
            "created_by_user_id": user["id"],
            "created_at": now,
            "updated_at": now,
        })
    if docs:
        await db.leads.insert_many(docs)
    return {"created_count": len(docs), "stats": await _stats(campaign_id)}


# ---------- distribute ----------
@router.post("/{campaign_id}/distribute")
async def distribute_campaign(campaign_id: str, payload: DistributeIn, user: dict = Depends(campaign_manager)):
    campaign = await _get_campaign(campaign_id, user)
    if payload.method not in DISTRIBUTE_METHODS:
        raise HTTPException(400, "Invalid distribution method")

    valid = {e["id"]: e for e in await _office_employees(campaign["office"])}
    emp_ids = [eid for eid in payload.employee_ids if eid in valid]
    if not emp_ids:
        raise HTTPException(400, "Select at least one employee from this office")

    lead_q: dict = {"campaign_id": campaign_id}
    if payload.scope != "all":
        # "Unassigned" scope = truly unassigned OR orphaned to a deleted user.
        # Include the orphaned set so we don't strand 198 leads with a stale
        # ``assigned_to_user_id`` pointing at a removed employee.
        all_leads = await db.leads.find(
            {"campaign_id": campaign_id, "assigned_to_user_id": {"$ne": None}},
            {"_id": 0, "assigned_to_user_id": 1},
        ).to_list(50000)
        active_ids = await _active_user_id_set([l.get("assigned_to_user_id") for l in all_leads])
        lead_q["$or"] = [
            {"assigned_to_user_id": None},
            {"assigned_to_user_id": {"$exists": False}},
            {"assigned_to_user_id": {"$nin": list(active_ids)}},
        ]
    leads = await db.leads.find(lead_q, {"_id": 0, "id": 1}).sort("created_at", 1).to_list(50000)
    lead_ids = [l["id"] for l in leads]
    if not lead_ids:
        raise HTTPException(400, "No leads to distribute for the selected scope")

    assignments = distribute(
        lead_ids, payload.method, emp_ids,
        counts=payload.counts, percentages=payload.percentages,
    )
    if not assignments:
        raise HTTPException(400, "Nothing was distributed — check your counts/percentages")

    now = now_iso()
    per_emp: dict = {}
    ops = []
    for lid, eid in assignments:
        ops.append(UpdateOne(
            {"id": lid},
            {"$set": {"assigned_to_user_id": eid, "office": campaign["office"], "updated_at": now}},
        ))
        per_emp[eid] = per_emp.get(eid, 0) + 1
    if ops:
        await db.leads.bulk_write(ops)

    # Notify each employee once with their batch size.
    for eid, cnt in per_emp.items():
        await notify_users(
            [eid],
            type="leads_assigned",
            title=f"{cnt} new lead(s) assigned",
            message=f"From campaign “{campaign['name']}”",
            link="/leads",
            actor_user_id=user["id"],
            metadata={"campaign_id": campaign_id},
        )

    summary = sorted(
        ({"id": eid, "name": valid[eid]["name"], "count": cnt} for eid, cnt in per_emp.items()),
        key=lambda x: -x["count"],
    )
    return {
        "assigned": len(assignments),
        "targeted": len(lead_ids),
        "per_employee": summary,
        "stats": await _stats(campaign_id),
    }

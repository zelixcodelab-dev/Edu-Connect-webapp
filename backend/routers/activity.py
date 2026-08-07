"""CRM Activity Log — timeline + restore endpoints.

Auth: admin-only (super_admin / office_admin). office_admin sees only
their office's events (matched on either ``office`` or ``actor_office`` so
we surface actions BY their staff even when a lead lives in another office).

Restore support (only where ``reversible=True`` on the event):
  * lead.deleted             → re-insert the single lead
  * lead.bulk_delete         → re-insert all leads in the snapshot
  * lead.bulk_upload         → delete the leads created in this batch
  * lead.followup.deleted    → re-push the follow-up back into the array
                              (re-arms next_follow_up if it was the latest)
  * lead.followup.edited     → put the old at/note back on the entry
  * campaign.deleted         → re-insert the campaign (+ its leads if any)
  * campaign.bulk_delete     → re-insert campaigns + their snapshot leads
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from db import db
from auth_lib import get_current_user, now_iso

router = APIRouter(prefix="/api/activity-log", tags=["activity"])
log = logging.getLogger("activity_log_api")


def _require_admin(user: dict) -> None:
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Admin access required")


def _scope(user: dict) -> dict:
    """office_admins only see events tagged to their office (or performed by
    someone in their office). super_admin sees everything."""
    if user.get("role") == "super_admin":
        return {}
    office = user.get("office")
    return {"$or": [{"office": office}, {"actor_office": office}]}


@router.get("")
async def list_activity(
    limit: int = Query(100, ge=1, le=500),
    subject_type: Optional[str] = Query(None, description="lead | campaign | user | student"),
    event_type: Optional[str] = Query(None, description="filter by exact event type"),
    q: Optional[str] = Query(None, description="fuzzy search on actor name / subject label / note"),
    reversible: Optional[bool] = Query(None, description="return only reversible events"),
    user: dict = Depends(get_current_user),
):
    """Latest activity events, newest first, capped at ``limit``."""
    _require_admin(user)
    filt: dict = _scope(user)
    if subject_type:
        filt["subject_type"] = subject_type
    if event_type:
        filt["type"] = event_type
    if reversible is not None:
        filt["reversible"] = reversible
    if q:
        # Case-insensitive contains on the three denormalised text fields.
        rx = {"$regex": q.strip(), "$options": "i"}
        filt.setdefault("$and", []).append({"$or": [
            {"actor_name": rx}, {"subject_label": rx}, {"note": rx},
        ]})
    # `at_dt` is BSON Date so sort is O(index).
    cursor = db.activity_log.find(filt, {"_id": 0}).sort("at_dt", -1).limit(limit)
    items = await cursor.to_list(limit)
    return {"items": items, "count": len(items)}


async def _restore_lead_deleted(ev: dict) -> dict:
    lead = ev.get("before") or None
    if not lead or not lead.get("id"):
        raise HTTPException(400, "Snapshot missing — cannot restore")
    # Only re-insert if the row is truly gone.
    if await db.leads.find_one({"id": lead["id"]}, {"_id": 0, "id": 1}):
        raise HTTPException(409, "Lead already exists — nothing to restore")
    await db.leads.insert_one(dict(lead))
    return {"restored_lead_id": lead["id"]}


async def _restore_bulk_delete(ev: dict) -> dict:
    leads = (ev.get("before") or {}).get("leads") or []
    if not leads:
        raise HTTPException(400, "Snapshot missing — cannot restore")
    existing_docs = await db.leads.find(
        {"id": {"$in": [l["id"] for l in leads]}}, {"_id": 0, "id": 1}
    ).to_list(len(leads))
    existing = {r["id"] for r in existing_docs}
    to_insert = [l for l in leads if l["id"] not in existing]
    if not to_insert:
        raise HTTPException(409, "All leads already exist — nothing to restore")
    await db.leads.insert_many([dict(l) for l in to_insert])
    return {"restored_lead_count": len(to_insert), "skipped_existing": len(leads) - len(to_insert)}


async def _restore_bulk_upload(ev: dict) -> dict:
    lead_ids = ev.get("lead_ids") or []
    if not lead_ids:
        raise HTTPException(400, "No lead ids recorded on this upload")
    res = await db.leads.delete_many({"id": {"$in": lead_ids}})
    return {"deleted_count": res.deleted_count}


async def _restore_followup_deleted(ev: dict) -> dict:
    before = ev.get("before") or {}
    fu = before.get("follow_up")
    if not fu:
        raise HTTPException(400, "Snapshot missing — cannot restore")
    lead_id = ev.get("subject_id")
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0, "id": 1, "next_follow_up": 1, "follow_ups": 1})
    if not lead:
        raise HTTPException(404, "Lead no longer exists")
    # Avoid duplicate id if the operator clicked restore twice.
    if any(f.get("id") == fu.get("id") for f in (lead.get("follow_ups") or [])):
        raise HTTPException(409, "Follow-up already restored")
    set_ops: dict = {"updated_at": now_iso()}
    prev_next = before.get("prev_next_follow_up")
    if prev_next and prev_next == fu.get("at"):
        set_ops["next_follow_up"] = prev_next
        set_ops["follow_up_reminded_for"] = None
    await db.leads.update_one(
        {"id": lead_id},
        {"$push": {"follow_ups": fu}, "$set": set_ops},
    )
    return {"restored_followup_id": fu.get("id"), "lead_id": lead_id}


async def _restore_followup_edited(ev: dict) -> dict:
    before = ev.get("before") or {}
    fu_id = before.get("follow_up_id")
    if not fu_id:
        raise HTTPException(400, "Snapshot missing — cannot restore")
    lead_id = ev.get("subject_id")
    lead = await db.leads.find_one({"id": lead_id, "follow_ups.id": fu_id}, {"_id": 0, "id": 1, "next_follow_up": 1})
    if not lead:
        raise HTTPException(404, "Follow-up no longer exists")
    set_ops: dict = {"updated_at": now_iso()}
    if before.get("at") is not None:
        set_ops["follow_ups.$.at"] = before["at"]
    if before.get("note") is not None:
        set_ops["follow_ups.$.note"] = before["note"]
    # If the current after.at was the surface next_follow_up, roll it back too.
    after = ev.get("after") or {}
    if lead.get("next_follow_up") == after.get("at") and before.get("at"):
        set_ops["next_follow_up"] = before["at"]
        set_ops["follow_up_reminded_for"] = None
    await db.leads.update_one(
        {"id": lead_id, "follow_ups.id": fu_id},
        {"$set": set_ops},
    )
    return {"reverted_followup_id": fu_id, "lead_id": lead_id}


async def _restore_campaign_deleted(ev: dict, bulk: bool = False) -> dict:
    before = ev.get("before") or {}
    campaigns_snap = before.get("campaigns") if bulk else [before.get("campaign")]
    leads_snap = before.get("leads") or []
    delete_leads_flag = before.get("delete_leads")
    campaigns_snap = [c for c in (campaigns_snap or []) if c]
    if not campaigns_snap:
        raise HTTPException(400, "Snapshot missing — cannot restore")

    existing = {c["id"] for c in await db.campaigns.find(
        {"id": {"$in": [c["id"] for c in campaigns_snap]}}, {"_id": 0, "id": 1}
    ).to_list(len(campaigns_snap))}
    to_insert = [c for c in campaigns_snap if c["id"] not in existing]
    inserted_campaigns = 0
    if to_insert:
        await db.campaigns.insert_many([dict(c) for c in to_insert])
        inserted_campaigns = len(to_insert)

    inserted_leads = 0
    if delete_leads_flag and leads_snap:
        existing_lead_docs = await db.leads.find(
            {"id": {"$in": [l["id"] for l in leads_snap]}}, {"_id": 0, "id": 1}
        ).to_list(len(leads_snap))
        existing_lead_ids = {r["id"] for r in existing_lead_docs}
        to_insert_leads = [l for l in leads_snap if l["id"] not in existing_lead_ids]
        if to_insert_leads:
            await db.leads.insert_many([dict(l) for l in to_insert_leads])
            inserted_leads = len(to_insert_leads)
    else:
        # Non-purge deletes just cleared campaign_id; we can re-attach the tag.
        campaign_ids = [c["id"] for c in campaigns_snap]
        # We can't reliably re-tag leads without knowing which ones belonged
        # to which campaign — skip this rehydration and let the operator retag.
        _ = campaign_ids

    return {
        "restored_campaign_count": inserted_campaigns,
        "restored_lead_count": inserted_leads,
    }


_RESTORERS = {
    "lead.deleted": _restore_lead_deleted,
    "lead.bulk_delete": _restore_bulk_delete,
    "lead.bulk_upload": _restore_bulk_upload,
    "lead.followup.deleted": _restore_followup_deleted,
    "lead.followup.edited": _restore_followup_edited,
    "campaign.deleted": lambda ev: _restore_campaign_deleted(ev, bulk=False),
    "campaign.bulk_delete": lambda ev: _restore_campaign_deleted(ev, bulk=True),
}


@router.post("/{event_id}/restore")
async def restore_event(event_id: str, user: dict = Depends(get_current_user)):
    """Reverse the effect of a previously logged event, when possible."""
    _require_admin(user)
    ev = await db.activity_log.find_one({**_scope(user), "id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.get("reversible"):
        raise HTTPException(400, "This event cannot be restored")
    if ev.get("restored"):
        raise HTTPException(409, "This event has already been restored")
    handler = _RESTORERS.get(ev.get("type"))
    if not handler:
        raise HTTPException(400, f"No restore handler for {ev.get('type')}")

    result = await handler(ev)

    await db.activity_log.update_one(
        {"id": event_id},
        {"$set": {
            "restored": True,
            "restored_at": now_iso(),
            "restored_by": user.get("id"),
            "restored_by_name": user.get("name"),
        }},
    )
    return {"ok": True, "event_id": event_id, "result": result}

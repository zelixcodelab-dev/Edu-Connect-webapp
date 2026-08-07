"""Leave Request & Management.

Requesters: staff + office_admin (+ super_admin for completeness).
Approval hierarchy (single-level per requester):
  - staff        → approved by an Office Admin of their office (super admin may also act)
  - office_admin → approved by a Super Admin
  - super_admin  → approved by a Super Admin peer

Boxes:
  - mine  : requests I submitted
  - inbox : requests awaiting / handled by me as approver
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from auth_lib import get_current_user, gen_id, now_iso, require_edit
from routers.notifications import notify_users

router = APIRouter(prefix="/api/leave", tags=["leave"])

LEAVE_TYPES = ("casual", "sick", "earned", "unpaid")


class LeaveIn(BaseModel):
    leave_type: str = "casual"
    from_date: str  # YYYY-MM-DD
    to_date: str
    reason: str = Field(default="", max_length=1000)


class LeaveDecision(BaseModel):
    status: Literal["approved", "rejected"]
    note: Optional[str] = ""


def _days(from_date: str, to_date: str) -> int:
    try:
        a = date.fromisoformat(from_date)
        b = date.fromisoformat(to_date)
        return max(1, (b - a).days + 1)
    except (TypeError, ValueError):
        return 1


async def _approver_ids(requester: dict) -> list[str]:
    role = requester.get("role")
    if role == "staff":
        q = {"role": "office_admin", "approval_status": "approved", "office": requester.get("office")}
    elif role == "office_admin":
        q = {"role": "super_admin"}
    else:  # super_admin requester → notify peer super admins
        q = {"role": "super_admin"}
    docs = await db.users.find(q, {"_id": 0, "id": 1}).to_list(100)
    return [d["id"] for d in docs if d["id"] != requester["id"]]


def _can_approve(approver: dict, req: dict) -> bool:
    if req.get("requester_user_id") == approver["id"]:
        return False  # never self-approve
    rrole = req.get("requester_role")
    arole = approver.get("role")
    if rrole == "staff":
        return arole == "super_admin" or (arole == "office_admin" and approver.get("office") == req.get("office"))
    # office_admin & super_admin requests are approved by super admins
    return arole == "super_admin"


@router.post("", status_code=201)
async def create_leave(payload: LeaveIn, user: dict = Depends(require_edit("leave"))):
    if payload.leave_type not in LEAVE_TYPES:
        raise HTTPException(400, "Invalid leave type")
    if payload.to_date < payload.from_date:
        raise HTTPException(400, "End date can't be before start date")
    now = now_iso()
    doc = {
        "id": gen_id(),
        "requester_user_id": user["id"],
        "requester_name": user.get("name") or user.get("email"),
        "requester_role": user.get("role"),
        "office": user.get("office"),
        "leave_type": payload.leave_type,
        "from_date": payload.from_date,
        "to_date": payload.to_date,
        "days": _days(payload.from_date, payload.to_date),
        "reason": (payload.reason or "").strip(),
        "status": "pending",
        "approver_user_id": None,
        "approver_name": None,
        "decided_at": None,
        "decision_note": "",
        "created_at": now,
        "updated_at": now,
    }
    await db.leave_requests.insert_one(doc)
    doc.pop("_id", None)
    approvers = await _approver_ids(user)
    if approvers:
        await notify_users(
            approvers,
            type="leave_request",
            title="New leave request",
            message=f"{doc['requester_name']} · {payload.leave_type.title()} · {payload.from_date} → {payload.to_date}",
            link="/leave",
            actor_user_id=user["id"],
            metadata={"leave_id": doc["id"]},
        )
    return doc


@router.get("")
async def list_leave(
    box: Literal["mine", "inbox"] = "mine",
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ("super_admin", "office_admin", "staff"):
        raise HTTPException(403, "Not allowed")
    if box == "mine":
        q = {"requester_user_id": user["id"]}
    else:  # inbox — requests I can act on
        role = user.get("role")
        if role == "office_admin":
            q = {"requester_role": "staff", "office": user.get("office")}
        elif role == "super_admin":
            q = {"requester_role": {"$in": ["office_admin", "super_admin"]}, "requester_user_id": {"$ne": user["id"]}}
        else:
            return []  # staff have no approval inbox
    docs = await db.leave_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@router.get("/stats")
async def leave_stats(user: dict = Depends(get_current_user)):
    mine = await db.leave_requests.find({"requester_user_id": user["id"]}, {"_id": 0, "status": 1}).to_list(1000)
    pending_mine = sum(1 for d in mine if d.get("status") == "pending")
    pending_inbox = 0
    role = user.get("role")
    if role in ("office_admin", "super_admin"):
        if role == "office_admin":
            iq = {"requester_role": "staff", "office": user.get("office"), "status": "pending"}
        else:
            iq = {"requester_role": {"$in": ["office_admin", "super_admin"]}, "requester_user_id": {"$ne": user["id"]}, "status": "pending"}
        pending_inbox = await db.leave_requests.count_documents(iq)
    return {"pending_mine": pending_mine, "pending_inbox": pending_inbox, "total_mine": len(mine)}


DEFAULT_QUOTAS = {"casual": 12, "sick": 6, "earned": 15, "unpaid": None}


async def _get_quotas() -> dict:
    doc = await db.app_settings.find_one({"key": "leave_quotas"})
    q = dict(DEFAULT_QUOTAS)
    if doc and isinstance(doc.get("value"), dict):
        for k in DEFAULT_QUOTAS:
            if k in doc["value"]:
                q[k] = doc["value"][k]
    return q


class QuotasIn(BaseModel):
    casual: int = Field(default=12, ge=0)
    sick: int = Field(default=6, ge=0)
    earned: int = Field(default=15, ge=0)
    unpaid: Optional[int] = None  # None = unlimited


@router.get("/quotas")
async def get_quotas(user: dict = Depends(get_current_user)):
    return await _get_quotas()


@router.put("/quotas")
async def set_quotas(payload: QuotasIn, user: dict = Depends(get_current_user)):
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    val = payload.model_dump()
    await db.app_settings.update_one(
        {"key": "leave_quotas"}, {"$set": {"key": "leave_quotas", "value": val}}, upsert=True
    )
    return val


# ---------- Per-staff quota overrides ----------
async def _effective_quota(target: dict) -> dict:
    """Effective quota for a user = global policy, with any per-user override
    merged on top. An override is stored on the user doc under `leave_quota`."""
    glob = await _get_quotas()
    ov = target.get("leave_quota")
    if isinstance(ov, dict):
        q = dict(glob)
        for k in DEFAULT_QUOTAS:
            if k in ov:
                q[k] = ov[k]
        return q
    return glob


async def _resolve_quota_target(user_id: str, actor: dict) -> dict:
    """Fetch the target user and assert the actor may manage their quota.
    Super admin → any staff / office admin. Office admin → staff in own office."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    arole = actor.get("role")
    trole = target.get("role")
    if arole == "super_admin":
        if trole not in ("staff", "office_admin"):
            raise HTTPException(400, "Quotas apply to staff and office admins")
    elif arole == "office_admin":
        if trole != "staff" or target.get("office") != actor.get("office"):
            raise HTTPException(403, "You can only manage staff in your office")
    else:
        raise HTTPException(403, "Not allowed")
    return target


@router.get("/quotas/team")
async def quota_team(user: dict = Depends(get_current_user)):
    """List the people whose quotas the current user can manage, each with
    their effective quota + whether they carry a per-user override."""
    role = user.get("role")
    if role == "super_admin":
        q = {"role": {"$in": ["staff", "office_admin"]}, "approval_status": "approved"}
    elif role == "office_admin":
        q = {"role": "staff", "office": user.get("office"), "approval_status": "approved"}
    else:
        raise HTTPException(403, "Not allowed")
    docs = await db.users.find(
        q,
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "office": 1, "leave_quota": 1},
    ).sort("name", 1).to_list(1000)
    glob = await _get_quotas()
    members = []
    for d in docs:
        ov = d.get("leave_quota")
        has = isinstance(ov, dict)
        eff = dict(glob)
        if has:
            for k in DEFAULT_QUOTAS:
                if k in ov:
                    eff[k] = ov[k]
        members.append({
            "id": d["id"], "name": d.get("name"), "email": d.get("email"),
            "role": d.get("role"), "office": d.get("office"),
            "quota": eff, "has_override": has,
        })
    return {"global": glob, "members": members}


@router.get("/quotas/user/{user_id}")
async def quota_user(user_id: str, user: dict = Depends(get_current_user)):
    target = await _resolve_quota_target(user_id, user)
    return {
        "user_id": user_id,
        "name": target.get("name"),
        "role": target.get("role"),
        "office": target.get("office"),
        "quota": await _effective_quota(target),
        "has_override": isinstance(target.get("leave_quota"), dict),
        "global": await _get_quotas(),
    }


@router.put("/quotas/user/{user_id}")
async def set_quota_user(user_id: str, payload: QuotasIn, user: dict = Depends(get_current_user)):
    await _resolve_quota_target(user_id, user)
    val = payload.model_dump()
    await db.users.update_one({"id": user_id}, {"$set": {"leave_quota": val}})
    return {"ok": True, "user_id": user_id, "quota": val, "has_override": True}


@router.delete("/quotas/user/{user_id}")
async def clear_quota_user(user_id: str, user: dict = Depends(get_current_user)):
    await _resolve_quota_target(user_id, user)
    await db.users.update_one({"id": user_id}, {"$unset": {"leave_quota": ""}})
    return {"ok": True, "user_id": user_id, "has_override": False}


@router.get("/balance")
async def my_balance(user: dict = Depends(get_current_user)):
    """Per-type leave balance for the current user, this calendar year.
    Honours a per-user override when one is set, else the global policy."""
    quotas = await _effective_quota(user)
    year = datetime.now(timezone.utc).year
    approved = await db.leave_requests.find(
        {"requester_user_id": user["id"], "status": "approved"},
        {"_id": 0, "leave_type": 1, "days": 1, "from_date": 1},
    ).to_list(2000)
    used = {k: 0 for k in LEAVE_TYPES}
    for a in approved:
        try:
            if int(str(a.get("from_date", ""))[:4]) != year:
                continue
        except (ValueError, TypeError):
            pass
        t = a.get("leave_type")
        if t in used:
            used[t] += int(a.get("days", 0) or 0)
    by_type = {}
    for t in LEAVE_TYPES:
        quota = quotas.get(t)
        by_type[t] = {
            "quota": quota,
            "used": used[t],
            "remaining": None if quota is None else max(0, quota - used[t]),
        }
    return {"year": year, "by_type": by_type}


@router.get("/calendar")
async def leave_calendar(
    month: str,
    user: dict = Depends(get_current_user),
    office: Optional[str] = None,
    member: Optional[str] = None,
):
    """Approved leaves overlapping a YYYY-MM month, scoped by role.
    Optional filters: `office` (super admin only) and `member` (requester id)."""
    try:
        y, m = month.split("-")
        y, m = int(y), int(m)
        if not (1 <= m <= 12):
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(400, "month must be YYYY-MM")
    from calendar import monthrange
    start = f"{y:04d}-{m:02d}-01"
    end = f"{y:04d}-{m:02d}-{monthrange(y, m)[1]:02d}"

    role = user.get("role")
    q: dict = {"status": "approved"}
    if role == "staff":
        q["requester_user_id"] = user["id"]
    elif role == "office_admin":
        q["office"] = user.get("office")
    elif role == "super_admin" and office:
        q["office"] = office
    if member:
        q["requester_user_id"] = member
    docs = await db.leave_requests.find(
        q,
        {"_id": 0, "id": 1, "requester_name": 1, "requester_role": 1, "leave_type": 1,
         "from_date": 1, "to_date": 1, "days": 1},
    ).to_list(3000)
    return [d for d in docs if not (d.get("to_date", "") < start or d.get("from_date", "") > end)]


@router.patch("/{leave_id}")
async def decide_leave(leave_id: str, payload: LeaveDecision, user: dict = Depends(require_edit("leave"))):
    req = await db.leave_requests.find_one({"id": leave_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Leave request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, "This request has already been decided")
    if not _can_approve(user, req):
        raise HTTPException(403, "You can't decide this leave request")
    now = now_iso()
    await db.leave_requests.update_one(
        {"id": leave_id},
        {"$set": {
            "status": payload.status,
            "approver_user_id": user["id"],
            "approver_name": user.get("name") or user.get("email"),
            "decided_at": now,
            "decision_note": (payload.note or "").strip(),
            "updated_at": now,
        }},
    )
    await notify_users(
        [req["requester_user_id"]],
        type="leave_decision",
        title=f"Leave {payload.status}",
        message=f"{req['leave_type'].title()} {req['from_date']} → {req['to_date']} was {payload.status} by {user.get('name')}",
        link="/leave",
        actor_user_id=user["id"],
        metadata={"leave_id": leave_id},
    )
    return await db.leave_requests.find_one({"id": leave_id}, {"_id": 0})


@router.delete("/{leave_id}")
async def cancel_leave(leave_id: str, user: dict = Depends(require_edit("leave"))):
    """Requester cancels their own still-pending request."""
    req = await db.leave_requests.find_one({"id": leave_id}, {"_id": 0, "requester_user_id": 1, "status": 1})
    if not req:
        raise HTTPException(404, "Leave request not found")
    if req.get("requester_user_id") != user["id"]:
        raise HTTPException(403, "You can only cancel your own request")
    if req.get("status") != "pending":
        raise HTTPException(400, "Only pending requests can be cancelled")
    await db.leave_requests.delete_one({"id": leave_id})
    return {"ok": True}

"""Offices: company-side list + branch requests, and platform-owner management."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth_lib import get_current_user, gen_id, now_iso
from db import gdb, get_current_tenant
from lib.offices import active_offices, new_code
from routers.platform import require_permission

router = APIRouter(prefix="/api/offices", tags=["offices"])
platform = APIRouter(prefix="/api/platform", tags=["platform-offices"])


def _tenant_id(user: dict) -> str:
    return user.get("tenant_id") or get_current_tenant()


@router.get("")
async def list_offices(user: dict = Depends(get_current_user)):
    t = await gdb.tenants.find_one({"id": _tenant_id(user)}, {"_id": 0, "offices": 1}) or {}
    return {"offices": active_offices(t)}


class BranchRequestIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    note: str = Field(default="", max_length=300)


@router.get("/requests")
async def my_requests(user: dict = Depends(get_current_user)):
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Only the company admin can view branch requests")
    items = await gdb.office_requests.find({"tenant_id": _tenant_id(user)}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"items": items}


@router.post("/requests", status_code=201)
async def request_branch(payload: BranchRequestIn, user: dict = Depends(get_current_user)):
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Only the company admin can request a new branch")
    tid = _tenant_id(user)
    if await gdb.office_requests.find_one({"tenant_id": tid, "status": "pending", "name": payload.name.strip()}):
        raise HTTPException(409, "A request for this branch is already pending")
    t = await gdb.tenants.find_one({"id": tid}, {"_id": 0, "name": 1})
    doc = {"id": gen_id(), "tenant_id": tid, "tenant_name": (t or {}).get("name"), "name": payload.name.strip(),
           "note": payload.note.strip(), "status": "pending", "requested_by": user.get("name") or user.get("email"),
           "created_at": now_iso()}
    await gdb.office_requests.insert_one({**doc})
    return doc


# ---------- platform owner ----------
class OfficeIn(BaseModel):
    code: Optional[str] = None
    name: str = Field(min_length=1, max_length=60)
    active: bool = True


class OfficesIn(BaseModel):
    offices: List[OfficeIn]


def _clean(offices: List[OfficeIn], existing: list) -> list:
    known = {o["code"] for o in existing}
    out, used = [], set()
    for i, o in enumerate(offices):
        code = o.code if o.code in known else None
        if not code:
            n, code = 0, new_code(o.name)
            while code in used or code in known:
                n += 1
                code = new_code(o.name, n)
        if code in used:
            raise HTTPException(400, "Duplicate office")
        used.add(code)
        out.append({"code": code, "name": o.name.strip(), "active": o.active})
    # Offices can be hidden but never deleted (records keep their office code).
    for o in existing:
        if o["code"] not in used:
            out.append({**o, "active": False})
    if not any(o["active"] for o in out):
        raise HTTPException(400, "Keep at least one office active")
    return out


@platform.put("/tenants/{tenant_id}/offices")
async def set_offices(tenant_id: str, payload: OfficesIn, owner: dict = Depends(require_permission("client.edit"))):
    t = await gdb.tenants.find_one({"id": tenant_id}, {"_id": 0, "offices": 1})
    if not t:
        raise HTTPException(404, "Client not found")
    offices = _clean(payload.offices, t.get("offices") or [])
    await gdb.tenants.update_one({"id": tenant_id}, {"$set": {"offices": offices}})
    return {"offices": offices}


@platform.get("/office-requests")
async def list_requests(status: str = "pending", tenant_id: Optional[str] = None, owner: dict = Depends(require_permission("client.view"))):
    q = {"status": status} if status != "all" else {}
    if tenant_id:
        q["tenant_id"] = tenant_id
    return {"items": await gdb.office_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)}


class DecisionIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=60)


@platform.post("/office-requests/{req_id}/{decision}")
async def decide(req_id: str, decision: str, payload: DecisionIn, owner: dict = Depends(require_permission("client.edit"))):
    if decision not in ("approve", "reject"):
        raise HTTPException(404, "Unknown action")
    r = await gdb.office_requests.find_one({"id": req_id, "status": "pending"}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Request not found or already decided")
    office = None
    if decision == "approve":
        t = await gdb.tenants.find_one({"id": r["tenant_id"]}, {"_id": 0, "offices": 1}) or {}
        existing = t.get("offices") or []
        name = (payload.name or r["name"]).strip()
        offices = _clean([OfficeIn(**o) for o in existing] + [OfficeIn(name=name)], existing)
        office = offices[len(existing)]
        await gdb.tenants.update_one({"id": r["tenant_id"]}, {"$set": {"offices": offices}})
    await gdb.office_requests.update_one({"id": req_id}, {"$set": {
        "status": "approved" if office else "rejected", "decided_at": now_iso(),
        "office_code": office["code"] if office else None}})
    return {"ok": True, "office": office}

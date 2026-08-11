"""Connect — client support & complaint management (real tickets).

Tickets live in the shared platform DB (``gdb.tickets``). Only platform staff
with the appropriate ticket.* permission may act. Every ticket carries a full
conversation timeline (client messages, staff replies, internal notes) plus an
SLA target derived from priority.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from db import gdb
from auth_lib import now_iso, gen_id
from routers.platform import require_permission, record_audit

router = APIRouter(prefix="/api/platform/connect", tags=["connect"])
log = logging.getLogger("connect")

STATUSES = ["open", "assigned", "in_progress", "waiting", "resolved", "closed"]
PRIORITIES = ["low", "normal", "high", "urgent"]
SLA_HOURS = {"urgent": 4, "high": 8, "normal": 24, "low": 72}


class TicketCreate(BaseModel):
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    app: Optional[str] = "EduConnect Pro"
    subject: str = Field(min_length=3, max_length=160)
    category: Optional[str] = "General"
    priority: str = "normal"
    message: Optional[str] = ""


class TicketPatch(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    internal: bool = False


class ResolveIn(BaseModel):
    resolution: str = Field(min_length=1, max_length=2000)


def _sla_state(t: dict) -> dict:
    due = t.get("sla_due")
    if not due or t.get("status") in ("resolved", "closed"):
        return {"state": "none", "due": due}
    try:
        ts = datetime.fromisoformat(due)
    except (TypeError, ValueError):
        return {"state": "none", "due": due}
    now = datetime.now(timezone.utc)
    if ts < now:
        return {"state": "breached", "due": due}
    mins = (ts - now).total_seconds() / 60
    return {"state": "at_risk" if mins < 120 else "on_track", "due": due}


def _public(t: dict) -> dict:
    t = {k: v for k, v in t.items() if k != "_id"}
    t["sla"] = _sla_state(t)
    return t


async def _next_ticket_no() -> str:
    n = await gdb.tickets.count_documents({})
    return f"TCK-{1001 + n}"


@router.get("/tickets")
async def list_tickets(status: Optional[str] = None, q: Optional[str] = None,
                       owner: dict = Depends(require_permission("ticket.view"))):
    query = {}
    if status and status in STATUSES:
        query["status"] = status
    tickets = []
    async for t in gdb.tickets.find(query).sort("updated_at", -1):
        pub = _public(t)
        if q:
            hay = f"{pub.get('subject','')} {pub.get('client_name','')} {pub.get('ticket_no','')}".lower()
            if q.lower() not in hay:
                continue
        pub.pop("messages", None)
        tickets.append(pub)

    counts = {s: await gdb.tickets.count_documents({"status": s}) for s in STATUSES}
    counts["all"] = await gdb.tickets.count_documents({})
    counts["critical"] = await gdb.tickets.count_documents(
        {"priority": "urgent", "status": {"$nin": ["resolved", "closed"]}})
    return {"tickets": tickets, "counts": counts}


@router.post("/tickets", status_code=201)
async def create_ticket(payload: TicketCreate, request: Request,
                        owner: dict = Depends(require_permission("ticket.reply"))):
    priority = payload.priority if payload.priority in PRIORITIES else "normal"
    now = datetime.now(timezone.utc)
    sla_due = (now + timedelta(hours=SLA_HOURS[priority])).isoformat()
    messages = []
    if payload.message:
        messages.append({
            "id": gen_id(), "author": payload.client_name or "Client", "author_role": "client",
            "body": payload.message, "internal": False, "created_at": now.isoformat(),
        })
    doc = {
        "id": gen_id(), "ticket_no": await _next_ticket_no(),
        "client_id": payload.client_id, "client_name": payload.client_name or "Unknown",
        "app": payload.app or "EduConnect Pro", "subject": payload.subject.strip(),
        "category": payload.category or "General", "priority": priority,
        "status": "open", "assigned_to": None, "sla_due": sla_due,
        "resolution": None, "messages": messages,
        "created_at": now.isoformat(), "updated_at": now.isoformat(),
    }
    await gdb.tickets.insert_one(doc)
    await record_audit(owner, "ticket.create", doc["ticket_no"], request,
                       meta={"client": doc["client_name"], "priority": priority})
    return _public(doc)


@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, owner: dict = Depends(require_permission("ticket.view"))):
    t = await gdb.tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _public(t)


@router.patch("/tickets/{ticket_id}")
async def patch_ticket(ticket_id: str, payload: TicketPatch, request: Request,
                       owner: dict = Depends(require_permission("ticket.assign"))):
    t = await gdb.tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    patch = {"updated_at": now_iso()}
    if payload.status is not None:
        if payload.status not in STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        patch["status"] = payload.status
    if payload.priority is not None:
        if payload.priority not in PRIORITIES:
            raise HTTPException(status_code=400, detail="Invalid priority")
        patch["priority"] = payload.priority
    if payload.assigned_to is not None:
        patch["assigned_to"] = payload.assigned_to or None
        if t.get("status") == "open" and payload.assigned_to:
            patch["status"] = "assigned"
    await gdb.tickets.update_one({"id": ticket_id}, {"$set": patch})
    await record_audit(owner, "ticket.update", t.get("ticket_no", ticket_id), request,
                       meta={k: v for k, v in patch.items() if k != "updated_at"})
    return _public(await gdb.tickets.find_one({"id": ticket_id}))


@router.post("/tickets/{ticket_id}/messages")
async def add_message(ticket_id: str, payload: MessageIn,
                      owner: dict = Depends(require_permission("ticket.reply"))):
    t = await gdb.tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    msg = {
        "id": gen_id(), "author": owner.get("name", "Staff"), "author_role": "staff",
        "body": payload.body, "internal": bool(payload.internal), "created_at": now_iso(),
    }
    new_status = t.get("status")
    if new_status in ("open", "waiting"):
        new_status = "in_progress"
    await gdb.tickets.update_one(
        {"id": ticket_id},
        {"$push": {"messages": msg}, "$set": {"updated_at": now_iso(), "status": new_status}},
    )
    return _public(await gdb.tickets.find_one({"id": ticket_id}))


@router.post("/tickets/{ticket_id}/resolve")
async def resolve_ticket(ticket_id: str, payload: ResolveIn, request: Request,
                         owner: dict = Depends(require_permission("ticket.resolve"))):
    t = await gdb.tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    note = {
        "id": gen_id(), "author": owner.get("name", "Staff"), "author_role": "staff",
        "body": f"Resolved: {payload.resolution}", "internal": False, "created_at": now_iso(),
    }
    await gdb.tickets.update_one(
        {"id": ticket_id},
        {"$push": {"messages": note},
         "$set": {"status": "resolved", "resolution": payload.resolution, "updated_at": now_iso()}},
    )
    await record_audit(owner, "ticket.resolve", t.get("ticket_no", ticket_id), request)
    return _public(await gdb.tickets.find_one({"id": ticket_id}))

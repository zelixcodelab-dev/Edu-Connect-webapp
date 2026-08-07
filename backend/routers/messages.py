"""In-app messages — Announcements (broadcasts) + Reminders (focused, with due
date). Powers the /messages page for all roles plus the pinned banner stack
on the dashboard.

Sender rules (enforced by ``_validate_send``):

* Super Admin
    - Announcement → recipient role 'user' OR 'office_admin' (optionally
      scoped to a single ``office`` for office_admin broadcasts).
    - Reminder → any specific list of user_ids (typically office_admins or
      users for a personal check-in).
* Office Admin
    - Announcement → all OTHER office_admins at the SAME office (peers).
    - Reminder → super_admin user_ids only.
* User
    - Reminder → super_admin user_ids only.

Every send creates a notification (bell + push) for each recipient and tags
the link as ``/messages/<id>`` so a tap opens the thread directly. Replies
fan-out to the original sender + every recipient in the thread (minus the
replier).
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from auth_lib import get_current_user, gen_id, now_iso
from routers.notifications import _bulk_persist_and_push


router = APIRouter(prefix="/api/messages", tags=["messages"])


# ---------- Pydantic ----------
MessageKind = Literal["announcement", "reminder"]
Priority = Literal["low", "normal", "urgent"]


class AudienceIn(BaseModel):
    """How to resolve recipients on the server side.

    ``type='role'`` + ``role`` → broadcast to every approved user of that role.
    ``type='role_office'`` + ``role='office_admin'`` + ``office`` → office peers.
    ``type='users'`` + ``user_ids`` → focused (used by reminders).
    """
    type: Literal["role", "role_office", "users"]
    role: Optional[Literal["super_admin", "office_admin", "user"]] = None
    office: Optional[Literal["KM_BLR", "KM_TCR", "KM_KMLY"]] = None
    user_ids: Optional[list[str]] = None


class MessageIn(BaseModel):
    kind: MessageKind
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    priority: Priority = "normal"
    due_date: Optional[str] = None   # ISO date (YYYY-MM-DD) — optional
    audience: AudienceIn
    # Subset of recipient_ids that the sender explicitly @-mentioned. Those
    # users get a stronger `mention` notification instead of the default one.
    mentions: Optional[list[str]] = None


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    # Subset of thread participants to highlight on this reply.
    mentions: Optional[list[str]] = None


# ---------- Sender / audience validation ----------
async def _resolve_recipients(actor: dict, audience: AudienceIn) -> list[dict]:
    """Resolve an audience selector into approved user docs. Excludes the
    actor themselves so a sender never sees their own message in their inbox."""
    if audience.type == "users":
        ids = [uid for uid in (audience.user_ids or []) if uid]
        if not ids:
            raise HTTPException(400, "user_ids required for type='users'")
        docs = await db.users.find(
            {"id": {"$in": ids}, "approval_status": "approved"},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "office": 1},
        ).to_list(len(ids))
    elif audience.type == "role":
        if not audience.role:
            raise HTTPException(400, "role required for type='role'")
        docs = await db.users.find(
            {"role": audience.role, "approval_status": "approved"},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "office": 1},
        ).to_list(500)
    elif audience.type == "role_office":
        if audience.role != "office_admin" or not audience.office:
            raise HTTPException(400, "role='office_admin' and office required for role_office")
        docs = await db.users.find(
            {"role": "office_admin", "office": audience.office, "approval_status": "approved"},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "office": 1},
        ).to_list(50)
    else:
        raise HTTPException(400, "unknown audience type")
    return [d for d in docs if d["id"] != actor["id"]]


def _validate_send(actor: dict, payload: MessageIn) -> None:
    role = actor.get("role")
    if payload.kind == "announcement":
        if role == "super_admin":
            if payload.audience.type not in {"role", "role_office"}:
                raise HTTPException(403, "Super admin announcements must target a role")
            if payload.audience.role not in {"user", "office_admin"}:
                raise HTTPException(403, "Super admin can announce only to user or office_admin")
        elif role == "office_admin":
            # Office admin announces to peer office_admins of their own office only.
            if payload.audience.type != "role_office":
                raise HTTPException(403, "Office-admin announcements must target office peers")
            if payload.audience.role != "office_admin":
                raise HTTPException(403, "Office admin can announce only to office_admin peers")
            if payload.audience.office != actor.get("office"):
                raise HTTPException(403, "Office admin can only announce to their own office")
        else:
            raise HTTPException(403, "Your role cannot create announcements")
    else:  # reminder
        if payload.audience.type != "users":
            raise HTTPException(403, "Reminders must target specific users")
        if role in {"office_admin", "user", "staff"}:
            # downward → upward only. Recipient-role check is enforced after
            # we resolve them (super_admin for office_admin/user; office_admin
            # or super_admin for staff).
            return
        if role == "super_admin":
            # Super admins can send reminders to anyone they want.
            return
        raise HTTPException(403, "Your role cannot send reminders")


async def _enforce_recipient_role(actor: dict, recipients: list[dict]) -> None:
    """For office_admin / user / staff senders sending reminders, restrict who
    they may target. (Super admin can target anyone.)"""
    role = actor.get("role")
    if role == "staff":
        bad = [r for r in recipients if r.get("role") not in ("office_admin", "super_admin")]
        if bad:
            raise HTTPException(403, "Staff can only send reminders to office admins or super admins")
        return
    if role in {"office_admin", "user"}:
        bad = [r for r in recipients if r.get("role") != "super_admin"]
        if bad:
            raise HTTPException(403, "You can only send reminders to super admins")


# ---------- CRUD ----------
def _filter_mentions(mentions: Optional[list[str]], allowed: set[str]) -> list[str]:
    """Drop any @-mention id that isn't in the recipient/participant set so
    a sender can't notify users they don't have access to."""
    if not mentions:
        return []
    return [m for m in dict.fromkeys(mentions) if m in allowed]


async def _fanout_with_mentions(
    *,
    sender: dict,
    standard_recipient_ids: list[str],
    mention_ids: list[str],
    standard_type: str,
    standard_title: str,
    mention_title: str,
    message: str,
    link: str,
    metadata: dict,
) -> None:
    """Split fan-out into two batches: mentioned users get a `mention`
    notification with a stronger title; everyone else gets the standard one.
    A user is never double-notified."""
    mention_set = set(mention_ids)
    standard_only = [uid for uid in standard_recipient_ids if uid not in mention_set]
    if standard_only:
        await _bulk_persist_and_push(
            recipient_ids=standard_only,
            type=standard_type,
            title=standard_title,
            message=message,
            link=link,
            metadata=metadata,
            actor_user_id=sender["id"],
        )
    if mention_ids:
        await _bulk_persist_and_push(
            recipient_ids=mention_ids,
            type="mention",
            title=mention_title,
            message=message,
            link=link,
            metadata={**metadata, "mentioned": True},
            actor_user_id=sender["id"],
        )


@router.post("")
async def create_message(payload: MessageIn, user: dict = Depends(get_current_user)) -> dict:
    _validate_send(user, payload)
    recipients = await _resolve_recipients(user, payload.audience)
    if payload.kind == "reminder":
        await _enforce_recipient_role(user, recipients)
    if not recipients:
        raise HTTPException(400, "No matching recipients")

    recipient_ids = [r["id"] for r in recipients]
    mentions = _filter_mentions(payload.mentions, set(recipient_ids))

    now = now_iso()
    doc = {
        "id": gen_id(),
        "thread_id": None,           # set to id below; thread root is the message itself
        "parent_id": None,
        "kind": payload.kind,
        "priority": payload.priority,
        "subject": payload.subject.strip(),
        "body": payload.body.strip(),
        "due_date": payload.due_date,
        "sender_id": user["id"],
        "sender_name": user.get("name") or user.get("email"),
        "sender_role": user.get("role"),
        "sender_office": user.get("office"),
        "audience": payload.audience.model_dump(),
        "recipient_ids": recipient_ids,
        "recipient_summary": [
            {"id": r["id"], "name": r.get("name") or r.get("email"), "role": r.get("role")}
            for r in recipients
        ],
        "mentions": mentions,
        # Per-user state map
        "acks": {r["id"]: {"read_at": None, "dismissed_at": None} for r in recipients},
        "reply_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    doc["thread_id"] = doc["id"]
    await db.messages.insert_one(doc)
    doc.pop("_id", None)

    title_prefix = "📣" if payload.kind == "announcement" else "⏰"
    badge = "URGENT · " if payload.priority == "urgent" else ""
    actor_label = user.get("name", "Someone")
    await _fanout_with_mentions(
        sender=user,
        standard_recipient_ids=recipient_ids,
        mention_ids=mentions,
        standard_type="message",
        standard_title=f"{title_prefix} {badge}{payload.kind.title()}: {doc['subject'][:80]}",
        mention_title=f"🔔 {actor_label} mentioned you · {doc['subject'][:80]}",
        message=f"{actor_label}: {doc['body'][:140]}",
        link=f"/messages/{doc['id']}",
        metadata={"message_id": doc["id"], "kind": payload.kind, "priority": payload.priority},
    )
    return doc


@router.get("")
async def list_messages(
    folder: Literal["inbox", "sent"] = "inbox",
    kind: Optional[MessageKind] = None,
    user: dict = Depends(get_current_user),
) -> list[dict]:
    q: dict = {}
    if folder == "sent":
        q["sender_id"] = user["id"]
    else:
        q["recipient_ids"] = user["id"]
    if kind:
        q["kind"] = kind
    # Only thread roots in the list view
    q["parent_id"] = None
    docs = await db.messages.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Decorate with per-user read state
    for d in docs:
        ack = (d.get("acks") or {}).get(user["id"]) or {}
        d["my_read"] = bool(ack.get("read_at"))
        d["my_dismissed"] = bool(ack.get("dismissed_at"))
    return docs


@router.get("/unread-count")
async def unread_count(user: dict = Depends(get_current_user)) -> dict:
    docs = await db.messages.find(
        {"recipient_ids": user["id"], "parent_id": None},
        {"_id": 0, "acks": 1, "id": 1},
    ).to_list(500)
    count = 0
    for d in docs:
        ack = (d.get("acks") or {}).get(user["id"]) or {}
        if not ack.get("read_at"):
            count += 1
    return {"count": count}


@router.get("/banners")
async def banners(user: dict = Depends(get_current_user)) -> list[dict]:
    """Active (un-dismissed) announcements addressed to me. Sort order:
    mentioned-me first → urgent next → newest. Capped at 5 so we never bury
    the dashboard. Mentioning-me bubbles to the top so the
    'You were mentioned' announcement is always visible even when other
    urgent banners stack up."""
    docs = await db.messages.find(
        {"recipient_ids": user["id"], "parent_id": None, "kind": "announcement"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    out: list[dict] = []
    me_id = user["id"]
    for d in docs:
        ack = (d.get("acks") or {}).get(me_id) or {}
        if ack.get("dismissed_at"):
            continue
        d["my_read"] = bool(ack.get("read_at"))
        d["mentioned_me"] = me_id in (d.get("mentions") or [])
        out.append(d)
    out.sort(key=lambda r: (
        0 if r.get("mentioned_me") else 1,
        0 if r.get("priority") == "urgent" else 1,
        # Newer first — sort by created_at descending via negative tuple
        -1 * int(str(r.get("created_at") or "").replace("-", "").replace(":", "").replace("T", "").replace("Z", "").split(".")[0] or "0"),
    ))
    return out[:5]


@router.get("/{message_id}")
async def get_thread(message_id: str, user: dict = Depends(get_current_user)) -> dict:
    root = await db.messages.find_one({"id": message_id, "parent_id": None}, {"_id": 0})
    if not root:
        raise HTTPException(404, "Message not found")
    # Authorization: must be sender OR a recipient
    if root["sender_id"] != user["id"] and user["id"] not in (root.get("recipient_ids") or []):
        raise HTTPException(403, "Not in this thread")
    replies = await db.messages.find(
        {"thread_id": message_id, "parent_id": {"$ne": None}}, {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    ack = (root.get("acks") or {}).get(user["id"]) or {}
    root["my_read"] = bool(ack.get("read_at"))
    root["my_dismissed"] = bool(ack.get("dismissed_at"))
    return {"root": root, "replies": replies}


@router.post("/{message_id}/read")
async def mark_read(message_id: str, user: dict = Depends(get_current_user)) -> dict:
    root = await db.messages.find_one({"id": message_id, "parent_id": None}, {"_id": 0})
    if not root:
        raise HTTPException(404, "Message not found")
    if user["id"] not in (root.get("recipient_ids") or []):
        raise HTTPException(403, "Not a recipient")
    await db.messages.update_one(
        {"id": message_id},
        {"$set": {f"acks.{user['id']}.read_at": now_iso()}},
    )
    return {"ok": True}


@router.post("/{message_id}/dismiss")
async def dismiss_banner(message_id: str, user: dict = Depends(get_current_user)) -> dict:
    root = await db.messages.find_one({"id": message_id, "parent_id": None}, {"_id": 0})
    if not root:
        raise HTTPException(404, "Message not found")
    if root.get("kind") != "announcement":
        raise HTTPException(400, "Only announcements can be dismissed")
    if user["id"] not in (root.get("recipient_ids") or []):
        raise HTTPException(403, "Not a recipient")
    now = now_iso()
    await db.messages.update_one(
        {"id": message_id},
        {"$set": {
            f"acks.{user['id']}.dismissed_at": now,
            f"acks.{user['id']}.read_at": now,  # dismiss implies read
        }},
    )
    return {"ok": True}


@router.post("/{message_id}/replies")
async def add_reply(
    message_id: str, payload: ReplyIn, user: dict = Depends(get_current_user),
) -> dict:
    root = await db.messages.find_one({"id": message_id, "parent_id": None}, {"_id": 0})
    if not root:
        raise HTTPException(404, "Message not found")
    if root["sender_id"] != user["id"] and user["id"] not in (root.get("recipient_ids") or []):
        raise HTTPException(403, "Not in this thread")

    # Thread participants = original sender + all recipients (minus replier)
    participants = set(root.get("recipient_ids") or [])
    participants.add(root["sender_id"])
    participants.discard(user["id"])
    mentions = _filter_mentions(payload.mentions, participants)

    now = now_iso()
    reply = {
        "id": gen_id(),
        "thread_id": message_id,
        "parent_id": message_id,
        "kind": root["kind"],
        "priority": root["priority"],
        "subject": root["subject"],
        "body": payload.body.strip(),
        "sender_id": user["id"],
        "sender_name": user.get("name") or user.get("email"),
        "sender_role": user.get("role"),
        "mentions": mentions,
        "created_at": now,
    }
    await db.messages.insert_one(reply)
    reply.pop("_id", None)

    # Bump reply_count + last activity on the root.
    await db.messages.update_one(
        {"id": message_id},
        {"$inc": {"reply_count": 1}, "$set": {"updated_at": now}},
    )

    if participants:
        actor_label = user.get("name", "Someone")
        await _fanout_with_mentions(
            sender=user,
            standard_recipient_ids=list(participants),
            mention_ids=mentions,
            standard_type="message_reply",
            standard_title=f"💬 Reply · {root['subject'][:80]}",
            mention_title=f"🔔 {actor_label} mentioned you in a reply · {root['subject'][:80]}",
            message=f"{actor_label}: {payload.body[:140]}",
            link=f"/messages/{message_id}",
            metadata={"message_id": message_id, "reply_id": reply["id"]},
        )
    return reply


@router.delete("/{message_id}")
async def delete_message(message_id: str, user: dict = Depends(get_current_user)) -> dict:
    """Sender can delete their own thread (this removes the root + all replies)."""
    root = await db.messages.find_one({"id": message_id, "parent_id": None}, {"_id": 0})
    if not root:
        raise HTTPException(404, "Message not found")
    if root["sender_id"] != user["id"]:
        raise HTTPException(403, "Only the sender can delete")
    await db.messages.delete_many({"thread_id": message_id})
    return {"ok": True}

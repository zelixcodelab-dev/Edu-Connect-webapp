"""In-app notifications + Web Push fan-out.

Events that currently fire notifications (in-app bell + push):
  - new expense_request submitted              → super_admins + office_admins of that office
  - expense_request approved / rejected        → the requester + super_admins (except actor)
  - new transaction logged                     → super_admins
  - new student enrolled                       → super_admins
  - new student application submitted (/apply) → super_admins
  - new user registration awaiting approval    → super_admins
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException

from db import db
from auth_lib import get_current_user, gen_id, now_iso
from lib.push import send_push_to_users
from lib.user_photo import resolve_photos_for_users

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


async def _bulk_persist_and_push(
    *,
    recipient_ids: list[str],
    type: str,
    title: str,
    message: str,
    link: str,
    metadata: dict | None,
    actor_user_id: str | None,
) -> None:
    """Write rows into ``notifications`` for each recipient and fan-out via Web Push."""
    targets = [rid for rid in set(recipient_ids) if rid and rid != actor_user_id]
    if not targets:
        return
    now = now_iso()
    docs = [
        {
            "id": gen_id(),
            "recipient_user_id": rid,
            "type": type,
            "title": title,
            "message": message,
            "link": link,
            "metadata": metadata or {},
            "actor_user_id": actor_user_id,
            "read": False,
            "created_at": now,
        }
        for rid in targets
    ]
    await db.notifications.insert_many(docs)
    # Best-effort Web Push (no-op if VAPID keys aren't configured)
    try:
        await send_push_to_users(
            targets, title=title, body=message, url=link or "/", tag=type,
        )
    except Exception:  # pragma: no cover — best-effort
        pass


# --- helper used by other routers --------------------------------------
async def notify_super_admins(
    *,
    type: str,
    title: str,
    message: str,
    link: str = "",
    metadata: dict | None = None,
    actor_user_id: str | None = None,
) -> None:
    """Fan-out a notification to every super_admin (except the actor themselves)."""
    admins = await db.users.find(
        {"role": "super_admin", "approval_status": "approved"},
        {"_id": 0, "id": 1},
    ).to_list(50)
    await _bulk_persist_and_push(
        recipient_ids=[a["id"] for a in admins],
        type=type, title=title, message=message, link=link,
        metadata=metadata, actor_user_id=actor_user_id,
    )


async def notify_users(
    user_ids: list[str],
    *,
    type: str,
    title: str,
    message: str,
    link: str = "",
    metadata: dict | None = None,
    actor_user_id: str | None = None,
) -> None:
    """Fan-out a notification to specific users (used for approve/reject flows)."""
    await _bulk_persist_and_push(
        recipient_ids=user_ids,
        type=type, title=title, message=message, link=link,
        metadata=metadata, actor_user_id=actor_user_id,
    )


# --- endpoints ----------------------------------------------------------
@router.get("")
async def list_notifications(
    user: dict = Depends(get_current_user),
    limit: int = 50,
    unread_only: bool = False,
):
    q: dict = {"recipient_user_id": user["id"]}
    if unread_only:
        q["read"] = False
    rows = await (
        db.notifications.find(q, {"_id": 0})
        .sort("created_at", -1)
        .limit(max(1, min(limit, 200)))
        .to_list(200)
    )
    # Enrich with the actor's profile photo so the bell UI can show a real
    # avatar next to each item (falls back to initials when no photo).
    actor_ids = [r.get("actor_user_id") for r in rows if r.get("actor_user_id")]
    photos = await resolve_photos_for_users(actor_ids) if actor_ids else {}
    for r in rows:
        r["actor_photo_url"] = photos.get(r.get("actor_user_id")) or ""
    return rows


@router.get("/unread-count")
async def unread_count(user: dict = Depends(get_current_user)):
    n = await db.notifications.count_documents(
        {"recipient_user_id": user["id"], "read": False}
    )
    return {"count": n}


@router.post("/{notif_id}/read")
async def mark_read(notif_id: str, user: dict = Depends(get_current_user)):
    res = await db.notifications.update_one(
        {"id": notif_id, "recipient_user_id": user["id"]},
        {"$set": {"read": True, "read_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Notification not found")
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(user: dict = Depends(get_current_user)):
    res = await db.notifications.update_many(
        {"recipient_user_id": user["id"], "read": False},
        {"$set": {"read": True, "read_at": now_iso()}},
    )
    return {"ok": True, "updated": res.modified_count}


@router.delete("/{notif_id}")
async def delete_notification(notif_id: str, user: dict = Depends(get_current_user)):
    res = await db.notifications.delete_one(
        {"id": notif_id, "recipient_user_id": user["id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(404, "Notification not found")
    return {"ok": True}

"""Web Push subscription endpoints.

Frontend flow:
    1. GET  /api/push/vapid-public-key  → returns the public key string
    2. POST /api/push/subscribe         → body = PushSubscription JSON, persists
    3. DELETE /api/push/unsubscribe?endpoint=... → removes a single device
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth_lib import get_current_user, gen_id, now_iso
from db import db
from lib.push import get_vapid_public_key

router = APIRouter(prefix="/api/push", tags=["push"])


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: PushKeys
    user_agent: str | None = Field(default=None, max_length=300)


@router.get("/vapid-public-key")
def vapid_public_key():
    key = get_vapid_public_key()
    if not key:
        raise HTTPException(503, "Push notifications are not configured on this server")
    return {"public_key": key}


@router.post("/subscribe")
async def subscribe(payload: PushSubscriptionIn, user: dict = Depends(get_current_user)):
    # Upsert by endpoint — re-subscribing from the same device just updates keys.
    await db.push_subscriptions.update_one(
        {"endpoint": payload.endpoint},
        {
            "$set": {
                "user_id": user["id"],
                "endpoint": payload.endpoint,
                "p256dh": payload.keys.p256dh,
                "auth": payload.keys.auth,
                "user_agent": payload.user_agent or "",
                "updated_at": now_iso(),
            },
            "$setOnInsert": {"id": gen_id(), "created_at": now_iso()},
        },
        upsert=True,
    )
    return {"ok": True}


@router.delete("/unsubscribe")
async def unsubscribe(endpoint: str, user: dict = Depends(get_current_user)):
    res = await db.push_subscriptions.delete_one(
        {"endpoint": endpoint, "user_id": user["id"]}
    )
    return {"ok": True, "deleted": res.deleted_count}


@router.get("/status")
async def status(user: dict = Depends(get_current_user)):
    """Returns number of devices subscribed for the current user."""
    n = await db.push_subscriptions.count_documents({"user_id": user["id"]})
    return {"subscribed_devices": n, "configured": bool(get_vapid_public_key())}

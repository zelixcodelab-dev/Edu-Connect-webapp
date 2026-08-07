"""Web Push fan-out helper.

Uses pywebpush + VAPID. Stores subscriptions in the ``push_subscriptions``
collection keyed by ``endpoint`` (unique). Stale subscriptions (HTTP 410/404
from the push service) are pruned automatically.

Env vars (read at call-time):
    VAPID_PUBLIC_KEY        – base64url-uncompressed P-256 public key
    VAPID_PRIVATE_KEY       – base64url raw 32-byte private scalar
    VAPID_CONTACT_EMAIL     – e.g. mailto:you@example.com
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Iterable

from pywebpush import WebPushException, webpush

from db import db

log = logging.getLogger("finflow.push")


def get_vapid_public_key() -> str | None:
    return os.environ.get("VAPID_PUBLIC_KEY")


def _vapid_claims() -> dict:
    return {"sub": os.environ.get("VAPID_CONTACT_EMAIL") or "mailto:admin@kmfoundation.online"}


def _send_one(subscription: dict, payload: dict) -> tuple[bool, int | None]:
    """Synchronous single-push helper run inside a thread."""
    private_key = os.environ.get("VAPID_PRIVATE_KEY")
    if not private_key:
        log.info("[push] VAPID_PRIVATE_KEY not set — skipping send")
        return False, None
    try:
        webpush(
            subscription_info={
                "endpoint": subscription["endpoint"],
                "keys": {
                    "p256dh": subscription["p256dh"],
                    "auth": subscription["auth"],
                },
            },
            data=json.dumps(payload),
            vapid_private_key=private_key,
            vapid_claims=_vapid_claims(),
            ttl=86400,
        )
        return True, 201
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        log.warning("[push] send failed (status=%s): %s", status, exc)
        return False, status
    except Exception as exc:
        log.exception("[push] unexpected push error: %s", exc)
        return False, None


async def send_push_to_users(
    user_ids: Iterable[str],
    *,
    title: str,
    body: str,
    url: str = "/",
    tag: str | None = None,
) -> dict:
    """Push the same payload to every subscription belonging to the given users.

    Best-effort: returns ``{sent, failed, pruned}``. Never raises.
    Stale endpoints (404/410) are removed from the DB automatically.
    """
    user_ids = [u for u in set(user_ids) if u]
    if not user_ids or not get_vapid_public_key():
        return {"sent": 0, "failed": 0, "pruned": 0, "skipped": True}

    subs = await db.push_subscriptions.find(
        {"user_id": {"$in": user_ids}}, {"_id": 0}
    ).to_list(500)
    if not subs:
        return {"sent": 0, "failed": 0, "pruned": 0}

    payload = {
        "title": title,
        "body": body,
        "url": url,
        "tag": tag or "finflow",
        "icon": "/pwa-icon-192.png",
        "badge": "/finflow-icon.png",
    }

    results = await asyncio.gather(
        *(asyncio.to_thread(_send_one, s, payload) for s in subs)
    )
    sent = sum(1 for ok, _ in results if ok)
    stale_endpoints = [
        subs[i]["endpoint"]
        for i, (ok, status) in enumerate(results)
        if not ok and status in (404, 410)
    ]
    if stale_endpoints:
        await db.push_subscriptions.delete_many({"endpoint": {"$in": stale_endpoints}})
    return {
        "sent": sent,
        "failed": len(results) - sent,
        "pruned": len(stale_endpoints),
    }


async def super_admin_user_ids() -> list[str]:
    docs = await db.users.find(
        {"role": "super_admin", "approval_status": "approved"}, {"_id": 0, "id": 1}
    ).to_list(50)
    return [d["id"] for d in docs]


async def office_admin_user_ids_for_office(office: str | None) -> list[str]:
    """Office admins of the given office. Empty list if office is None."""
    if not office:
        return []
    docs = await db.users.find(
        {
            "role": "office_admin",
            "approval_status": "approved",
            "office": office,
        },
        {"_id": 0, "id": 1},
    ).to_list(50)
    return [d["id"] for d in docs]

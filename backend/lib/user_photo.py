"""User-photo resolution helper.

Profile pictures are stored on the ``clients`` collection (`clients.photo_url`)
and reached from a ``users`` row via one of three paths, in priority order:

  1. ``users.linked_client_id``            (role='user' accounts)
  2. ``clients.login_user_id == user.id``  (staff self-profile)
  3. ``clients.user_id == user.id`` where ``client_type='staff'``
     (legacy super/office-admin-owned staff records)

The single-user lookup lives in ``routers/auth.py::_resolve_user_photo_url``
so ``/auth/me`` stays fast. THIS module adds a **batched** variant for list
endpoints (leads listing, notifications feed, campaign details, …) so we do
at most one query per candidate lookup table regardless of list size.
"""
from __future__ import annotations

from typing import Dict, Iterable

from db import db


async def resolve_photos_for_users(user_ids: Iterable[str]) -> Dict[str, str]:
    """Return ``{user_id: photo_url}`` for every user_id that has a photo on
    file. Missing / empty photos are omitted (callers can default to ``""``).

    Guarantees exactly 3 Mongo queries regardless of ``len(user_ids)`` so
    it's safe for pages that render hundreds of assignees / notifications.
    """
    ids = list({uid for uid in user_ids if uid})
    if not ids:
        return {}

    photos: Dict[str, str] = {}

    # 1) Bulk fetch the ``users`` rows we care about — we need to know each
    #    row's ``linked_client_id`` so we can join into the clients table.
    users_cursor = db.users.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "linked_client_id": 1},
    )
    users = await users_cursor.to_list(len(ids))
    linked_ids = {u.get("linked_client_id") for u in users if u.get("linked_client_id")}
    user_to_linked = {u["id"]: u.get("linked_client_id") for u in users}

    # 2) Linked-client photo lookup (priority 1)
    if linked_ids:
        docs = await db.clients.find(
            {"id": {"$in": list(linked_ids)}, "photo_url": {"$ne": ""}},
            {"_id": 0, "id": 1, "photo_url": 1},
        ).to_list(len(linked_ids))
        linked_photo = {d["id"]: d["photo_url"] for d in docs if d.get("photo_url")}
        for uid, lid in user_to_linked.items():
            if lid and linked_photo.get(lid):
                photos[uid] = linked_photo[lid]

    # 3) Staff / self-profile lookup for the remainder (priorities 2 + 3)
    remaining = [uid for uid in ids if uid not in photos]
    if remaining:
        docs = await db.clients.find(
            {"$or": [
                {"login_user_id": {"$in": remaining}},
                {"user_id": {"$in": remaining}, "client_type": "staff"},
            ],
             "photo_url": {"$ne": ""}},
            {"_id": 0, "user_id": 1, "login_user_id": 1, "photo_url": 1},
        ).to_list(len(remaining) * 2)
        for d in docs:
            if not d.get("photo_url"):
                continue
            # login_user_id wins over user_id (staff self-profile before
            # legacy staff-owned rows). Never overwrite an existing entry.
            for k in ("login_user_id", "user_id"):
                v = d.get(k)
                if v and v in remaining and v not in photos:
                    photos[v] = d["photo_url"]
                    break

    return photos

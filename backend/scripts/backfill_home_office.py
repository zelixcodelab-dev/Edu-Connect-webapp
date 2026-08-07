"""One-shot migration to backfill `home_office` on existing students and clients
so that the new visibility model (added 2026-02-26) shows historical records
to the appropriate office admins.

Rules:
  - Records owned by an office_admin → home_office = that user's office.
  - Students owned by super_admin → home_office = "KM_BLR" (per user
    instruction; KM BLR is the office the user mentioned in their bug report).
  - Clients owned by super_admin → smart map based on client_type:
        km_blr_office  → KM_BLR
        km_tcr_office  → KM_TCR
        km_kmly_office → KM_KMLY
        sub_agent_associate / associate_consultant → ALL (shared)
        staff → KM_BLR (rare — only if super_admin onboarded a staff directly)

This script is idempotent — it only sets home_office where currently missing
or empty.
"""
from __future__ import annotations

import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, ".env"))


CLIENT_TYPE_OFFICE_MAP = {
    "km_blr_office": "KM_BLR",
    "km_tcr_office": "KM_TCR",
    "km_kmly_office": "KM_KMLY",
    "sub_agent_associate": "ALL",
    "associate_consultant": "ALL",
    "staff": "KM_BLR",  # fallback for super-admin-onboarded staff
}


async def backfill() -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    users = await db.users.find(
        {}, {"_id": 0, "id": 1, "role": 1, "office": 1}
    ).to_list(500)
    role_map = {u["id"]: u for u in users}

    # ----- Students -----
    s_office = s_super = s_skipped = 0
    async for st in db.students.find({}):
        if st.get("home_office"):
            s_skipped += 1
            continue
        owner = role_map.get(st.get("user_id"))
        new_office = None
        if owner and owner.get("role") == "office_admin":
            new_office = owner.get("office")
            s_office += 1
        elif owner and owner.get("role") == "super_admin":
            new_office = "KM_BLR"
            s_super += 1
        else:
            # Unknown owner — leave blank
            s_skipped += 1
            continue
        if new_office:
            await db.students.update_one(
                {"id": st["id"]}, {"$set": {"home_office": new_office}}
            )
    print(
        f"students: office_owned={s_office} super_owned→KM_BLR={s_super} "
        f"skipped={s_skipped}"
    )

    # ----- Clients -----
    c_office = c_super = c_skipped = 0
    async for cl in db.clients.find({}):
        if cl.get("home_office"):
            c_skipped += 1
            continue
        owner = role_map.get(cl.get("user_id"))
        new_office = None
        if owner and owner.get("role") == "office_admin":
            new_office = owner.get("office")
            c_office += 1
        elif owner and owner.get("role") == "super_admin":
            new_office = CLIENT_TYPE_OFFICE_MAP.get(cl.get("client_type") or "")
            if new_office:
                c_super += 1
            else:
                c_skipped += 1
                continue
        else:
            c_skipped += 1
            continue
        if new_office:
            await db.clients.update_one(
                {"id": cl["id"]}, {"$set": {"home_office": new_office}}
            )
    print(
        f"clients:  office_owned={c_office} super_owned={c_super} "
        f"skipped={c_skipped}"
    )


if __name__ == "__main__":
    asyncio.run(backfill())

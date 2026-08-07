"""One-shot: repair leads whose ``assigned_to_user_id`` points to a
hard-deleted (i.e. no-longer-existing) user row.

Background: previous versions of ``DELETE /api/users/{id}`` were a hard
delete. When the account was recreated it received a NEW ``id``, but the
old leads still held the vanished id → they showed as "assigned to nobody
findable" in My Leads AND still counted as assigned in the campaign's
"unassigned" pool. This script:

  * Scans every non-deleted lead
  * For each ``assigned_to_user_id`` that no active user has, nulls it out
    (also clears the denormalised ``assigned_to_name``) so the lead falls
    back into the campaign's unassigned pool where the reactivated user
    can pick it back up (or a super admin can bulk-reassign).
  * Records the change on the lead's ``status_history`` so the CRM
    activity log surfaces the fix.
  * Idempotent — safe to run more than once.

Run:  cd /app/backend && python3 scripts/backfill_orphaned_lead_assignments.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import db  # noqa: E402
from auth_lib import now_iso  # noqa: E402


async def main() -> None:
    # Snapshot every *active* user id in one shot — comparisons stay O(1).
    active_ids: set[str] = set()
    async for u in db.users.find(
        {"$or": [{"deleted_at": {"$in": [None, ""]}}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0, "id": 1},
    ):
        if u.get("id"):
            active_ids.add(u["id"])
    print(f"Active users: {len(active_ids)}")

    fixed = 0
    scanned = 0
    async for lead in db.leads.find(
        {"assigned_to_user_id": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "assigned_to_user_id": 1, "assigned_to_name": 1, "status_history": 1},
    ):
        scanned += 1
        aid = lead.get("assigned_to_user_id")
        if aid in active_ids:
            continue
        # Orphaned assignment — clear it.
        prior_name = lead.get("assigned_to_name") or aid
        history = lead.get("status_history") or []
        history.append({
            "at": now_iso(),
            "actor": "system-backfill",
            "action": "unassigned",
            "note": f"Cleared orphaned assignment (was {prior_name!r})",
        })
        await db.leads.update_one(
            {"id": lead["id"]},
            {
                "$set": {
                    "assigned_to_user_id": None,
                    "assigned_to_name": None,
                    "status_history": history,
                    "updated_at": now_iso(),
                }
            },
        )
        fixed += 1
        print(f"  ↳ lead {lead['id']}: was assigned to {prior_name} — now unassigned.")

    print(
        f"\nDone. Scanned {scanned} assigned lead(s), unassigned {fixed} orphaned assignment(s)."
    )


if __name__ == "__main__":
    asyncio.run(main())

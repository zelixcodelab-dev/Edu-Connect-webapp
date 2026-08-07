"""User management — super_admin only. Approve / reject office-admin signups."""
from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from db import db
from auth_lib import get_current_user, hash_password, gen_id, now_iso
from lib.activity_log import log_user_event
from models import (
    UserApprovalUpdate, PermissionsUpdate, PERMISSION_PAGES, DEFAULT_PERMISSIONS,
    USER_DEFAULT_PERMISSIONS, STAFF_DEFAULT_PERMISSIONS,
    OfficeCode,
)

router = APIRouter(prefix="/api/users", tags=["users"])


def _require_super_admin(user: dict) -> None:
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin only")


def _is_soft_deleted(u: Optional[dict]) -> bool:
    return bool((u or {}).get("deleted_at"))


def _active_filter() -> dict:
    """Standard "not soft-deleted" clause to combine with other queries."""
    return {"deleted_at": {"$in": [None, ""]}}


@router.get("")
async def list_users(
    user: dict = Depends(get_current_user),
    status: str | None = None,
    include_deleted: bool = False,
):
    _require_super_admin(user)
    q: dict = {}
    if status:
        q["approval_status"] = status
    if not include_deleted:
        q.update(_active_filter())
    docs = await db.users.find(q, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return docs


@router.get("/super-admins")
async def list_super_admins_for_picker(user: dict = Depends(get_current_user)):
    """Lightweight picker endpoint for the Messages reminder composer.
    Returns the minimum public info (id, name, email, role) for every
    approved super_admin so any authenticated office_admin / user / super_admin
    can address a reminder upward. Sender themselves is excluded — sending a
    reminder to yourself doesn't make sense."""
    docs = await db.users.find(
        {"role": "super_admin", "approval_status": "approved"},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
    ).sort("created_at", -1).to_list(50)
    return [d for d in docs if d.get("id") != user.get("id")]


@router.get("/staff")
async def list_staff(user: dict = Depends(get_current_user)):
    """Staff login accounts, scoped. Super admin sees all; office admin sees
    only staff in their own office. Used by the Staff management page."""
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Not allowed")
    q: dict = {"role": "staff", **_active_filter()}
    if user.get("role") == "office_admin":
        q["office"] = user.get("office")
    docs = await db.users.find(
        q, {"_id": 0, "password_hash": 0},
    ).sort("created_at", -1).to_list(500)
    return docs


@router.get("/assignable")
async def list_assignable(user: dict = Depends(get_current_user)):
    """Users a lead can be assigned to: staff + office admins, scoped by office.
    Super admin gets every staff + office admin across all offices."""
    if user.get("role") not in ("super_admin", "office_admin", "staff"):
        raise HTTPException(403, "Not allowed")
    q: dict = {"role": {"$in": ["staff", "office_admin"]}, "approval_status": "approved"}
    if user.get("role") in ("office_admin", "staff") and user.get("office"):
        q["office"] = user.get("office")
    docs = await db.users.find(
        q, {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "office": 1},
    ).sort("name", 1).to_list(500)
    return docs


@router.get("/admins")
async def list_admins(user: dict = Depends(get_current_user)):
    """Every approved super_admin + office_admin — used as the "Owner" picker
    in the Create Campaign wizard. Only admins (super_admin / office_admin) can
    call this since only admins can create campaigns."""
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Not allowed")
    docs = await db.users.find(
        {"role": {"$in": ["super_admin", "office_admin"]},
         "approval_status": "approved", **_active_filter()},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "office": 1},
    ).sort("name", 1).to_list(500)
    return docs


@router.get("/me/ledger")
async def my_ledger(user: dict = Depends(get_current_user)):
    """Combined credit/debit ledger for a linked sub-agent / associate
    consultant ``user`` account. Aggregates every Service-Charge (and other)
    invoice + every transaction the office has booked against their
    ``linked_client_id``. The page surfaces this list with totals.

    Returns:
        {
          "client_id":   <str | null>,
          "client_name": <str>,
          "totals": {
            "credits": <float>,     # sum of income transactions (money received)
            "debits":  <float>,     # sum of expense transactions (money paid out)
            "invoices_total": <float>,
            "net":     <float>,     # credits - debits + invoices_total
          },
          "entries": [             # combined chronological list, newest first
            {"kind": "invoice" | "credit" | "debit",
             "id": str, "date": str, "label": str, "amount": float,
             "invoice_number": str | null, "invoice_type": str | null}
          ]
        }

    Non-linked accounts (super/office admin or unlinked user) get an empty
    payload with totals=0 so the UI can render gracefully.
    """
    linked_id = user.get("linked_client_id")
    linked_name = user.get("linked_client_name") or ""
    empty = {
        "client_id": None,
        "client_name": "",
        "totals": {"credits": 0.0, "debits": 0.0, "invoices_total": 0.0, "net": 0.0},
        "entries": [],
    }
    if not linked_id:
        return empty

    # Invoices the office issued to this client (SC + any other type).
    invoices = await db.invoices.find(
        {"client_id": linked_id},
        {
            "_id": 0, "id": 1, "invoice_number": 1, "invoice_type": 1,
            "issue_date": 1, "total": 1, "status": 1,
        },
    ).to_list(500)

    # Transactions the office booked against this client. Skip auto-mirrored
    # ones (invoice line-item expense mirror or SC-payment income mirror) so
    # the invoice itself isn't double-counted. The fields can be missing OR
    # explicitly stored as null on legacy docs — both excluded below.
    raw_txs = await db.transactions.find(
        {"client_id": linked_id},
        {
            "_id": 0, "id": 1, "type": 1, "amount": 1, "date": 1,
            "description": 1, "created_at": 1,
            "linked_invoice_id": 1, "linked_sc_payment_invoice_id": 1,
        },
    ).to_list(2000)
    txs = [
        t for t in raw_txs
        if not t.get("linked_invoice_id")
        and not t.get("linked_sc_payment_invoice_id")
    ]

    entries: list[dict] = []
    invoices_total = 0.0
    for inv in invoices:
        amount = float(inv.get("total") or 0)
        invoices_total += amount
        inv_type = inv.get("invoice_type") or "invoice"
        label = (
            f"Service Charge · #{inv.get('invoice_number') or inv.get('id')}"
            if inv_type == "service_charge"
            else f"Invoice · #{inv.get('invoice_number') or inv.get('id')}"
        )
        entries.append({
            "kind": "invoice",
            "id": inv.get("id"),
            "date": inv.get("issue_date"),
            "label": label,
            "amount": round(amount, 2),
            "invoice_number": inv.get("invoice_number"),
            "invoice_type": inv_type,
            "status": inv.get("status"),
        })

    credits = 0.0
    debits = 0.0
    for tx in txs:
        amount = float(tx.get("amount") or 0)
        is_income = tx.get("type") == "income"
        if is_income:
            credits += amount
        else:
            debits += amount
        entries.append({
            "kind": "credit" if is_income else "debit",
            "id": tx.get("id"),
            "date": tx.get("date") or tx.get("created_at"),
            "label": tx.get("description") or ("Credit" if is_income else "Debit"),
            "amount": round(amount, 2),
            "invoice_number": None,
            "invoice_type": None,
        })

    # Newest first; fall back to created_at when date is missing.
    entries.sort(key=lambda r: str(r.get("date") or ""), reverse=True)

    net = round(credits - debits + invoices_total, 2)
    return {
        "client_id": linked_id,
        "client_name": linked_name,
        "totals": {
            "credits": round(credits, 2),
            "debits": round(debits, 2),
            "invoices_total": round(invoices_total, 2),
            "net": net,
        },
        "entries": entries,
    }


class CreateUserIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)
    role: Literal["super_admin", "office_admin", "user", "staff"] = "office_admin"
    office: Optional[OfficeCode] = None  # required when role=office_admin or staff
    business_name: Optional[str] = None
    currency: Literal["USD", "INR"] = "INR"
    # Optional — only used when role="user". Links the login account to a
    # Client row (sub_agent / associate_consultant) so the user can view
    # only their own students and SC earned.
    linked_client_id: Optional[str] = None


@router.post("", status_code=201)
async def create_user(payload: CreateUserIn, user: dict = Depends(get_current_user)):
    """Create a user directly (skips self-registration flow).

    - Super admin can create any role (super_admin / office_admin / user / staff).
    - Office admin can ONLY create **staff** accounts, and only in their **own
      office** (privilege-escalation guard). They cannot create super/office
      admins or user-role accounts.
    Created users are already approved so they can sign in immediately."""
    actor_role = user.get("role")
    if actor_role == "office_admin":
        if payload.role != "staff":
            raise HTTPException(403, "Office admins can only create staff accounts")
        # Office is forced to the actor's own office regardless of the payload.
        payload.office = user.get("office")
        if not payload.office:
            raise HTTPException(400, "Your account has no office set")
    elif actor_role != "super_admin":
        raise HTTPException(403, "Not allowed to create users")

    if payload.role in ("office_admin", "staff") and not payload.office:
        raise HTTPException(400, f"Office is required for {payload.role.replace('_', ' ')}")
    email_lower = payload.email.lower()
    existing = await db.users.find_one({"email": email_lower})
    if existing and not _is_soft_deleted(existing):
        raise HTTPException(409, "A user with this email already exists")

    # Validate the linked client (only meaningful for role="user").
    linked_client_id: Optional[str] = None
    linked_client_name: Optional[str] = None
    if payload.linked_client_id and payload.role == "user":
        client = await db.clients.find_one(
            {"id": payload.linked_client_id},
            {"_id": 0, "id": 1, "name": 1, "client_type": 1},
        )
        if not client:
            raise HTTPException(400, "Linked client not found")
        if client.get("client_type") not in ("sub_agent_associate", "associate_consultant"):
            raise HTTPException(400, "Linked client must be a sub-agent or associate consultant")
        # One-to-one: a client can only back one login account at a time.
        # Ignore any soft-deleted match — the row we're about to reactivate
        # can legally re-claim its old linked client.
        already = await db.users.find_one({
            "linked_client_id": payload.linked_client_id,
            **_active_filter(),
        })
        if already and (not existing or already.get("id") != existing.get("id")):
            raise HTTPException(
                409,
                f"This client is already linked to another user account ({already.get('email')}).",
            )
        linked_client_id = client["id"]
        linked_client_name = client["name"]

    # ── Reactivation path: an existing soft-deleted row with the same email
    # gets brought back to life. Keeping the SAME `id` is critical so all
    # foreign keys (leads.assigned_to_user_id, students.referrer_user_id,
    # messages.recipient_id, …) automatically snap back into place.
    if existing and _is_soft_deleted(existing):
        patch = {
            "email": email_lower,
            "password_hash": hash_password(payload.password),
            "name": payload.name.strip(),
            "business_name": payload.business_name or "",
            "currency": payload.currency,
            "role": payload.role,
            "office": payload.office if payload.role in ("office_admin", "staff") else None,
            "approval_status": "approved",
            "reactivated_at": now_iso(),
            "reactivated_by": user["id"],
            # Clear all deletion metadata.
            "deleted_at": None,
            "deleted_by": None,
        }
        if linked_client_id:
            patch["linked_client_id"] = linked_client_id
            patch["linked_client_name"] = linked_client_name
        else:
            patch["linked_client_id"] = None
            patch["linked_client_name"] = None
        if payload.role == "office_admin":
            patch["permissions"] = dict(DEFAULT_PERMISSIONS)
        elif payload.role == "staff":
            patch["permissions"] = dict(STAFF_DEFAULT_PERMISSIONS)
        elif payload.role == "user":
            perms = dict(USER_DEFAULT_PERMISSIONS)
            if linked_client_id:
                perms["students"] = "view"
            patch["permissions"] = perms
        await db.users.update_one({"id": existing["id"]}, {"$set": patch})
        # Any lockout from before the delete would still be around — clear it.
        await db.login_attempts.delete_one({"email": email_lower})
        reactivated = await db.users.find_one({"id": existing["id"]}, {"_id": 0, "password_hash": 0})
        await log_user_event(
            actor=user,
            event_type="user.reactivated",
            target=reactivated,
            before={"deleted_at": existing.get("deleted_at"), "role": existing.get("role")},
            after={"role": reactivated.get("role"), "office": reactivated.get("office")},
            note=f"Reactivated {reactivated.get('email')} (previously deleted)",
            reversible=False,
        )
        return reactivated

    doc = {
        "id": gen_id(),
        "email": email_lower,
        "password_hash": hash_password(payload.password),
        "name": payload.name.strip(),
        "business_name": payload.business_name or "",
        "currency": payload.currency,
        "role": payload.role,
        "office": payload.office if payload.role in ("office_admin", "staff") else None,
        "approval_status": "approved",
        "created_at": now_iso(),
        "created_by_admin": user["id"],
    }
    if linked_client_id:
        doc["linked_client_id"] = linked_client_id
        doc["linked_client_name"] = linked_client_name
    if payload.role == "office_admin":
        doc["permissions"] = dict(DEFAULT_PERMISSIONS)
    elif payload.role == "staff":
        doc["permissions"] = dict(STAFF_DEFAULT_PERMISSIONS)
    elif payload.role == "user":
        # Linked clients get students set to "view" so they can browse, but
        # all SC adjustment edits are blocked at the API level regardless.
        perms = dict(USER_DEFAULT_PERMISSIONS)
        if linked_client_id:
            perms["students"] = "view"
        doc["permissions"] = perms
    await db.users.insert_one(doc)
    created = await db.users.find_one({"id": doc["id"]}, {"_id": 0, "password_hash": 0})
    await log_user_event(
        actor=user,
        event_type="user.created",
        target=created,
        after={"role": created.get("role"), "office": created.get("office")},
        note=f"Created {created.get('email')} · {created.get('role')}",
    )
    return created


@router.patch("/{user_id}/approval")
async def update_approval(user_id: str, payload: UserApprovalUpdate, user: dict = Depends(get_current_user)):
    _require_super_admin(user)
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot change your own approval status")
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    patch = {"approval_status": payload.status}
    if payload.note:
        patch["approval_note"] = payload.note
    # When approving for the first time, seed default permissions if missing
    if payload.status == "approved" and not target.get("permissions"):
        patch["permissions"] = dict(DEFAULT_PERMISSIONS)
    await db.users.update_one({"id": user_id}, {"$set": patch})
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return fresh


@router.patch("/{user_id}/permissions")
async def update_permissions(user_id: str, payload: PermissionsUpdate, user: dict = Depends(get_current_user)):
    """Super-admin only. Replaces the user's full permission map.
    Permission keys must be in PERMISSION_PAGES; values must be one of edit/view/none.
    Note: `overview` is the home redirect target, so we never allow `none` on it
    (would cause a route-guard redirect loop)."""
    _require_super_admin(user)
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == "super_admin":
        raise HTTPException(status_code=400, detail="Super admin permissions cannot be changed")
    cleaned: dict = {}
    for page in PERMISSION_PAGES:
        level = payload.permissions.get(page, "edit")
        if level not in ("edit", "view", "none"):
            raise HTTPException(status_code=400, detail=f"Invalid permission level for {page}: {level}")
        # Overview must remain at least viewable — it's the home/redirect target
        if page == "overview" and level == "none":
            level = "view"
        cleaned[page] = level
    await db.users.update_one({"id": user_id}, {"$set": {"permissions": cleaned}})
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return fresh


@router.delete("/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(get_current_user)):
    """Soft-delete a user row (sets ``deleted_at``, blocks login, hides from
    listings) — the ``id`` stays intact so ``leads.assigned_to_user_id``,
    ``students.referrer_user_id`` and other foreign-key references remain
    valid. Recreating an account with the same email later ``reactivates``
    the same row so all their previously-owned data snaps back automatically.

    Self-deletion is blocked. Super admins can remove anyone (incl. other
    super admins). Office admins can only remove **staff** accounts in their
    own office."""
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if _is_soft_deleted(target):
        raise HTTPException(status_code=400, detail="User is already deleted")
    if user.get("role") == "office_admin":
        if target.get("role") != "staff" or target.get("office") != user.get("office"):
            raise HTTPException(status_code=403, detail="You can only remove staff in your office")
    elif user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "deleted_at": now_iso(),
                "deleted_by": user["id"],
                "approval_status": "deleted",
            },
        },
    )
    # Also revoke any active session lockouts so the row is fully quiesced.
    await db.login_attempts.delete_one({"email": target.get("email")})
    await log_user_event(
        actor=user,
        event_type="user.deleted",
        target=target,
        before={
            "role": target.get("role"),
            "email": target.get("email"),
            "office": target.get("office"),
        },
        note=f"Deleted {target.get('email')} · {target.get('role')}",
        reversible=True,
    )
    return {"ok": True}


@router.post("/{user_id}/reactivate")
async def reactivate_user(user_id: str, user: dict = Depends(get_current_user)):
    """Reactivate a previously soft-deleted user without changing their
    password. Super admin only. Preserves the same ``id`` so all foreign
    keys (leads / students / referrals) snap back automatically."""
    _require_super_admin(user)
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not _is_soft_deleted(target):
        raise HTTPException(status_code=400, detail="User is already active")
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "deleted_at": None,
                "deleted_by": None,
                "reactivated_at": now_iso(),
                "reactivated_by": user["id"],
                "approval_status": "approved",
            },
        },
    )
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    await log_user_event(
        actor=user,
        event_type="user.reactivated",
        target=fresh,
        before={"deleted_at": target.get("deleted_at")},
        after={"role": fresh.get("role")},
        note=f"Reactivated {fresh.get('email')} · {fresh.get('role')}",
    )
    return {"ok": True, "user": fresh}


class ResetPasswordIn(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    payload: ResetPasswordIn,
    user: dict = Depends(get_current_user),
):
    """Set a new password for a user. Super admin → any user. Office admin →
    only staff in their own office. The target can sign in with the new
    password immediately."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1, "role": 1, "office": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("role") == "office_admin":
        if target.get("role") != "staff" or target.get("office") != user.get("office"):
            raise HTTPException(status_code=403, detail="You can only reset staff in your office")
    elif user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Not allowed")
    # Clear any active brute-force lockout so the target can sign in right away.
    await db.login_attempts.delete_one({"email": target.get("email")})
    res = await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "password_hash": hash_password(payload.new_password),
            "password_reset_at": now_iso(),
            "password_reset_by": user["id"],
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "user_id": user_id}

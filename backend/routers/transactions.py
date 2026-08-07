"""Transaction CRUD with filters."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from db import db
from auth_lib import get_current_user, gen_id, now_iso, require_edit
from models import TransactionIn
from routers.notifications import notify_super_admins, notify_users

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


@router.get("")
async def list_transactions(
    user: dict = Depends(get_current_user),
    type: Optional[str] = None,
    account_id: Optional[str] = None,
    category_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 200,
):
    q: dict = {"user_id": user["id"]}
    if type:
        q["type"] = type
    if account_id:
        q["account_id"] = account_id
    if category_id:
        q["category_id"] = category_id
    if start or end:
        q["date"] = {}
        if start:
            q["date"]["$gte"] = start
        if end:
            q["date"]["$lte"] = end
    return await db.transactions.find(q, {"_id": 0}).sort("date", -1).limit(limit).to_list(limit)


@router.post("")
async def create_transaction(payload: TransactionIn, user: dict = Depends(require_edit("transactions"))):
    doc = {"id": gen_id(), "user_id": user["id"], "created_at": now_iso(), **payload.model_dump()}
    await db.transactions.insert_one(doc)
    doc.pop("_id", None)
    # Notify super-admins when an office admin logs a transaction
    if user.get("role") == "office_admin":
        office_label = (user.get("office") or "").replace("KM_", "KM ")
        type_label = "Income" if payload.type == "income" else "Expense"
        await notify_super_admins(
            type="transaction",
            title=f"{type_label} · {user.get('name', 'Office admin')}",
            message=f"₹{payload.amount:,.0f}"
                    f" · {payload.description or 'no description'}"
                    f"{' · ' + office_label if office_label else ''}",
            link="/transactions",
            actor_user_id=user["id"],
            metadata={"transaction_id": doc["id"], "amount": payload.amount, "type": payload.type},
        )
    # Notify the linked "user" sub-agent when a super-admin posts a transaction
    # to their client (credit OR debit). Powers the My Ledger page.
    if user.get("role") == "super_admin":
        cid = doc.get("client_id")
        if cid:
            linked = await db.users.find_one(
                {"role": "user", "linked_client_id": cid, "approval_status": "approved"},
                {"_id": 0, "id": 1},
            )
            if linked:
                is_income = payload.type == "income"
                title = (
                    f"💰 Credit posted · ₹{payload.amount:,.0f}" if is_income
                    else f"📤 Debit posted · ₹{payload.amount:,.0f}"
                )
                await notify_users(
                    [linked["id"]],
                    type="linked_transaction",
                    title=title,
                    message=(payload.description or "Open ledger for details"),
                    link="/my-ledger",
                    metadata={
                        "transaction_id": doc["id"],
                        "amount": payload.amount,
                        "type": payload.type,
                    },
                    actor_user_id=user["id"],
                )
    return doc


@router.patch("/{tx_id}")
async def update_transaction(tx_id: str, payload: TransactionIn, user: dict = Depends(require_edit("transactions"))):
    res = await db.transactions.update_one(
        {"id": tx_id, "user_id": user["id"]},
        {"$set": payload.model_dump()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Transaction not found")
    return await db.transactions.find_one({"id": tx_id}, {"_id": 0})


@router.delete("/{tx_id}")
async def delete_transaction(tx_id: str, user: dict = Depends(require_edit("transactions"))):
    res = await db.transactions.delete_one({"id": tx_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Transaction not found")
    return {"ok": True}

"""Account endpoints with computed current_balance."""
from fastapi import APIRouter, Depends, HTTPException

from db import db
from auth_lib import get_current_user, gen_id, now_iso, require_edit
from models import AccountIn

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("")
async def list_accounts(user: dict = Depends(get_current_user), for_user_id: str | None = None):
    """Lists accounts for the current user. Super admins may pass ?for_user_id=X
    to view another user's accounts (used by the expense-request approval flow)."""
    target_user_id = user["id"]
    if for_user_id and for_user_id != user["id"]:
        if user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Super admin only")
        target_user_id = for_user_id
    accounts = await db.accounts.find({"user_id": target_user_id}, {"_id": 0}).to_list(500)
    for a in accounts:
        agg = await db.transactions.aggregate([
            {"$match": {"user_id": target_user_id, "account_id": a["id"]}},
            {"$group": {"_id": "$type", "total": {"$sum": "$amount"}}},
        ]).to_list(10)
        income = sum(x["total"] for x in agg if x["_id"] == "income")
        expense = sum(x["total"] for x in agg if x["_id"] == "expense")
        a["current_balance"] = round(a.get("opening_balance", 0) + income - expense, 2)
    return accounts


@router.post("")
async def create_account(payload: AccountIn, user: dict = Depends(require_edit("accounts"))):
    doc = {
        "id": gen_id(),
        "user_id": user["id"],
        "created_at": now_iso(),
        **payload.model_dump(),
    }
    await db.accounts.insert_one(doc)
    doc.pop("_id", None)
    doc["current_balance"] = doc["opening_balance"]
    return doc


@router.patch("/{account_id}")
async def update_account(account_id: str, payload: AccountIn, user: dict = Depends(require_edit("accounts"))):
    res = await db.accounts.update_one(
        {"id": account_id, "user_id": user["id"]},
        {"$set": payload.model_dump()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Account not found")
    return await db.accounts.find_one({"id": account_id}, {"_id": 0})


@router.delete("/{account_id}")
async def delete_account(account_id: str, user: dict = Depends(require_edit("accounts"))):
    res = await db.accounts.delete_one({"id": account_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Account not found")
    return {"ok": True}

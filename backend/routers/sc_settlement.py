"""Mark a student's service charge as settled (received from the college)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from auth_lib import get_current_user, gen_id, now_iso

router = APIRouter(prefix="/api/students", tags=["sc-settlement"])


class ScSettlementIn(BaseModel):
    amount: float = Field(gt=0)
    account_id: str
    date: str
    payment_mode: Optional[str] = None
    remarks: Optional[str] = None


def _super_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    return user


async def _student(student_id: str) -> dict:
    s = await db.students.find_one({"id": student_id}, {"_id": 0, "id": 1, "name": 1, "sc_settlement": 1})
    if not s:
        raise HTTPException(404, "Student not found")
    return s


@router.put("/{student_id}/sc-settlement")
async def settle_sc(student_id: str, payload: ScSettlementIn, user: dict = Depends(_super_admin)):
    s = await _student(student_id)
    acc = await db.accounts.find_one({"id": payload.account_id, "user_id": user["id"]}, {"_id": 0, "name": 1})
    if not acc:
        raise HTTPException(404, "Account not found")
    await db.transactions.delete_many({"linked_sc_settlement_student_id": student_id})
    tx_id = gen_id()
    await db.transactions.insert_one({
        "id": tx_id,
        "user_id": user["id"],
        "created_at": now_iso(),
        "type": "income",
        "amount": round(payload.amount, 2),
        "account_id": payload.account_id,
        "category_id": None,
        "date": payload.date,
        "description": " · ".join(filter(None, [f"SC received from college — {s.get('name')}", payload.remarks or ""])),
        "payment_mode": payload.payment_mode,
        "student_name": s.get("name"),
        "linked_student_id": student_id,
        "linked_sc_settlement_student_id": student_id,
    })
    settlement = {**payload.model_dump(), "amount": round(payload.amount, 2), "tx_id": tx_id,
                  "account_name": acc.get("name"), "settled_at": now_iso(), "settled_by": user["id"]}
    await db.students.update_one({"id": student_id}, {"$set": {"sc_settlement": settlement}})
    return {"ok": True, "sc_settlement": settlement}


@router.delete("/{student_id}/sc-settlement")
async def unsettle_sc(student_id: str, user: dict = Depends(_super_admin)):
    await _student(student_id)
    await db.transactions.delete_many({"linked_sc_settlement_student_id": student_id})
    await db.students.update_one({"id": student_id}, {"$unset": {"sc_settlement": ""}})
    return {"ok": True}

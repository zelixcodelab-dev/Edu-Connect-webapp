"""Category CRUD."""
from fastapi import APIRouter, Depends, HTTPException

from db import db
from auth_lib import get_current_user, gen_id, now_iso
from models import CategoryIn

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("")
async def list_categories(user: dict = Depends(get_current_user)):
    return await db.categories.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)


@router.post("")
async def create_category(payload: CategoryIn, user: dict = Depends(get_current_user)):
    doc = {"id": gen_id(), "user_id": user["id"], "created_at": now_iso(), **payload.model_dump()}
    await db.categories.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/{category_id}")
async def update_category(category_id: str, payload: CategoryIn, user: dict = Depends(get_current_user)):
    res = await db.categories.update_one(
        {"id": category_id, "user_id": user["id"]},
        {"$set": payload.model_dump()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Category not found")
    return await db.categories.find_one({"id": category_id}, {"_id": 0})


@router.delete("/{category_id}")
async def delete_category(category_id: str, user: dict = Depends(get_current_user)):
    res = await db.categories.delete_one({"id": category_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Category not found")
    return {"ok": True}

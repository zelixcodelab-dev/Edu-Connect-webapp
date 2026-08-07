"""Branding API.

* ``GET /api/branding``    — public. Returns the platform default branding
  (used to theme the login page before a user is known), or a specific
  company's branding when ``?tenant=<slug>`` is supplied.
* ``GET /api/branding/me`` — the signed-in user's company branding + modules.
* ``PATCH /api/branding``  — a company super_admin customises their OWN
  workspace branding (name, logo, colours, taglines).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from db import gdb
from auth_lib import get_current_user
from lib.whitelabel import merged_branding, tenant_public, DEFAULT_APP_NAME

router = APIRouter(prefix="/api/branding", tags=["branding"])


class BrandingPatch(BaseModel):
    app_name: Optional[str] = None
    app_short: Optional[str] = None
    company_line: Optional[str] = None
    logo_url: Optional[str] = None
    brand_color: Optional[str] = None
    hero_title: Optional[str] = None
    hero_accent: Optional[str] = None
    hero_tagline: Optional[str] = None
    eyebrow: Optional[str] = None
    currency: Optional[str] = None


@router.get("")
async def get_branding(tenant: Optional[str] = Query(default=None)):
    """Public. Default platform branding, or a company's branding by slug."""
    if tenant:
        doc = await gdb.tenants.find_one({"slug": tenant})
        if doc:
            return {"branding": merged_branding(doc.get("branding")), "app_name_default": DEFAULT_APP_NAME}
    return {"branding": merged_branding(None), "app_name_default": DEFAULT_APP_NAME}


@router.get("/me")
async def my_branding(user: dict = Depends(get_current_user)):
    if user.get("scope") == "platform":
        return {"branding": merged_branding(None), "enabled_modules": [], "scope": "platform"}
    tenant = await gdb.tenants.find_one({"id": user.get("tenant_id")})
    if not tenant:
        return {"branding": merged_branding(None), "enabled_modules": [], "scope": "tenant"}
    tp = tenant_public(tenant)
    return {
        "branding": tp["branding"],
        "enabled_modules": tp["enabled_modules"],
        "tenant_name": tenant.get("name"),
        "can_edit": user.get("role") == "super_admin",
        "scope": "tenant",
    }


@router.patch("")
async def update_my_branding(payload: BrandingPatch, user: dict = Depends(get_current_user)):
    if user.get("scope") != "tenant" or user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only your workspace super admin can change branding.")
    tenant = await gdb.tenants.find_one({"id": user.get("tenant_id")})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")

    incoming = payload.model_dump(exclude_none=True)
    raw = payload.model_dump()
    if raw.get("logo_url") is not None:  # allow clearing the logo
        incoming["logo_url"] = raw.get("logo_url")
    merged = merged_branding({**(tenant.get("branding") or {}), **incoming})
    await gdb.tenants.update_one({"id": tenant["id"]}, {"$set": {"branding": merged}})
    return {"branding": merged}

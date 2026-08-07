"""Platform Console API — the reseller's super-dashboard.

Only the platform owner may call these endpoints. They create and manage
companies (tenants): branding, theme colour, enabled modules, admin
credentials, and activation status. Each company is an isolated database.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List

from db import (
    gdb, client, tenant_database, tenant_db_name,
    set_default_tenant, get_default_tenant_id,
)
from auth_lib import get_platform_owner, hash_password, now_iso
from lib.whitelabel import (
    provision_tenant, tenant_public, merged_branding, normalize_modules,
    MODULE_CATALOG, email_in_use, BRANDING_FIELDS,
)

router = APIRouter(prefix="/api/platform", tags=["platform"])
log = logging.getLogger("platform")


class BrandingIn(BaseModel):
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


class TenantCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    admin_email: EmailStr
    admin_password: str = Field(min_length=6, max_length=128)
    admin_name: Optional[str] = "Administrator"
    branding: Optional[BrandingIn] = None
    enabled_modules: Optional[List[str]] = None


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None  # active | suspended
    branding: Optional[BrandingIn] = None
    enabled_modules: Optional[List[str]] = None


class AdminReset(BaseModel):
    admin_password: str = Field(min_length=6, max_length=128)


async def _tenant_stats(tenant_id: str) -> dict:
    tdb = tenant_database(tenant_id)
    try:
        users = await tdb.users.count_documents({"deleted_at": {"$exists": False}})
        students = await tdb.students.count_documents({})
        leads = await tdb.leads.count_documents({})
    except Exception:
        users = students = leads = 0
    return {"users": users, "students": students, "leads": leads}


@router.get("/me")
async def platform_me(owner: dict = Depends(get_platform_owner)):
    return {
        "id": owner["id"],
        "email": owner["email"],
        "name": owner.get("name", "Platform Owner"),
        "role": "platform_owner",
        "scope": "platform",
    }


@router.get("/modules")
async def list_modules(owner: dict = Depends(get_platform_owner)):
    return {"modules": MODULE_CATALOG}


@router.get("/summary")
async def platform_summary(owner: dict = Depends(get_platform_owner)):
    total = await gdb.tenants.count_documents({})
    active = await gdb.tenants.count_documents({"status": "active"})
    suspended = await gdb.tenants.count_documents({"status": "suspended"})
    total_users = 0
    async for t in gdb.tenants.find({}, {"_id": 0, "id": 1}):
        s = await _tenant_stats(t["id"])
        total_users += s["users"]
    return {
        "companies": total,
        "active": active,
        "suspended": suspended,
        "total_users": total_users,
    }


@router.get("/tenants")
async def list_tenants(owner: dict = Depends(get_platform_owner)):
    out = []
    default_id = get_default_tenant_id()
    async for t in gdb.tenants.find({}, {"_id": 0}).sort("created_at", 1):
        pub = tenant_public(t)
        pub["stats"] = await _tenant_stats(t["id"])
        pub["is_default"] = t["id"] == default_id
        out.append(pub)
    return {"tenants": out}


@router.post("/tenants", status_code=201)
async def create_tenant(payload: TenantCreate, owner: dict = Depends(get_platform_owner)):
    email = payload.admin_email.lower().strip()
    if await email_in_use(email):
        raise HTTPException(status_code=400, detail="That admin email is already in use by another account.")
    branding = payload.branding.model_dump(exclude_none=True) if payload.branding else {}
    doc = await provision_tenant(
        name=payload.name.strip(),
        admin_email=email,
        admin_password=payload.admin_password,
        admin_name=payload.admin_name or "Administrator",
        branding=branding,
        enabled_modules=payload.enabled_modules,
    )
    # If this is the very first company, make it the default fallback tenant.
    if get_default_tenant_id() is None:
        set_default_tenant(doc["id"])
    result = tenant_public(doc)
    result["stats"] = {"users": 1, "students": 0, "leads": 0}
    result["is_default"] = doc["id"] == get_default_tenant_id()
    return result


@router.get("/tenants/{tenant_id}")
async def get_tenant(tenant_id: str, owner: dict = Depends(get_platform_owner)):
    t = await gdb.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Company not found")
    pub = tenant_public(t)
    pub["stats"] = await _tenant_stats(tenant_id)
    pub["is_default"] = tenant_id == get_default_tenant_id()
    return pub


@router.patch("/tenants/{tenant_id}")
async def update_tenant(tenant_id: str, payload: TenantUpdate, owner: dict = Depends(get_platform_owner)):
    t = await gdb.tenants.find_one({"id": tenant_id})
    if not t:
        raise HTTPException(status_code=404, detail="Company not found")

    patch = {}
    if payload.name is not None:
        patch["name"] = payload.name.strip()
    if payload.status is not None:
        if payload.status not in ("active", "suspended"):
            raise HTTPException(status_code=400, detail="status must be 'active' or 'suspended'")
        patch["status"] = payload.status
    if payload.enabled_modules is not None:
        patch["enabled_modules"] = normalize_modules(payload.enabled_modules)
    if payload.branding is not None:
        incoming = payload.branding.model_dump(exclude_none=True)
        # logo_url can be intentionally cleared → include even if empty string
        raw = payload.branding.model_dump()
        if raw.get("logo_url") is not None:
            incoming["logo_url"] = raw.get("logo_url")
        merged = merged_branding({**(t.get("branding") or {}), **incoming})
        patch["branding"] = merged

    if patch:
        await gdb.tenants.update_one({"id": tenant_id}, {"$set": patch})
    fresh = await gdb.tenants.find_one({"id": tenant_id}, {"_id": 0})
    pub = tenant_public(fresh)
    pub["stats"] = await _tenant_stats(tenant_id)
    pub["is_default"] = tenant_id == get_default_tenant_id()
    return pub


@router.post("/tenants/{tenant_id}/reset-admin")
async def reset_tenant_admin(tenant_id: str, payload: AdminReset, owner: dict = Depends(get_platform_owner)):
    t = await gdb.tenants.find_one({"id": tenant_id})
    if not t:
        raise HTTPException(status_code=404, detail="Company not found")
    tdb = tenant_database(tenant_id)
    admin_email = t.get("admin_email")
    user = await tdb.users.find_one({"email": admin_email}) or await tdb.users.find_one({"role": "super_admin"})
    if not user:
        raise HTTPException(status_code=404, detail="Company admin account not found")
    await tdb.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(payload.admin_password), "password_reset_at": now_iso()}},
    )
    # Wipe any lockout so the admin can sign straight in.
    await gdb.login_attempts.delete_one({"email": user.get("email")})
    return {"ok": True, "admin_email": user.get("email")}


@router.delete("/tenants/{tenant_id}")
async def delete_tenant(tenant_id: str, owner: dict = Depends(get_platform_owner)):
    t = await gdb.tenants.find_one({"id": tenant_id})
    if not t:
        raise HTTPException(status_code=404, detail="Company not found")
    total = await gdb.tenants.count_documents({})
    if total <= 1:
        raise HTTPException(status_code=400, detail="You cannot delete the last remaining company.")
    # Drop the isolated database + registry row.
    try:
        await client.drop_database(tenant_db_name(tenant_id))
    except Exception:
        log.exception("[platform] failed to drop db for tenant %s", tenant_id)
    await gdb.tenants.delete_one({"id": tenant_id})
    if get_default_tenant_id() == tenant_id:
        nxt = await gdb.tenants.find_one({}, sort=[("created_at", 1)])
        set_default_tenant(nxt["id"] if nxt else None)
    return {"ok": True}

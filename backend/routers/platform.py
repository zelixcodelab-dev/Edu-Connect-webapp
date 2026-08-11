"""Platform Console API — the reseller's super-dashboard.

Only the platform owner may call these endpoints. They create and manage
companies (tenants): branding, theme colour, enabled modules, admin
credentials, and activation status. Each company is an isolated database.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List

from db import (
    gdb, client, tenant_database, tenant_db_name,
    set_default_tenant, get_default_tenant_id,
)
from auth_lib import get_platform_owner, hash_password, now_iso, gen_id
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
    role = owner.get("platform_role", "platform_owner")
    return {
        "id": owner["id"],
        "email": owner["email"],
        "name": owner.get("name", "Platform Owner"),
        "role": role,
        "scope": "platform",
        "permissions": permissions_for(role),
    }


# ─────────────────────────── RBAC ───────────────────────────
# Granular permissions. The Platform Owner implicitly holds every permission
# ("*"). Additional staff roles (admin/developer/support/viewer) are defined
# now so the console can enforce access as those users are added later.
PLATFORM_ROLES = ["platform_owner", "platform_admin", "developer", "support", "viewer"]

ALL_PERMISSIONS = [
    "client.view", "client.create", "client.edit", "client.delete", "client.suspend",
    "app.view", "app.create", "app.deploy", "app.manage",
    "database.view", "database.query", "database.edit", "database.backup",
    "server.view", "server.restart", "server.deploy", "server.terminal",
    "ticket.view", "ticket.reply", "ticket.assign", "ticket.resolve",
    "settings.view", "settings.manage", "audit.view",
]

ROLE_PERMISSIONS = {
    "platform_owner": ["*"],
    "platform_admin": [p for p in ALL_PERMISSIONS if not p.startswith("server.terminal")],
    "developer": ["app.view", "app.deploy", "database.view", "database.query",
                  "server.view", "server.restart", "ticket.view", "audit.view"],
    "support": ["client.view", "ticket.view", "ticket.reply", "ticket.assign", "ticket.resolve"],
    "viewer": [p for p in ALL_PERMISSIONS if p.endswith(".view")],
}


def permissions_for(role: str) -> List[str]:
    perms = ROLE_PERMISSIONS.get(role, [])
    return ALL_PERMISSIONS if "*" in perms else perms


def has_perm(user: dict, perm: str) -> bool:
    role = user.get("platform_role", "platform_owner")
    perms = ROLE_PERMISSIONS.get(role, [])
    return "*" in perms or perm in perms


def require_permission(perm: str):
    """Dependency: platform user must hold `perm`. Enforced server-side —
    the frontend also hides UI, but authorization lives here."""
    async def _checker(owner: dict = Depends(get_platform_owner)) -> dict:
        if not has_perm(owner, perm):
            raise HTTPException(status_code=403, detail=f"Missing permission: {perm}")
        return owner
    return _checker


# ─────────────────────────── Audit log ───────────────────────────
async def record_audit(owner: dict, action: str, resource: str,
                       request: Optional[Request] = None,
                       meta: Optional[dict] = None, result: str = "success") -> None:
    """Persist a sensitive-action audit entry. Best-effort — never blocks the
    action it records."""
    ip = None
    if request is not None and request.client:
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or request.client.host
    doc = {
        "id": gen_id(),
        "user_id": owner.get("id"),
        "user_name": owner.get("name", "Platform Owner"),
        "user_email": owner.get("email"),
        "role": owner.get("platform_role", "platform_owner"),
        "action": action,
        "resource": resource,
        "meta": meta or {},
        "ip": ip,
        "result": result,
        "timestamp": now_iso(),
    }
    try:
        await gdb.platform_audit.insert_one(doc)
    except Exception:
        log.exception("[platform] audit write failed")


@router.get("/audit")
async def list_audit(limit: int = 100, owner: dict = Depends(require_permission("audit.view"))):
    limit = max(1, min(limit, 500))
    out = []
    async for a in gdb.platform_audit.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit):
        out.append(a)
    return {"entries": out}


# ─────────────────────── Needs Your Attention ───────────────────────
@router.get("/attention")
async def attention(owner: dict = Depends(get_platform_owner)):
    """Actionable alerts assembled from REAL platform signals we can observe:
    suspended companies, locked-out admin logins, and empty-platform state."""
    items = []

    async for t in gdb.tenants.find({"status": "suspended"}, {"_id": 0}):
        items.append({
            "id": f"susp-{t['id']}", "severity": "warning", "icon": "pause",
            "title": f"{t.get('name', 'A company')} is suspended",
            "subtitle": "This workspace cannot sign in until reactivated.",
            "module": "clients", "link": "/platform/clients", "entity_id": t["id"],
        })

    now = now_iso()
    async for rec in gdb.login_attempts.find({"locked_until": {"$gt": now}}, {"_id": 0}):
        items.append({
            "id": f"lock-{rec.get('email')}", "severity": "critical", "icon": "shield",
            "title": f"Login locked: {rec.get('email')}",
            "subtitle": f"{rec.get('fails', 0)} failed attempts — possible security event.",
            "module": "settings", "link": "/platform/settings", "entity_id": rec.get("email"),
        })

    total = await gdb.tenants.count_documents({})
    if total == 0:
        items.append({
            "id": "no-clients", "severity": "info", "icon": "info",
            "title": "No clients yet",
            "subtitle": "Create your first client workspace to get started.",
            "module": "clients", "link": "/platform/clients", "entity_id": None,
        })

    return {"items": items, "count": len(items)}


# ─────────────────────────── Global search ───────────────────────────
@router.get("/search")
async def platform_search(q: str = "", owner: dict = Depends(get_platform_owner)):
    q = (q or "").strip().lower()
    clients = []
    if q:
        async for t in gdb.tenants.find({}, {"_id": 0}).limit(50):
            name = (t.get("name") or "").lower()
            email = (t.get("admin_email") or "").lower()
            if q in name or q in email:
                clients.append({
                    "id": t["id"], "title": t.get("name"),
                    "subtitle": t.get("admin_email"), "link": "/platform/clients",
                })
    groups = []
    if clients:
        groups.append({"type": "Clients", "items": clients[:8]})
    return {"groups": groups}


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
async def create_tenant(payload: TenantCreate, request: Request, owner: dict = Depends(require_permission("client.create"))):
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
    await record_audit(owner, "client.create", doc.get("name", "client"), request,
                       meta={"tenant_id": doc["id"], "admin_email": email})
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
async def update_tenant(tenant_id: str, payload: TenantUpdate, request: Request, owner: dict = Depends(require_permission("client.edit"))):
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
        await record_audit(owner, "client.edit", t.get("name", "client"), request,
                           meta={"tenant_id": tenant_id, "changed": list(patch.keys())})
    fresh = await gdb.tenants.find_one({"id": tenant_id}, {"_id": 0})
    pub = tenant_public(fresh)
    pub["stats"] = await _tenant_stats(tenant_id)
    pub["is_default"] = tenant_id == get_default_tenant_id()
    return pub


@router.post("/tenants/{tenant_id}/reset-admin")
async def reset_tenant_admin(tenant_id: str, payload: AdminReset, request: Request, owner: dict = Depends(require_permission("client.edit"))):
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
    await record_audit(owner, "client.reset_admin", t.get("name", "client"), request,
                       meta={"tenant_id": tenant_id, "admin_email": user.get("email")})
    return {"ok": True, "admin_email": user.get("email")}


@router.delete("/tenants/{tenant_id}")
async def delete_tenant(tenant_id: str, request: Request, owner: dict = Depends(require_permission("client.delete"))):
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
    await record_audit(owner, "client.delete", t.get("name", "client"), request,
                       meta={"tenant_id": tenant_id})
    return {"ok": True}

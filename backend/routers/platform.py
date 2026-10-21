"""Platform Console API — the reseller's super-dashboard.

Only the platform owner may call these endpoints. They create and manage
companies (tenants): branding, theme colour, enabled modules, admin
credentials, and activation status. Each company is an isolated database.
"""
import logging
from datetime import datetime, timezone

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
    MODULE_CATALOG, email_in_use,
)
from lib.tour import resolve_tour_steps, clean_tour_steps, tour_stats
from lib.subscription import trial_info

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
    plan: Optional[str] = "trial"
    branding: Optional[BrandingIn] = None
    enabled_modules: Optional[List[str]] = None


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None  # active | suspended
    plan: Optional[str] = None
    branding: Optional[BrandingIn] = None
    enabled_modules: Optional[List[str]] = None


class TourStepIn(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(default="", max_length=400)
    enabled: bool = True


class TourIn(BaseModel):
    steps: List[TourStepIn] = Field(max_length=30)


class AdminReset(BaseModel):
    admin_password: str = Field(min_length=6, max_length=128)


async def _tenant_stats(tenant_id: str) -> dict:
    tdb = tenant_database(tenant_id)
    try:
        users = await tdb.users.count_documents({"deleted_at": {"$exists": False}})
        students = await tdb.students.count_documents({})
        leads = await tdb.leads.count_documents({})
        tour = await tour_stats(tdb)
    except Exception:
        users = students = leads = 0
        tour = {"completed": 0, "skipped": 0, "not_started": 0, "total": 0}
    return {"users": users, "students": students, "leads": leads, "tour": tour}


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

    async for t in gdb.tenants.find({"subscription.status": "trial"}, {"_id": 0, "id": 1, "name": 1, "subscription": 1}):
        tr = trial_info(t.get("subscription"))
        if not tr or not (tr["expired"] or tr["near"]):
            continue
        d = tr["days_left"]
        when = "expired" if tr["expired"] else ("ends today" if d == 0 else f"ends in {d} day{'s' if d != 1 else ''}")
        items.append({
            "id": f"trial-{t['id']}", "severity": "critical" if tr["expired"] or d <= 3 else "warning", "icon": "clock",
            "title": f"{t.get('name', 'A company')}: trial {when}",
            "subtitle": f"Trial end date {tr['trial_ends_at']} · on expiry: {tr['expiry_action'].replace('_', ' ')}.",
            "module": "clients", "link": f"/platform/clients/{t['id']}", "entity_id": t["id"],
        })

    total = await gdb.tenants.count_documents({})
    if total == 0:
        items.append({
            "id": "no-clients", "severity": "info", "icon": "info",
            "title": "No clients yet",
            "subtitle": "Create your first client workspace to get started.",
            "module": "clients", "link": "/platform/clients", "entity_id": None,
        })

    async for tk in gdb.tickets.find(
        {"priority": "urgent", "status": {"$nin": ["resolved", "closed"]}}, {"_id": 0}).limit(10):
        items.append({
            "id": f"tkt-{tk['id']}", "severity": "critical", "icon": "shield",
            "title": f"Urgent ticket: {tk.get('subject', '')[:60]}",
            "subtitle": f"{tk.get('client_name', 'Client')} · {tk.get('ticket_no', '')}",
            "module": "connect", "link": f"/platform/connect/{tk['id']}", "entity_id": tk["id"],
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
    trial = await gdb.tenants.count_documents({"$or": [{"plan": "trial"}, {"plan": {"$exists": False}}]})
    total_users = 0
    async for t in gdb.tenants.find({}, {"_id": 0, "id": 1}):
        s = await _tenant_stats(t["id"])
        total_users += s["users"]
    open_tickets = await gdb.tickets.count_documents({"status": {"$nin": ["resolved", "closed"]}})
    return {
        "companies": total,
        "active": active,
        "suspended": suspended,
        "trial": trial,
        "total_users": total_users,
        "open_tickets": open_tickets,
    }


@router.get("/tenants")
async def list_tenants(owner: dict = Depends(get_platform_owner)):
    out = []
    default_id = get_default_tenant_id()
    async for t in gdb.tenants.find({}, {"_id": 0}).sort("created_at", 1):
        pub = tenant_public(t)
        pub["stats"] = await _tenant_stats(t["id"])
        pub["is_default"] = t["id"] == default_id
        pub["plan"] = t.get("plan", "trial")
        pub["created_at"] = t.get("created_at")
        pub["trial"] = trial_info(t.get("subscription"))
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
    if payload.plan:
        await gdb.tenants.update_one({"id": doc["id"]}, {"$set": {"plan": payload.plan}})
        doc["plan"] = payload.plan
    result = tenant_public(doc)
    result["stats"] = {"users": 1, "students": 0, "leads": 0}
    result["plan"] = doc.get("plan", "trial")
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
    pub["plan"] = t.get("plan", "trial")
    pub["created_at"] = t.get("created_at")
    return pub


@router.get("/tenants/{tenant_id}/users")
async def tenant_users(tenant_id: str, owner: dict = Depends(require_permission("client.view"))):
    t = await gdb.tenants.find_one({"id": tenant_id})
    if not t:
        raise HTTPException(status_code=404, detail="Company not found")
    tdb = tenant_database(tenant_id)
    users = []
    try:
        async for u in tdb.users.find({"deleted_at": {"$exists": False}}, {"_id": 0, "password_hash": 0}).limit(200):
            users.append({
                "id": u.get("id"), "name": u.get("name"), "email": u.get("email"),
                "role": u.get("role"), "office": u.get("office"),
                "created_at": u.get("created_at"),
            })
    except Exception:
        pass
    return {"users": users}


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
    if payload.plan is not None:
        patch["plan"] = payload.plan
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


async def _tenant_or_404(tenant_id: str) -> dict:
    t = await gdb.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Company not found")
    return t


@router.get("/tenants/{tenant_id}/tour")
async def get_tenant_tour(tenant_id: str, owner: dict = Depends(require_permission("client.view"))):
    t = await _tenant_or_404(tenant_id)
    tdb = tenant_database(tenant_id)
    users = []
    async for u in tdb.users.find({"deleted_at": {"$exists": False}},
                                  {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "tour_status": 1, "tour_done_at": 1}).limit(500):
        users.append({**u, "tour_status": u.get("tour_status") or "not_started"})
    return {
        "steps": resolve_tour_steps(t.get("tour_steps")),
        "customized": bool(t.get("tour_steps")),
        "stats": await tour_stats(tdb),
        "users": users,
    }


@router.put("/tenants/{tenant_id}/tour")
async def save_tenant_tour(tenant_id: str, payload: TourIn, request: Request, owner: dict = Depends(require_permission("client.edit"))):
    t = await _tenant_or_404(tenant_id)
    steps = clean_tour_steps([s.model_dump() for s in payload.steps])
    if not steps:
        raise HTTPException(status_code=400, detail="Keep at least one step with a title.")
    await gdb.tenants.update_one({"id": tenant_id}, {"$set": {"tour_steps": steps}})
    await record_audit(owner, "client.tour.edit", t.get("name", "client"), request, meta={"tenant_id": tenant_id})
    return {"steps": resolve_tour_steps(steps), "customized": True}


@router.delete("/tenants/{tenant_id}/tour")
async def reset_tenant_tour(tenant_id: str, request: Request, owner: dict = Depends(require_permission("client.edit"))):
    t = await _tenant_or_404(tenant_id)
    await gdb.tenants.update_one({"id": tenant_id}, {"$unset": {"tour_steps": ""}})
    await record_audit(owner, "client.tour.reset", t.get("name", "client"), request, meta={"tenant_id": tenant_id})
    return {"steps": resolve_tour_steps(None), "customized": False}


@router.post("/tenants/{tenant_id}/tour/reset-users")
async def reset_tour_users(tenant_id: str, request: Request, owner: dict = Depends(require_permission("client.edit"))):
    t = await _tenant_or_404(tenant_id)
    r = await tenant_database(tenant_id).users.update_many({"deleted_at": {"$exists": False}}, {"$unset": {"tour_status": "", "tour_done_at": ""}})
    await record_audit(owner, "client.tour.replay", t.get("name", "client"), request, meta={"tenant_id": tenant_id})
    return {"ok": True, "reset": r.modified_count}


# ─────────────────────── Client detail: applications / database / subscription / security ───────────────────────
@router.get("/tenants/{tenant_id}/applications")
async def tenant_applications(tenant_id: str, owner: dict = Depends(require_permission("client.view"))):
    await _tenant_or_404(tenant_id)
    apps = []
    async for a in gdb.apps.find({}, {"_id": 0, "id": 1, "name": 1, "version": 1, "environment": 1, "status": 1, "category": 1, "logo_url": 1, "assigned_client_ids": 1}).sort("created_at", 1):
        a["assigned"] = tenant_id in (a.pop("assigned_client_ids", None) or [])
        apps.append(a)
    return {"apps": apps}


class AssignIn(BaseModel):
    assigned: bool


@router.put("/tenants/{tenant_id}/applications/{app_id}")
async def set_tenant_application(tenant_id: str, app_id: str, payload: AssignIn, request: Request,
                                 owner: dict = Depends(require_permission("app.manage"))):
    t = await _tenant_or_404(tenant_id)
    a = await gdb.apps.find_one({"id": app_id}, {"_id": 0, "name": 1})
    if not a:
        raise HTTPException(status_code=404, detail="Application not found")
    op = "$addToSet" if payload.assigned else "$pull"
    await gdb.apps.update_one({"id": app_id}, {op: {"assigned_client_ids": tenant_id}})
    await record_audit(owner, "app.assign" if payload.assigned else "app.unassign", f"{a['name']} → {t.get('name')}", request,
                       meta={"tenant_id": tenant_id, "app_id": app_id})
    return {"ok": True, "assigned": payload.assigned}


@router.get("/tenants/{tenant_id}/database")
async def tenant_database_info(tenant_id: str, owner: dict = Depends(require_permission("database.view"))):
    await _tenant_or_404(tenant_id)
    name = tenant_db_name(tenant_id)
    tdb = tenant_database(tenant_id)
    out = {"name": name, "status": "unknown", "size_mb": 0, "storage_mb": 0, "index_mb": 0, "objects": 0, "collections": []}
    try:
        st = await tdb.command("dbstats")
        mb = lambda n: round((n or 0) / (1024 * 1024), 2)  # noqa: E731
        out.update(status="online", size_mb=mb(st.get("dataSize")), storage_mb=mb(st.get("storageSize")),
                   index_mb=mb(st.get("indexSize")), objects=st.get("objects", 0))
        for c in sorted(await tdb.list_collection_names()):
            out["collections"].append({"name": c, "count": await tdb[c].estimated_document_count()})
    except Exception:
        log.exception("[platform] dbstats failed for %s", name)
    bk = await gdb.db_backups.find_one({"db_name": name}, {"_id": 0}, sort=[("created_at", -1)])
    out["last_backup"] = (bk or {}).get("created_at")
    return out


class SubscriptionIn(BaseModel):
    plan_id: str
    status: str
    trial_ends_at: Optional[str] = None
    seat_limit: Optional[int] = Field(default=None, ge=0, le=100000)
    notes: Optional[str] = Field(default="", max_length=500)
    expiry_action: str = Field(default="keep", pattern=r"^(keep|read_only|block)$")


async def _subscription_view(t: dict) -> dict:
    from lib.subscription import seat_usage, trial_info
    sub = dict(t.get("subscription") or {})
    sub.setdefault("status", "trial" if (t.get("plan") or "trial") == "trial" else "active")
    sub.setdefault("plan_name", (t.get("plan") or "trial").title())
    sub["seats_used"] = await seat_usage(tenant_database(t["id"]))
    sub["trial"] = trial_info(t.get("subscription"))
    plans = [p async for p in gdb.plans.find({}, {"_id": 0}).sort("price", 1)]
    return {"subscription": sub, "plans": plans}


@router.get("/tenants/{tenant_id}/subscription")
async def get_subscription(tenant_id: str, owner: dict = Depends(require_permission("client.view"))):
    return await _subscription_view(await _tenant_or_404(tenant_id))


@router.put("/tenants/{tenant_id}/subscription")
async def put_subscription(tenant_id: str, payload: SubscriptionIn, request: Request,
                           owner: dict = Depends(require_permission("client.edit"))):
    from lib.subscription import SUB_STATUSES
    t = await _tenant_or_404(tenant_id)
    if payload.status not in SUB_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {', '.join(SUB_STATUSES)}")
    plan = await gdb.plans.find_one({"id": payload.plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=400, detail="Pick a plan from Settings → Plans")
    # 0 = explicitly unlimited; empty = plan default.
    seat_limit = None if payload.seat_limit == 0 else (payload.seat_limit or ((plan.get("limits") or {}).get("users")) or None)
    sub = {
        "plan_id": plan["id"], "plan_name": plan["name"], "price": plan.get("price", 0), "currency": plan.get("currency"),
        "status": payload.status, "trial_ends_at": payload.trial_ends_at or None,
        "seat_limit": int(seat_limit) if seat_limit else None, "notes": payload.notes or "",
        "expiry_action": payload.expiry_action,
        "updated_at": now_iso(), "updated_by": owner.get("email"),
    }
    await gdb.tenants.update_one({"id": tenant_id}, {"$set": {"subscription": sub, "plan": plan["name"].lower()}})
    from lib.subscription import forget_revoked
    forget_revoked(tenant_id)
    await record_audit(owner, "client.subscription", t.get("name", "client"), request,
                       meta={"tenant_id": tenant_id, "plan": plan["name"], "status": payload.status, "seat_limit": sub["seat_limit"]})
    return await _subscription_view(await _tenant_or_404(tenant_id))


@router.get("/tenants/{tenant_id}/security")
async def tenant_security(tenant_id: str, owner: dict = Depends(require_permission("client.view"))):
    from lib.subscription import since_iso
    t = await _tenant_or_404(tenant_id)
    events = [e async for e in gdb.login_events.find({"tenant_id": tenant_id}, {"_id": 0}).sort("at", -1).limit(50)]
    day = since_iso(24)
    failed_24h = await gdb.login_events.count_documents({"tenant_id": tenant_id, "success": False, "at": {"$gte": day}})
    success_24h = await gdb.login_events.count_documents({"tenant_id": tenant_id, "success": True, "at": {"$gte": day}})
    emails = [u["email"] async for u in tenant_database(tenant_id).users.find({}, {"_id": 0, "email": 1}) if u.get("email")]
    now = datetime.now(timezone.utc).isoformat()
    lockouts = [r async for r in gdb.login_attempts.find(
        {"email": {"$in": emails}, "$or": [{"locked_until": {"$gt": now}}, {"fails": {"$gte": 1}}]}, {"_id": 0})]
    audit = [a async for a in gdb.platform_audit.find({"meta.tenant_id": tenant_id}, {"_id": 0}).sort("timestamp", -1).limit(30)]
    revoked = t.get("sessions_revoked_at")
    return {
        "events": events, "failed_24h": failed_24h, "success_24h": success_24h,
        "lockouts": lockouts, "audit": audit,
        "sessions_revoked_at": datetime.fromtimestamp(revoked, timezone.utc).isoformat() if revoked else None,
    }


@router.post("/tenants/{tenant_id}/security/revoke-sessions")
async def revoke_sessions(tenant_id: str, request: Request, owner: dict = Depends(require_permission("client.edit"))):
    from lib.subscription import forget_revoked
    t = await _tenant_or_404(tenant_id)
    await gdb.tenants.update_one({"id": tenant_id}, {"$set": {"sessions_revoked_at": datetime.now(timezone.utc).timestamp()}})
    forget_revoked(tenant_id)
    await record_audit(owner, "client.sessions.revoke", t.get("name", "client"), request, meta={"tenant_id": tenant_id})
    return {"ok": True}


class UnlockIn(BaseModel):
    email: EmailStr


@router.post("/tenants/{tenant_id}/security/unlock")
async def unlock_login(tenant_id: str, payload: UnlockIn, request: Request, owner: dict = Depends(require_permission("client.edit"))):
    t = await _tenant_or_404(tenant_id)
    email = payload.email.lower()
    if not await tenant_database(tenant_id).users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="No such user in this company")
    await gdb.login_attempts.delete_one({"email": email})
    await record_audit(owner, "client.login.unlock", t.get("name", "client"), request, meta={"tenant_id": tenant_id, "email": email})
    return {"ok": True}

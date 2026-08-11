"""My Apps (application registry) + Settings (platform, staff/roles, plans).

Generic — applications are data, not hardcoded. EduConnect Pro is seeded once as
the canonical product but any number of apps can be added.
"""
import logging
import os
import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from db import gdb, client, tenant_db_name
from auth_lib import gen_id, now_iso, hash_password, get_platform_owner
from routers.platform import (
    require_permission, record_audit, ROLE_PERMISSIONS, ALL_PERMISSIONS,
    PLATFORM_ROLES, permissions_for, _tenant_stats,
)

router = APIRouter(prefix="/api/platform", tags=["registry"])
log = logging.getLogger("registry")

APP_STATUSES = ["online", "degraded", "offline", "maintenance"]
ENVIRONMENTS = ["production", "staging", "development"]


# ─────────────────────────── My Apps ───────────────────────────
class AppIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: Optional[str] = ""
    logo_url: Optional[str] = ""
    version: Optional[str] = "1.0.0"
    environment: Optional[str] = "production"
    status: Optional[str] = "online"
    category: Optional[str] = "SaaS"
    assigned_client_ids: Optional[List[str]] = None


class AppPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    version: Optional[str] = None
    environment: Optional[str] = None
    status: Optional[str] = None
    category: Optional[str] = None
    assigned_client_ids: Optional[List[str]] = None


async def _seed_default_app():
    if await gdb.apps.count_documents({}) > 0:
        return
    ids = [t["id"] async for t in gdb.tenants.find({}, {"_id": 0, "id": 1})]
    await gdb.apps.insert_one({
        "id": gen_id(), "name": "EduConnect Pro", "slug": "educonnect-pro",
        "description": "Admissions & finance suite for education consultancies.",
        "logo_url": "/brand-logo.png", "version": "1.0.0", "environment": "production",
        "status": "online", "category": "Education CRM", "assigned_client_ids": ids,
        "created_at": now_iso(), "updated_at": now_iso(),
    })


async def _app_active_users(app: dict) -> int:
    total = 0
    for cid in (app.get("assigned_client_ids") or []):
        try:
            total += (await _tenant_stats(cid)).get("users", 0)
        except Exception:
            pass
    return total


@router.get("/apps")
async def list_apps(owner: dict = Depends(require_permission("app.view"))):
    await _seed_default_app()
    apps = []
    async for a in gdb.apps.find({}, {"_id": 0}).sort("created_at", 1):
        a["assigned_clients"] = len(a.get("assigned_client_ids") or [])
        a["active_users"] = await _app_active_users(a)
        apps.append(a)
    counts = {
        "total": len(apps),
        "online": sum(1 for a in apps if a.get("status") == "online"),
        "issues": sum(1 for a in apps if a.get("status") in ("degraded", "offline")),
    }
    return {"apps": apps, "counts": counts, "environments": ENVIRONMENTS, "statuses": APP_STATUSES}


@router.post("/apps", status_code=201)
async def create_app(payload: AppIn, request: Request, owner: dict = Depends(require_permission("app.create"))):
    doc = payload.model_dump()
    doc["id"] = gen_id()
    doc["slug"] = payload.name.lower().replace(" ", "-")
    doc["assigned_client_ids"] = payload.assigned_client_ids or []
    doc["created_at"] = doc["updated_at"] = now_iso()
    await gdb.apps.insert_one(doc)
    await record_audit(owner, "app.create", payload.name, request)
    doc.pop("_id", None)
    return doc


@router.get("/apps/{app_id}")
async def get_app(app_id: str, owner: dict = Depends(require_permission("app.view"))):
    a = await gdb.apps.find_one({"id": app_id}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Application not found")
    a["assigned_clients"] = len(a.get("assigned_client_ids") or [])
    a["active_users"] = await _app_active_users(a)
    return a


@router.patch("/apps/{app_id}")
async def patch_app(app_id: str, payload: AppPatch, request: Request, owner: dict = Depends(require_permission("app.manage"))):
    a = await gdb.apps.find_one({"id": app_id})
    if not a:
        raise HTTPException(status_code=404, detail="Application not found")
    patch = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if patch:
        patch["updated_at"] = now_iso()
        await gdb.apps.update_one({"id": app_id}, {"$set": patch})
        await record_audit(owner, "app.manage", a.get("name", app_id), request,
                           meta={"changed": list(patch.keys())})
    return await get_app(app_id, owner)


@router.delete("/apps/{app_id}")
async def delete_app(app_id: str, request: Request, owner: dict = Depends(require_permission("app.manage"))):
    a = await gdb.apps.find_one({"id": app_id})
    if not a:
        raise HTTPException(status_code=404, detail="Application not found")
    await gdb.apps.delete_one({"id": app_id})
    await record_audit(owner, "app.delete", a.get("name", app_id), request)
    return {"ok": True}


# ─────────────────────────── Settings: platform ───────────────────────────
DEFAULT_SETTINGS = {"platform_name": "EduConnect Pro", "support_email": "", "maintenance": False}


class SettingsPatch(BaseModel):
    platform_name: Optional[str] = None
    support_email: Optional[str] = None
    maintenance: Optional[bool] = None


@router.get("/settings")
async def get_settings(owner: dict = Depends(require_permission("settings.view"))):
    doc = await gdb.platform_settings.find_one({"id": "singleton"}, {"_id": 0}) or {}
    return {**DEFAULT_SETTINGS, **{k: v for k, v in doc.items() if k != "id"}}


@router.patch("/settings")
async def patch_settings(payload: SettingsPatch, request: Request, owner: dict = Depends(require_permission("settings.manage"))):
    patch = payload.model_dump(exclude_none=True)
    patch["updated_at"] = now_iso()
    await gdb.platform_settings.update_one({"id": "singleton"}, {"$set": patch}, upsert=True)
    await record_audit(owner, "settings.update", "platform", request, meta={"changed": list(patch.keys())})
    return await get_settings(owner)


# ─────────────────────────── Settings: staff & roles ───────────────────────────
class StaffIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    role: str = "support"


class StaffPatch(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None


@router.get("/staff")
async def list_staff(owner: dict = Depends(require_permission("settings.view"))):
    staff = []
    async for u in gdb.platform_owners.find({}, {"_id": 0, "password_hash": 0}):
        staff.append({
            "id": u["id"], "name": u.get("name"), "email": u.get("email"),
            "role": u.get("platform_role", "platform_owner"),
            "is_owner": u.get("platform_role", "platform_owner") == "platform_owner",
        })
    return {"staff": staff}


@router.post("/staff", status_code=201)
async def create_staff(payload: StaffIn, request: Request, owner: dict = Depends(require_permission("settings.manage"))):
    if payload.role not in PLATFORM_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    email = payload.email.lower().strip()
    if await gdb.platform_owners.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="A staff member with this email already exists")
    doc = {
        "id": gen_id(), "name": payload.name, "email": email,
        "password_hash": hash_password(payload.password),
        "platform_role": payload.role, "created_at": now_iso(),
    }
    await gdb.platform_owners.insert_one(doc)
    await record_audit(owner, "staff.create", email, request, meta={"role": payload.role})
    return {"id": doc["id"], "name": doc["name"], "email": email, "role": payload.role}


@router.patch("/staff/{staff_id}")
async def patch_staff(staff_id: str, payload: StaffPatch, request: Request, owner: dict = Depends(require_permission("settings.manage"))):
    u = await gdb.platform_owners.find_one({"id": staff_id})
    if not u:
        raise HTTPException(status_code=404, detail="Staff member not found")
    if u.get("platform_role", "platform_owner") == "platform_owner":
        raise HTTPException(status_code=403, detail="The platform owner cannot be modified here")
    patch = {}
    if payload.name is not None:
        patch["name"] = payload.name
    if payload.role is not None:
        if payload.role not in PLATFORM_ROLES or payload.role == "platform_owner":
            raise HTTPException(status_code=400, detail="Invalid role")
        patch["platform_role"] = payload.role
    if patch:
        await gdb.platform_owners.update_one({"id": staff_id}, {"$set": patch})
        await record_audit(owner, "staff.update", u.get("email", staff_id), request, meta=patch)
    return {"ok": True}


@router.delete("/staff/{staff_id}")
async def delete_staff(staff_id: str, request: Request, owner: dict = Depends(require_permission("settings.manage"))):
    u = await gdb.platform_owners.find_one({"id": staff_id})
    if not u:
        raise HTTPException(status_code=404, detail="Staff member not found")
    if u.get("platform_role", "platform_owner") == "platform_owner":
        raise HTTPException(status_code=403, detail="The platform owner cannot be deleted")
    if staff_id == owner.get("id"):
        raise HTTPException(status_code=400, detail="You cannot delete yourself")
    await gdb.platform_owners.delete_one({"id": staff_id})
    await record_audit(owner, "staff.delete", u.get("email", staff_id), request)
    return {"ok": True}


@router.get("/roles")
async def list_roles(owner: dict = Depends(require_permission("settings.view"))):
    return {
        "roles": [{"key": r, "permissions": permissions_for(r)} for r in PLATFORM_ROLES],
        "all_permissions": ALL_PERMISSIONS,
    }


# ─────────────────────────── Settings: plans ───────────────────────────
DEFAULT_PLANS = [
    {"name": "Trial", "price": 0, "features": ["1 workspace", "Community support"], "limits": {"users": 5, "students": 100}},
    {"name": "Starter", "price": 49, "features": ["All modules", "Email support"], "limits": {"users": 25, "students": 1000}},
    {"name": "Pro", "price": 149, "features": ["Priority support", "Custom branding"], "limits": {"users": 100, "students": 10000}},
]


class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    price: float = 0
    features: Optional[List[str]] = None
    limits: Optional[dict] = None


async def _seed_plans():
    if await gdb.plans.count_documents({}) > 0:
        return
    for p in DEFAULT_PLANS:
        await gdb.plans.insert_one({"id": gen_id(), **p, "created_at": now_iso()})


@router.get("/plans")
async def list_plans(owner: dict = Depends(require_permission("settings.view"))):
    await _seed_plans()
    plans = []
    async for p in gdb.plans.find({}, {"_id": 0}).sort("price", 1):
        plans.append(p)
    return {"plans": plans}


@router.post("/plans", status_code=201)
async def create_plan(payload: PlanIn, request: Request, owner: dict = Depends(require_permission("settings.manage"))):
    doc = {"id": gen_id(), **payload.model_dump(), "created_at": now_iso()}
    doc["features"] = payload.features or []
    doc["limits"] = payload.limits or {}
    await gdb.plans.insert_one(doc)
    await record_audit(owner, "plan.create", payload.name, request)
    doc.pop("_id", None)
    return doc


@router.patch("/plans/{plan_id}")
async def patch_plan(plan_id: str, payload: PlanIn, request: Request, owner: dict = Depends(require_permission("settings.manage"))):
    if not await gdb.plans.find_one({"id": plan_id}):
        raise HTTPException(status_code=404, detail="Plan not found")
    patch = payload.model_dump()
    patch["features"] = payload.features or []
    patch["limits"] = payload.limits or {}
    await gdb.plans.update_one({"id": plan_id}, {"$set": patch})
    await record_audit(owner, "plan.update", payload.name, request)
    return await gdb.plans.find_one({"id": plan_id}, {"_id": 0})


@router.delete("/plans/{plan_id}")
async def delete_plan(plan_id: str, request: Request, owner: dict = Depends(require_permission("settings.manage"))):
    p = await gdb.plans.find_one({"id": plan_id})
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found")
    await gdb.plans.delete_one({"id": plan_id})
    await record_audit(owner, "plan.delete", p.get("name", plan_id), request)
    return {"ok": True}


# ═══════════════════════════ Database module ═══════════════════════════
# Real stats from MongoDB. Reads use READONLY_MONGO_URL when configured (a
# read-only user on an external cluster), otherwise the app's own connection —
# limited to the platform DB + tenant DBs. Credentials are never exposed.
_RO_URI = os.environ.get("READONLY_MONGO_URL")
_ro_cached = None


def _ro_client():
    global _ro_cached
    if not _RO_URI:
        return None
    if _ro_cached is None:
        _ro_cached = AsyncIOMotorClient(_RO_URI, serverSelectionTimeoutMS=4000)
    return _ro_cached


def _db_read_client():
    return _ro_client() or client


def _mb(n):
    try:
        return round((n or 0) / (1024 * 1024), 2)
    except Exception:
        return 0


async def _allowed_dbs():
    """Map of db_name -> {client_name, environment} for platform + tenant DBs.
    If READONLY_MONGO_URL is set, enumerate that external cluster's databases
    (read-only) instead — real infra browsing without touching the app DB."""
    ro = _ro_client()
    if ro is not None:
        allowed = {}
        try:
            for name in await ro.list_database_names():
                if name in ("admin", "local", "config"):
                    continue
                allowed[name] = {"client": "External cluster", "environment": "production"}
        except Exception:
            pass
        return allowed
    allowed = {gdb.name: {"client": "Platform", "environment": "production"}}
    async for t in gdb.tenants.find({}, {"_id": 0, "id": 1, "name": 1, "plan": 1}):
        allowed[tenant_db_name(t["id"])] = {
            "client": t.get("name", "Client"),
            "environment": "production" if t.get("plan") != "trial" else "staging",
        }
    return allowed


@router.get("/database/connections")
async def db_connections(owner: dict = Depends(require_permission("database.view"))):
    allowed = await _allowed_dbs()
    conns = []
    for name, meta in allowed.items():
        entry = {"name": name, "client": meta["client"], "application": "EduConnect Pro",
                 "environment": meta["environment"], "provider": "MongoDB",
                 "status": "offline", "collections": 0, "size_mb": 0, "last_backup": None}
        try:
            db = _db_read_client()[name]
            stats = await db.command("dbstats")
            entry["status"] = "online"
            entry["collections"] = stats.get("collections", 0)
            entry["size_mb"] = _mb(stats.get("dataSize"))
        except Exception:
            entry["status"] = "unknown"
        bk = await gdb.db_backups.find_one({"db_name": name}, sort=[("created_at", -1)])
        if bk:
            entry["last_backup"] = bk.get("created_at")
        conns.append(entry)
    counts = {
        "total": len(conns),
        "production": sum(1 for c in conns if c["environment"] == "production"),
        "staging": sum(1 for c in conns if c["environment"] == "staging"),
        "online": sum(1 for c in conns if c["status"] == "online"),
    }
    return {"connections": conns, "counts": counts}


@router.get("/database/{db_name}/collections")
async def db_collections(db_name: str, owner: dict = Depends(require_permission("database.view"))):
    allowed = await _allowed_dbs()
    if db_name not in allowed:
        raise HTTPException(status_code=404, detail="Unknown database")
    db = _db_read_client()[db_name]
    cols = []
    try:
        for cname in sorted(await db.list_collection_names()):
            try:
                cnt = await db[cname].estimated_document_count()
            except Exception:
                cnt = 0
            cols.append({"name": cname, "documents": cnt})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot read collections: {e}")
    return {"database": db_name, "client": allowed[db_name]["client"], "collections": cols}


@router.post("/database/{db_name}/backup")
async def db_backup(db_name: str, request: Request, owner: dict = Depends(require_permission("database.backup"))):
    """Record a backup checkpoint (metadata). A real dump requires a connected
    backup agent — this logs an audited, timestamped snapshot marker."""
    allowed = await _allowed_dbs()
    if db_name not in allowed:
        raise HTTPException(status_code=404, detail="Unknown database")
    doc = {"id": gen_id(), "db_name": db_name, "created_at": now_iso(),
           "by": owner.get("name"), "type": "checkpoint"}
    await gdb.db_backups.insert_one(doc)
    await record_audit(owner, "database.backup", db_name, request)
    return {"ok": True, "last_backup": doc["created_at"]}


# ═══════════════════════════ VPS Server module ═══════════════════════════
class ServerIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    environment: Optional[str] = "production"
    hostname: Optional[str] = ""
    provider: Optional[str] = "Custom"
    status: Optional[str] = "online"
    notes: Optional[str] = ""
    agent_url: Optional[str] = ""   # e.g. https://vps.example.com:9101
    agent_key: Optional[str] = ""   # shared secret the agent validates


class ServerAction(BaseModel):
    action: str  # start | stop | restart


@router.get("/servers")
async def list_servers(owner: dict = Depends(require_permission("server.view"))):
    servers = []
    async for s in gdb.servers.find({}, {"_id": 0, "agent_key": 0}).sort("created_at", 1):
        s["has_agent"] = bool(s.get("agent_url"))
        servers.append(s)
    counts = {
        "total": len(servers),
        "online": sum(1 for s in servers if s.get("status") == "online"),
        "offline": sum(1 for s in servers if s.get("status") == "offline"),
    }
    return {"servers": servers, "counts": counts}


@router.post("/servers", status_code=201)
async def create_server(payload: ServerIn, request: Request, owner: dict = Depends(require_permission("server.deploy"))):
    doc = {"id": gen_id(), **payload.model_dump(), "created_at": now_iso(), "containers": []}
    await gdb.servers.insert_one(doc)
    await record_audit(owner, "server.create", payload.name, request)
    doc.pop("_id", None)
    return doc


@router.patch("/servers/{server_id}")
async def patch_server(server_id: str, payload: ServerIn, request: Request, owner: dict = Depends(require_permission("server.deploy"))):
    if not await gdb.servers.find_one({"id": server_id}):
        raise HTTPException(status_code=404, detail="Server not found")
    await gdb.servers.update_one({"id": server_id}, {"$set": payload.model_dump()})
    await record_audit(owner, "server.update", payload.name, request)
    return await gdb.servers.find_one({"id": server_id}, {"_id": 0})


@router.delete("/servers/{server_id}")
async def delete_server(server_id: str, request: Request, owner: dict = Depends(require_permission("server.deploy"))):
    s = await gdb.servers.find_one({"id": server_id})
    if not s:
        raise HTTPException(status_code=404, detail="Server not found")
    await gdb.servers.delete_one({"id": server_id})
    await record_audit(owner, "server.delete", s.get("name", server_id), request)
    return {"ok": True}


@router.post("/servers/{server_id}/action")
async def server_action(server_id: str, payload: ServerAction, request: Request, owner: dict = Depends(require_permission("server.restart"))):
    """Dangerous control action. Requires server.restart permission + a
    confirmation on the client. Because no live agent is connected, this records
    the intent + updates status and is fully audited; it does NOT touch a real
    machine until a server agent/API is wired up."""
    s = await gdb.servers.find_one({"id": server_id})
    if not s:
        raise HTTPException(status_code=404, detail="Server not found")
    if payload.action not in ("start", "stop", "restart"):
        raise HTTPException(status_code=400, detail="Invalid action")
    new_status = "offline" if payload.action == "stop" else "online"
    await gdb.servers.update_one({"id": server_id}, {"$set": {"status": new_status, "updated_at": now_iso()}})
    await record_audit(owner, f"server.{payload.action}", s.get("name", server_id), request,
                       meta={"note": "recorded — no live agent connected"})
    return {"ok": True, "status": new_status, "note": "Recorded. Connect a server agent for live control."}


# ─────────────── VPS agent proxy (live metrics + Docker control) ───────────────
async def _agent_call(server: dict, method: str, path: str, json=None):
    url = (server.get("agent_url") or "").rstrip("/")
    if not url:
        raise HTTPException(status_code=409, detail="No agent connected for this server")
    headers = {"X-Agent-Key": server.get("agent_key", "")}
    try:
        async with httpx.AsyncClient(timeout=8) as hc:
            r = await hc.request(method, f"{url}{path}", headers=headers, json=json)
        if r.status_code == 401:
            raise HTTPException(status_code=502, detail="Agent rejected the API key")
        r.raise_for_status()
        return r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Agent unreachable: {e}")


@router.get("/servers/{server_id}/metrics")
async def server_metrics(server_id: str, owner: dict = Depends(require_permission("server.view"))):
    s = await gdb.servers.find_one({"id": server_id})
    if not s:
        raise HTTPException(status_code=404, detail="Server not found")
    return await _agent_call(s, "GET", "/metrics")


@router.get("/servers/{server_id}/containers")
async def server_containers(server_id: str, owner: dict = Depends(require_permission("server.view"))):
    s = await gdb.servers.find_one({"id": server_id})
    if not s:
        raise HTTPException(status_code=404, detail="Server not found")
    return await _agent_call(s, "GET", "/containers")


@router.post("/servers/{server_id}/containers/{name}/{action}")
async def container_action(server_id: str, name: str, action: str, request: Request,
                           owner: dict = Depends(require_permission("server.restart"))):
    if action not in ("start", "stop", "restart"):
        raise HTTPException(status_code=400, detail="Invalid action")
    s = await gdb.servers.find_one({"id": server_id})
    if not s:
        raise HTTPException(status_code=404, detail="Server not found")
    res = await _agent_call(s, "POST", f"/containers/{name}/{action}")
    await record_audit(owner, f"container.{action}", f"{name}@{s.get('name')}", request,
                       meta={"server_id": server_id})
    return res

"""Tenant-side onboarding: getting-started checklist + the company's tour copy."""
from fastapi import APIRouter, Depends

from auth_lib import get_current_user, now_iso
from db import db, gdb
from lib.tour import resolve_tour_steps

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

ADMIN = {"super_admin", "office_admin"}

# key, label, hint, module, roles allowed, link per role (default "*")
ITEMS = [
    ("first_student", "Add your first student", "Create a student record to start tracking admissions and fees.",
     "students", {"super_admin", "office_admin", "staff"}, {"*": "/students"}),
    ("invite_staff", "Invite a staff member", "Bring a colleague into the workspace.",
     "users", ADMIN, {"super_admin": "/users", "office_admin": "/employees"}),
    ("first_lead", "Create your first lead", "Add an enquiry to the CRM pipeline.",
     "leads", {"super_admin", "office_admin", "staff"}, {"*": "/leads"}),
    ("first_payment", "Record your first payment", "Open a student and log a fee payment.",
     "students", {"super_admin", "office_admin", "staff"}, {"*": "/students"}),
    ("google_sheets", "Connect Google Sheets", "Link a Google account to sync data with your sheets.",
     "google_sheets", ADMIN, {"*": "/settings"}),
    ("branding", "Set your branding & logo", "Upload a logo and pick your brand colour.",
     None, {"super_admin"}, {"*": "/branding"}),
]


def _on(mods, key):
    return key is None or mods is None or key in mods


async def _done_flags(tenant: dict) -> dict:
    return {
        "first_student": await db.students.count_documents({}, limit=1) > 0,
        "invite_staff": await db.users.count_documents({"deleted_at": {"$exists": False}}, limit=2) > 1,
        "first_lead": await db.leads.count_documents({}, limit=1) > 0,
        "first_payment": await db.students.count_documents({"payments.0": {"$exists": True}}, limit=1) > 0,
        "google_sheets": await db.google_connections.count_documents({"provider": "google_sheets"}, limit=1) > 0,
        "branding": bool((tenant.get("branding") or {}).get("logo_url")),
    }


@router.get("/checklist")
async def checklist(user: dict = Depends(get_current_user)):
    tenant = await gdb.tenants.find_one({"id": user.get("tenant_id")}, {"_id": 0}) or {}
    mods = tenant.get("enabled_modules")
    role = user.get("role")
    done = await _done_flags(tenant)
    items = [
        {"key": k, "label": label, "hint": hint, "done": done[k], "to": links.get(role) or links.get("*")}
        for k, label, hint, mod, roles, links in ITEMS
        if role in roles and _on(mods, mod)
    ]
    finished = sum(1 for i in items if i["done"])
    return {
        "items": items, "done": finished, "total": len(items),
        "dismissed": bool(user.get("onboarding_dismissed")),
        "complete": bool(items) and finished == len(items),
    }


@router.post("/checklist/dismiss")
async def dismiss(user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"onboarding_dismissed": True, "onboarding_dismissed_at": now_iso()}})
    return {"ok": True}


@router.get("/tour")
async def tour_config(user: dict = Depends(get_current_user)):
    tenant = await gdb.tenants.find_one({"id": user.get("tenant_id")}, {"_id": 0, "tour_steps": 1}) or {}
    return {"steps": [s for s in resolve_tour_steps(tenant.get("tour_steps")) if s["enabled"]]}

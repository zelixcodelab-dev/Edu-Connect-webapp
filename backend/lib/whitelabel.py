"""White-label core: branding defaults, module catalog, tenant provisioning.

Kept dependency-light (only ``db`` + ``auth_lib`` primitives) so it can be
imported from ``seed.py``, the platform router and the branding router
without circular imports.
"""
import os
import re
import logging

from db import gdb, tenant_database, ensure_tenant_indexes
from auth_lib import hash_password, gen_id, now_iso

_log = logging.getLogger("whitelabel")


# --------------------------------------------------------------------------
# Branding
# --------------------------------------------------------------------------
DEFAULT_APP_NAME = os.environ.get("DEFAULT_APP_NAME", "Edu Connect")

DEFAULT_BRANDING = {
    "app_name": DEFAULT_APP_NAME,
    "app_short": "Connect",
    "company_line": "Admissions & Finance Suite",
    "logo_url": "",                       # empty → frontend shows the default mark
    "brand_color": "#C70000",             # crimson (matches the base theme)
    "hero_title": "AdmissionOps,",
    "hero_accent": "Real-Time Tracker.",
    "hero_tagline": "The complete partner & admission management platform for education consultancies.",
    "eyebrow": "Admissions · Office Portal",
    "currency": "INR",
}

BRANDING_FIELDS = list(DEFAULT_BRANDING.keys())


def merged_branding(raw):
    """Merge a stored/partial branding dict over the defaults."""
    out = dict(DEFAULT_BRANDING)
    for k, v in (raw or {}).items():
        if k in DEFAULT_BRANDING and v is not None and v != "":
            out[k] = v
    # logo_url may legitimately be empty — copy it through if present
    if raw and "logo_url" in raw:
        out["logo_url"] = raw.get("logo_url") or ""
    return out


# --------------------------------------------------------------------------
# Module catalog — which app areas a company can switch on/off.
# `locked` modules are always available (an admin needs them to operate).
# --------------------------------------------------------------------------
MODULE_CATALOG = [
    {"key": "overview", "label": "Overview / Dashboard", "locked": True},
    {"key": "settings", "label": "Settings", "locked": True},
    {"key": "users", "label": "Team & Permissions", "locked": True},
    {"key": "quick_entry", "label": "Quick Entry"},
    {"key": "transactions", "label": "Transactions"},
    {"key": "accounts", "label": "Accounts"},
    {"key": "invoices", "label": "Invoicing"},
    {"key": "clients", "label": "Clients & Staff"},
    {"key": "students", "label": "Students & Fees"},
    {"key": "leads", "label": "CRM / Leads"},
    {"key": "leave", "label": "Leave Management"},
    {"key": "expense_requests", "label": "Expense Approvals"},
    {"key": "colleges", "label": "Colleges"},
    {"key": "admission_revenue", "label": "Admission Revenue"},
    {"key": "agents", "label": "Sub-agent Ledger"},
    {"key": "messages", "label": "Messages"},
    {"key": "activity", "label": "Activity Log"},
    {"key": "categories", "label": "Categories"},
    {"key": "office_overview", "label": "Office Overview"},
    {"key": "staff", "label": "Staff Directory"},
]

ALL_MODULE_KEYS = [m["key"] for m in MODULE_CATALOG]
LOCKED_MODULE_KEYS = [m["key"] for m in MODULE_CATALOG if m.get("locked")]
DEFAULT_ENABLED_MODULES = list(ALL_MODULE_KEYS)


def normalize_modules(modules):
    """Keep only known keys, always include locked ones."""
    if modules is None:
        return list(DEFAULT_ENABLED_MODULES)
    picked = [k for k in modules if k in ALL_MODULE_KEYS]
    for k in LOCKED_MODULE_KEYS:
        if k not in picked:
            picked.append(k)
    return picked


# --------------------------------------------------------------------------
# Default finance catalog seeded into every new company
# --------------------------------------------------------------------------
DEFAULT_CATEGORIES = [
    {"name": "Sales", "type": "income", "color": "#059669", "icon": "TrendUp"},
    {"name": "Services", "type": "income", "color": "#10b981", "icon": "Briefcase"},
    {"name": "Other Income", "type": "income", "color": "#34d399", "icon": "Coins"},
    {"name": "Application Fees", "type": "income", "color": "#14b8a6", "icon": "FileText"},
    {"name": "Registration Fees", "type": "income", "color": "#0d9488", "icon": "ClipboardText"},
    {"name": "Admission Fees", "type": "income", "color": "#0d9488", "icon": "GraduationCap"},
    {"name": "Booking Amount", "type": "income", "color": "#0891b2", "icon": "BookmarkSimple"},
    {"name": "Tuition Fees", "type": "income", "color": "#2563eb", "icon": "BookOpen"},
    {"name": "Sem Fees", "type": "income", "color": "#4f46e5", "icon": "Books"},
    {"name": "Other Fees", "type": "income", "color": "#0f766e", "icon": "Receipt"},
    {"name": "Rent", "type": "expense", "color": "#be123c", "icon": "House"},
    {"name": "Fuel Exp", "type": "expense", "color": "#b91c1c", "icon": "GasPump"},
    {"name": "Food", "type": "expense", "color": "#dc2626", "icon": "ForkKnife"},
    {"name": "Utilities", "type": "expense", "color": "#9f1239", "icon": "Lightning"},
    {"name": "Salaries", "type": "expense", "color": "#525252", "icon": "Users"},
    {"name": "Office Supplies", "type": "expense", "color": "#92400e", "icon": "Package"},
    {"name": "Marketing", "type": "expense", "color": "#7c2d12", "icon": "Megaphone"},
    {"name": "Travel", "type": "expense", "color": "#0e7490", "icon": "Airplane"},
    {"name": "Software", "type": "expense", "color": "#4338ca", "icon": "Cpu"},
    {"name": "Other", "type": "expense", "color": "#78716c", "icon": "DotsThree"},
]


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "company"


def tenant_public(doc: dict) -> dict:
    """Shape a tenant document for API responses (no secrets)."""
    return {
        "id": doc.get("id"),
        "name": doc.get("name"),
        "slug": doc.get("slug"),
        "status": doc.get("status", "active"),
        "admin_email": doc.get("admin_email"),
        "branding": merged_branding(doc.get("branding")),
        "enabled_modules": normalize_modules(doc.get("enabled_modules")),
        "created_at": doc.get("created_at"),
    }


async def _seed_tenant_defaults(tenant_id: str, admin_user_id: str, currency: str) -> None:
    tdb = tenant_database(tenant_id)
    cats = [
        {"id": gen_id(), "user_id": admin_user_id, "created_at": now_iso(), **c}
        for c in DEFAULT_CATEGORIES
    ]
    await tdb.categories.insert_many(cats)
    await tdb.accounts.insert_one({
        "id": gen_id(),
        "user_id": admin_user_id,
        "name": "Main Bank",
        "type": "bank",
        "opening_balance": 0.0,
        "color": "#10b981",
        "created_at": now_iso(),
    })


async def _seed_tenant_defaults_safe(tenant_id: str, admin_user_id: str, currency: str) -> None:
    """Best-effort defaults seeding. The company's registry row and admin
    user are already created before this runs, so a failure here (e.g.
    ``OutOfDiskSpace`` on a full DB) must not abort provisioning — the
    company must stay loginable. We log and move on."""
    try:
        await _seed_tenant_defaults(tenant_id, admin_user_id, currency)
    except Exception as exc:  # noqa: BLE001
        _log.warning("Default data seeding skipped for tenant %s: %s", tenant_id, exc)


async def email_in_use(email: str) -> bool:
    """True if the email is already a platform owner or any company's user."""
    email = (email or "").lower().strip()
    if await gdb.platform_owners.find_one({"email": email}):
        return True
    async for t in gdb.tenants.find({}, {"_id": 0, "id": 1}):
        tdb = tenant_database(t["id"])
        if await tdb.users.find_one({"email": email}):
            return True
    return False


async def provision_tenant(
    *,
    name: str,
    admin_email: str,
    admin_password: str,
    admin_name: str = "Administrator",
    branding: dict | None = None,
    enabled_modules=None,
    tenant_id: str | None = None,
    status: str = "active",
) -> dict:
    """Create a company: registry row + isolated DB + admin + defaults."""
    tid = tenant_id or gen_id()
    admin_email = (admin_email or "").lower().strip()
    b = merged_branding({**(branding or {}), "app_name": (branding or {}).get("app_name") or name})
    modules = normalize_modules(enabled_modules)
    doc = {
        "id": tid,
        "name": name,
        "slug": slugify(name),
        "status": status,
        "admin_email": admin_email,
        "branding": b,
        "enabled_modules": modules,
        "created_at": now_iso(),
    }
    await gdb.tenants.insert_one(doc)
    await ensure_tenant_indexes(tid)

    tdb = tenant_database(tid)
    admin_id = gen_id()
    await tdb.users.insert_one({
        "id": admin_id,
        "email": admin_email,
        "name": admin_name,
        "business_name": name,
        "password_hash": hash_password(admin_password),
        "currency": b.get("currency", "INR"),
        "role": "super_admin",
        "office": None,
        "approval_status": "approved",
        "created_at": now_iso(),
    })
    await _seed_tenant_defaults_safe(tid, admin_id, b.get("currency", "INR"))
    return doc


async def ensure_tenant_admin(tenant: dict, admin_email: str, admin_password: str,
                              admin_name: str = "Administrator") -> None:
    """Repair a half-provisioned tenant: ensure its admin user (and default
    data) exist inside the tenant DB. Idempotent — no-op if the admin already
    exists. Needed because a tenant's registry row is written to the platform
    DB *before* its admin user; if the admin insert failed earlier (e.g. Atlas
    rejected an over-long DB name), the company was left un-loginable."""
    tid = tenant["id"]
    admin_email = (admin_email or "").lower().strip()
    tdb = tenant_database(tid)
    if await tdb.users.find_one({"email": admin_email}):
        return
    await ensure_tenant_indexes(tid)
    b = tenant.get("branding") or {}
    admin_id = gen_id()
    await tdb.users.insert_one({
        "id": admin_id,
        "email": admin_email,
        "name": admin_name,
        "business_name": tenant.get("name", admin_name),
        "password_hash": hash_password(admin_password),
        "currency": b.get("currency", "INR"),
        "role": "super_admin",
        "office": None,
        "approval_status": "approved",
        "created_at": now_iso(),
    })
    await _seed_tenant_defaults_safe(tid, admin_id, b.get("currency", "INR"))


async def find_tenant_for_email(email: str):
    """Scan companies for the (globally-unique) email. Returns
    ``(tenant_doc, user_doc)`` or ``(None, None)``. Company count is small so
    a linear scan at login time is fine."""
    email = (email or "").lower().strip()
    async for t in gdb.tenants.find({}):
        tdb = tenant_database(t["id"])
        user = await tdb.users.find_one({"email": email})
        if user:
            return t, user
    return None, None

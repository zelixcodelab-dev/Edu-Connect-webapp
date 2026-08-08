"""MongoDB client + multi-tenant database routing.

Architecture
------------
This app is multi-tenant. Each *company* (tenant) gets its OWN MongoDB
database so business data is physically isolated. A single shared
"platform" database holds the tenant registry, the platform owner
account, and cross-tenant auth-security collections (login attempts,
password-reset tokens).

The key idea: ``db`` is a context-scoped proxy. Every request resolves
the active tenant (from the JWT, inside ``get_current_user``) and stores
it in a ``contextvars.ContextVar``. All existing routers keep doing
``db.students.find(...)`` and automatically read/write the correct tenant
database — no per-router changes required.

* ``gdb``  → the shared platform database (tenants, platform owner, auth).
* ``db``   → context-scoped proxy → the current tenant's database.
"""
import os
import contextvars
import hashlib
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

# These come from the deployment environment (Railway/Render service variables)
# or a local .env. Read them defensively so a missing value produces a clear,
# actionable error instead of a cryptic KeyError deep in the import traceback.
MONGO_URL = os.environ.get("MONGO_URL")
_BASE_DB_NAME = os.environ.get("DB_NAME")
if not MONGO_URL or not _BASE_DB_NAME:
    raise RuntimeError(
        "Missing required environment variables MONGO_URL and/or DB_NAME. "
        "Set them in your deployment's service variables (and provision a MongoDB "
        "or MongoDB Atlas database), then redeploy. Example: "
        "MONGO_URL=mongodb+srv://user:pass@cluster/…  DB_NAME=educonnect"
    )

client = AsyncIOMotorClient(MONGO_URL)

# Shared platform database — tenant registry + platform owner + auth security.
gdb = client[f"{_BASE_DB_NAME}_platform"]

# ContextVar carrying the active tenant id for the current request/task.
_current_tenant: contextvars.ContextVar = contextvars.ContextVar(
    "current_tenant_id", default=None
)

# When no tenant is bound to the current context (public endpoints,
# background tasks) we fall back to the *default* tenant so the app keeps
# working out-of-the-box. Set once at startup.
_DEFAULT_TENANT_ID = None


def set_default_tenant(tenant_id):
    global _DEFAULT_TENANT_ID
    _DEFAULT_TENANT_ID = tenant_id


def get_default_tenant_id():
    return _DEFAULT_TENANT_ID


def set_current_tenant(tenant_id):
    """Bind a tenant to the current context. Returns the reset token."""
    return _current_tenant.set(tenant_id)


def get_current_tenant():
    return _current_tenant.get()


def reset_current_tenant(token) -> None:
    try:
        _current_tenant.reset(token)
    except Exception:
        pass


def tenant_db_name(tenant_id: str) -> str:
    """Deterministic, stable database name for a tenant.

    MongoDB **Atlas caps database names at 38 bytes** (self-hosted allows 64).
    The natural name ``{base}_t_{uuidhex}`` is ~45 bytes and Atlas rejects it
    with ``AtlasError 8000 (database name too long)``. So: keep the readable
    full name when it fits, otherwise fall back to a deterministic short name
    built from a truncated SHA-1 of the tenant id (64-bit → negligible
    collision risk for realistic tenant counts). Same input always yields the
    same name, so lookups stay consistent across requests and restarts.
    """
    safe = (tenant_id or "").replace("-", "")
    full = f"{_BASE_DB_NAME}_t_{safe}"
    if len(full.encode("utf-8")) <= 38:
        return full
    tid = hashlib.sha1(safe.encode("utf-8")).hexdigest()[:16]  # 16 hex = 64-bit
    suffix = f"_t_{tid}"
    prefix = _BASE_DB_NAME[: max(1, 38 - len(suffix))]
    return f"{prefix}{suffix}"


def tenant_database(tenant_id: str):
    return client[tenant_db_name(tenant_id)]


def _resolve_db():
    tid = _current_tenant.get() or _DEFAULT_TENANT_ID
    if tid:
        return client[tenant_db_name(tid)]
    # Last-resort fallback: the base database (used only before any tenant
    # exists — e.g. the very first boot before the default tenant is seeded).
    return client[_BASE_DB_NAME]


class _DBProxy:
    """Transparent proxy forwarding every attribute/item access to the
    tenant database resolved from the current context."""

    def __getattr__(self, name):
        return getattr(_resolve_db(), name)

    def __getitem__(self, name):
        return _resolve_db()[name]


# The public handle every router imports.
db = _DBProxy()


import logging

_log = logging.getLogger("db.indexes")

# (collection, keys, kwargs) — keys is a str or a list of (field, direction) tuples.
_TENANT_INDEXES = [
    ("users", "email", {"unique": True}),
    ("accounts", "user_id", {}),
    ("clients", "user_id", {}),
    ("categories", "user_id", {}),
    ("transactions", [("user_id", 1), ("date", -1)], {}),
    ("transactions", "linked_invoice_id", {}),
    ("transactions", "linked_student_payment_id", {}),
    ("transactions", "linked_student_id", {}),
    ("transactions", "linked_expense_request_id", {}),
    ("invoices", "user_id", {}),
    ("invoices", "linked_visit_invoice_id", {}),
    ("students", "user_id", {}),
    ("students", "referrer_user_id", {}),
    ("expense_requests", "status", {}),
    ("notifications", [("recipient_user_id", 1), ("created_at", -1)], {}),
    ("messages", "thread_id", {}),
    ("colleges", "name_lower", {"unique": True}),
    ("leads", "office", {}),
    ("leads", "assigned_to_user_id", {}),
]


async def ensure_tenant_indexes(tenant_id: str) -> None:
    """Create the per-tenant indexes for a company's database. Idempotent.

    Each index is created independently and best-effort: if MongoDB refuses
    (e.g. ``OutOfDiskSpace`` / ``OperationFailure`` on a storage-limited or
    full database), we log and continue so tenant provisioning still finishes
    and the company stays loginable. Indexes are pure optimizations here — the
    app functions correctly without them.
    """
    tdb = tenant_database(tenant_id)
    for collection, keys, kwargs in _TENANT_INDEXES:
        try:
            await tdb[collection].create_index(keys, **kwargs)
        except Exception as exc:  # noqa: BLE001 — never let indexing break provisioning
            _log.warning(
                "Skipping index on %s.%s (%s): %s",
                tenant_db_name(tenant_id), collection, keys, exc,
            )

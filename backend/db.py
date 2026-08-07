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
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])

_BASE_DB_NAME = os.environ["DB_NAME"]

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
    safe = (tenant_id or "").replace("-", "")
    return f"{_BASE_DB_NAME}_t_{safe}"


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


async def ensure_tenant_indexes(tenant_id: str) -> None:
    """Create the per-tenant indexes for a company's database. Idempotent."""
    tdb = tenant_database(tenant_id)
    try:
        await tdb.users.create_index("email", unique=True)
    except Exception:
        pass
    await tdb.accounts.create_index("user_id")
    await tdb.clients.create_index("user_id")
    await tdb.categories.create_index("user_id")
    await tdb.transactions.create_index([("user_id", 1), ("date", -1)])
    await tdb.transactions.create_index("linked_invoice_id")
    await tdb.transactions.create_index("linked_student_payment_id")
    await tdb.transactions.create_index("linked_student_id")
    await tdb.transactions.create_index("linked_expense_request_id")
    await tdb.invoices.create_index("user_id")
    await tdb.invoices.create_index("linked_visit_invoice_id")
    await tdb.students.create_index("user_id")
    await tdb.students.create_index("referrer_user_id")
    await tdb.expense_requests.create_index("status")
    await tdb.notifications.create_index([("recipient_user_id", 1), ("created_at", -1)])
    await tdb.messages.create_index("thread_id")
    try:
        await tdb.colleges.create_index("name_lower", unique=True)
    except Exception:
        pass
    await tdb.leads.create_index("office")
    await tdb.leads.create_index("assigned_to_user_id")

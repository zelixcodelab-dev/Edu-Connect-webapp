"""FinFlow API entrypoint. Routers live in routers/."""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import logging
import os
import asyncio
import re
import subprocess
import time
from datetime import datetime, timezone

from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from db import client, db, gdb, set_default_tenant
from seed import seed_platform_and_default_tenant
from routers import auth, accounts, clients, categories, transactions, invoices, dashboard, students, users, expense_requests, notifications, applications, colleges, push, messages, leads, leave, uploads, staff, campaigns, admission_revenue, activity
from routers import platform as platform_router
from routers import branding as branding_router


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


app = FastAPI(title="Edu Connect API")

# Mount all feature routers (each already includes the /api prefix).
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(clients.router)
app.include_router(categories.router)
app.include_router(transactions.router)
app.include_router(invoices.router)
app.include_router(dashboard.router)
app.include_router(students.router)
app.include_router(users.router)
app.include_router(expense_requests.router)
app.include_router(notifications.router)
app.include_router(applications.router)
app.include_router(applications.admin_router)
app.include_router(colleges.router)
app.include_router(colleges.public_router)
app.include_router(push.router)
app.include_router(messages.router)
app.include_router(leads.router)
app.include_router(leave.router)
app.include_router(uploads.router)
app.include_router(staff.router)
app.include_router(campaigns.router)
app.include_router(admission_revenue.router)
app.include_router(activity.router)
app.include_router(platform_router.router)
app.include_router(branding_router.router)

# Health endpoint
health = APIRouter(prefix="/api", tags=["health"])


@health.get("/")
async def root() -> dict[str, str]:
    return {"service": "Edu Connect", "status": "ok"}


# Resolve the commit SHA once at import time. Prefer the env var Emergent sets
# at deploy-time; fall back to `git rev-parse` for local/dev runs.
def _resolve_commit() -> str:
    sha = os.environ.get("GIT_COMMIT_SHA") or os.environ.get("COMMIT_SHA")
    if sha:
        return sha[:12]
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=ROOT_DIR.parent, stderr=subprocess.DEVNULL, timeout=2,
        )
        return out.decode().strip() or "unknown"
    except Exception:
        return "unknown"


COMMIT_SHA = _resolve_commit()
BOOTED_AT = datetime.now(timezone.utc).isoformat()


@health.get("/healthz")
async def healthz() -> dict:
    """Liveness + DB connectivity probe for Emergent uptime checks."""
    started = time.perf_counter()
    db_ok = False
    db_error: str | None = None
    try:
        await db.command("ping")
        db_ok = True
    except Exception as exc:  # narrow: any driver/network failure is "degraded"
        db_error = str(exc)
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    return {
        "service": "Edu Connect",
        "status": "ok" if db_ok else "degraded",
        "db": {"connected": db_ok, "latency_ms": latency_ms, "error": db_error},
        "commit": COMMIT_SHA,
        "booted_at": BOOTED_AT,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


app.include_router(health)

# CORS — allow-list (SEC-001). Combines explicit non-browser schemes with a
# regex matching the domains we actually serve (Emergent preview/deploy +
# localhost). Extra production domains can be added via the CORS_ORIGINS env
# var (comma-separated). Using ``.*`` with credentials would be unsafe.
_extra_origins = [
    o.strip() for o in (os.environ.get("CORS_ORIGINS") or "").split(",")
    if o.strip() and o.strip() != "*"
]
_static_origins = [
    "capacitor://localhost",
    "http://localhost",
    "https://localhost",
    "ionic://localhost",
    *_extra_origins,
]
_ALLOW_ORIGIN_REGEX = (
    r"(?i)^https?://("
    r"localhost(:\d+)?|"
    r"127\.0\.0\.1(:\d+)?|"
    r"([a-z0-9-]+\.)*emergentagent\.com|"
    r"([a-z0-9-]+\.)*emergentagent\.net|"
    r"([a-z0-9-]+\.)*emergent\.host|"
    r"([a-z0-9-]+\.)*emergent\.sh|"
    # Mainstream hosting platforms this white-label app is commonly deployed to.
    # Lets a fresh Vercel/Railway/Render/Netlify frontend reach its backend
    # without hand-editing CORS. Exact custom domains can still be added via
    # the CORS_ORIGINS env var.
    r"([a-z0-9-]+\.)*vercel\.app|"
    r"([a-z0-9-]+\.)*up\.railway\.app|"
    r"([a-z0-9-]+\.)*onrender\.com|"
    r"([a-z0-9-]+\.)*netlify\.app"
    r")$"
)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_static_origins,
    allow_origin_regex=_ALLOW_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
    max_age=600,  # cache preflights for 10 min → far fewer OPTIONS on flaky mobile networks
)


# Diagnostic: log any request whose Origin was blocked by CORS so we notice
# unknown-domain deployments quickly (production login-outage class of bugs).
# Cheap check — we run the same regex Starlette used and only fire on
# preflight OPTIONS to keep logs tidy.
_cors_regex = re.compile(_ALLOW_ORIGIN_REGEX)


@app.middleware("http")
async def _log_blocked_cors(request, call_next):
    origin = request.headers.get("origin")
    if origin and request.method == "OPTIONS" and not _cors_regex.match(origin) and origin not in _static_origins:
        logger.warning(
            "[cors] blocked OPTIONS origin=%s path=%s — add it to CORS regex if legitimate",
            origin, request.url.path,
        )
    return await call_next(request)


async def _ensure_login_attempts_index() -> None:
    """Build the unique index on login_attempts.email in the shared platform
    DB, deduping legacy rows that would otherwise block creation."""
    try:
        await gdb.login_attempts.create_index("email", unique=True)
        return
    except Exception:
        seen: set = set()
        async for d in gdb.login_attempts.find({}, {"_id": 1, "email": 1}):
            email = d.get("email")
            if email in seen:
                await gdb.login_attempts.delete_one({"_id": d["_id"]})
            else:
                seen.add(email)
        await gdb.login_attempts.create_index("email", unique=True)


@app.on_event("startup")
async def startup() -> None:
    # Shared platform-DB indexes (auth security + tenant registry).
    await _ensure_login_attempts_index()
    try:
        await gdb.password_reset_tokens.create_index("token_hash", unique=True)
        await gdb.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
        await gdb.tenants.create_index("id", unique=True)
        await gdb.tenants.create_index("slug")
        await gdb.platform_owners.create_index("email", unique=True)
    except Exception:
        logger.exception("[startup] platform index setup failed")

    # Seed platform owner + default company (also binds the default tenant so
    # context-less requests resolve to a real database).
    await seed_platform_and_default_tenant()

    # Per-tenant helper indexes (rate-limit + activity) resolve against the
    # default tenant DB now that it's bound. Non-fatal.
    try:
        from lib.rate_limit import ensure_indexes as _rl_indexes
        await _rl_indexes()
    except Exception:
        logger.exception("[rate_limit] index setup failed")
    try:
        from lib.activity_log import ensure_indexes as _al_indexes
        await _al_indexes()
    except Exception:
        logger.exception("[activity_log] index setup failed")

    # Initialise object storage (profile photo uploads) — non-fatal if it fails.
    try:
        from lib.storage import init_storage
        init_storage()
        logger.info("[storage] initialised")
    except Exception:
        logger.exception("[storage] init failed — uploads will retry on first use")
    # Background sweep: remind assignees of due lead follow-ups every 10 min.
    asyncio.create_task(_followup_sweep_loop())


async def _followup_sweep_loop() -> None:
    while True:
        try:
            await leads.sweep_due_followups()
        except Exception:
            logger.exception("[leads] follow-up sweep failed")
        await asyncio.sleep(600)


@app.on_event("shutdown")
async def shutdown() -> None:
    client.close()

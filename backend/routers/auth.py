"""Authentication endpoints: register / login / me / logout / update settings."""
import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from db import db, gdb, set_current_tenant
from auth_lib import (
    hash_password, verify_password, create_access_token,
    set_auth_cookie, get_current_user, gen_id, now_iso, require_edit,
    check_lockout, record_failed_attempt, clear_failed_attempts,
)
from models import RegisterIn, LoginIn, UserOut, SettingsUpdate, DEFAULT_PERMISSIONS
from seed import seed_user_defaults
from routers.notifications import notify_super_admins
from lib.email_notifier import send_email, password_reset_email_html
from lib.whitelabel import (
    find_tenant_for_email, tenant_public, merged_branding, DEFAULT_APP_NAME,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger("auth")

RESET_TOKEN_TTL_MINUTES = 30


async def _resolve_user_photo_url(user: dict) -> str:
    """Look up the current user's profile photo from the ``clients`` catalogue.

    Priority:
      1. Explicit link — ``users.linked_client_id`` (for role='user' accounts)
      2. Staff self-profile — ``clients.login_user_id`` matches
      3. Legacy fallback — a staff-type ``clients`` row owned by this user

    Returns "" when no photo is on file (never raises).
    """
    photo: str = ""
    try:
        linked_id = user.get("linked_client_id")
        if linked_id:
            row = await db.clients.find_one({"id": linked_id}, {"_id": 0, "photo_url": 1})
            photo = (row or {}).get("photo_url") or ""
        if not photo:
            row = await db.clients.find_one(
                {"login_user_id": user["id"]}, {"_id": 0, "photo_url": 1}
            )
            photo = (row or {}).get("photo_url") or ""
        if not photo:
            row = await db.clients.find_one(
                {"user_id": user["id"], "client_type": "staff"},
                {"_id": 0, "photo_url": 1},
            )
            photo = (row or {}).get("photo_url") or ""
    except Exception:  # noqa: BLE001 — photo is optional, never break auth
        log.exception("[auth] photo_url lookup failed for user=%s", user.get("id"))
        photo = ""
    return photo


@router.post("/register")
async def register(payload: RegisterIn):
    """Public self-registration is disabled in the multi-tenant platform.
    Companies are created by the platform owner; users are added by their
    company's super admin from Team & Permissions."""
    raise HTTPException(
        status_code=403,
        detail="Self sign-up is disabled. Ask your workspace administrator to create your account.",
    )


@router.post("/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower().strip()
    try:
        # Lockout check FIRST so bad actors can't keep guessing during a lock window
        await check_lockout(email)

        # 1) Platform owner (the reseller) — lives in the shared platform DB.
        owner = await gdb.platform_owners.find_one({"email": email})
        if owner and verify_password(payload.password, owner["password_hash"]):
            await clear_failed_attempts(email)
            token = create_access_token(owner["id"], email, tenant_id=None, scope="platform")
            set_auth_cookie(response, token)
            return {
                "id": owner["id"],
                "email": email,
                "name": owner.get("name", "Platform Owner"),
                "role": "platform_owner",
                "scope": "platform",
                "access_token": token,
                "branding": merged_branding(None),
            }

        # 2) Company (tenant) user — scan companies for this email.
        tenant, user = await find_tenant_for_email(email)
        if not user or not verify_password(payload.password, user["password_hash"]):
            await record_failed_attempt(email)
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if tenant.get("status") == "suspended":
            raise HTTPException(
                status_code=403,
                detail="This workspace is currently suspended. Please contact support.",
            )
        if user.get("deleted_at"):
            raise HTTPException(
                status_code=403,
                detail="This account has been removed. Please contact the super admin.",
            )
        status = user.get("approval_status", "approved")
        if status == "pending":
            raise HTTPException(status_code=403, detail="Your account is awaiting super-admin approval.")
        if status == "rejected":
            raise HTTPException(status_code=403, detail="Your access request was rejected. Please contact the super admin.")

        await clear_failed_attempts(email)
        set_current_tenant(tenant["id"])
        token = create_access_token(user["id"], email, tenant_id=tenant["id"], scope="tenant")
        set_auth_cookie(response, token)
        user.pop("password_hash", None)
        user.pop("_id", None)
        user["photo_url"] = await _resolve_user_photo_url(user)
        tp = tenant_public(tenant)
        return {
            **user,
            "tenant_id": tenant["id"],
            "tenant_name": tenant["name"],
            "scope": "tenant",
            "branding": tp["branding"],
            "enabled_modules": tp["enabled_modules"],
            "access_token": token,
        }
    except HTTPException:
        raise
    except Exception as exc:  # log opaque crashes so prod ops can debug
        log.exception("[auth/login] unexpected error for email=%r", email)
        raise HTTPException(
            status_code=500,
            detail=f"Login failed: {type(exc).__name__}: {exc}",
        )


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    if user.get("scope") == "platform":
        return {
            "id": user["id"],
            "email": user["email"],
            "name": user.get("name", "Platform Owner"),
            "role": "platform_owner",
            "scope": "platform",
            "branding": merged_branding(None),
        }
    user["photo_url"] = await _resolve_user_photo_url(user)
    extras = {"scope": "tenant"}
    tenant = await gdb.tenants.find_one({"id": user.get("tenant_id")})
    if tenant:
        tp = tenant_public(tenant)
        extras.update({
            "branding": tp["branding"],
            "enabled_modules": tp["enabled_modules"],
            "tenant_name": tenant.get("name"),
            "tenant_status": tenant.get("status", "active"),
        })
    return {**user, **extras}


@router.patch("/me", response_model=UserOut)
async def update_settings(payload: SettingsUpdate, user: dict = Depends(require_edit("settings"))):
    update = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if update:
        await db.users.update_one({"id": user["id"]}, {"$set": update})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    fresh["photo_url"] = await _resolve_user_photo_url(fresh)
    return fresh


# ---------- Self-service password reset ----------
class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=10)
    new_password: str = Field(min_length=8, max_length=128)


_GENERIC_FORGOT_MSG = (
    "If an account exists for that email, a password reset link is on its way."
)
_INVALID_TOKEN_MSG = (
    "This reset link is invalid or has expired. Please request a new one."
)


def _token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _reset_base_url(request: Request) -> str:
    """Resolve the frontend base URL for the reset link. Prefer the request's
    Origin header (the user is on the login page when they ask), then Referer,
    then an explicit APP_BASE_URL env var as a last resort."""
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")
    referer = request.headers.get("referer")
    if referer:
        # Strip path → scheme://host[:port]
        from urllib.parse import urlparse
        p = urlparse(referer)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}"
    env_base = os.environ.get("APP_BASE_URL")
    if env_base:
        return env_base.rstrip("/")
    return ""


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordIn, request: Request):
    """Generate a one-time, time-limited reset token and email a reset link.
    Always returns a generic success message so attackers can't enumerate
    which emails have accounts."""
    email = payload.email.lower().strip()
    tenant, user = await find_tenant_for_email(email)
    if not user or not tenant:
        return {"ok": True, "message": _GENERIC_FORGOT_MSG}

    raw_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)
    # Invalidate any earlier unused tokens for this user (one live link at a time)
    await gdb.password_reset_tokens.delete_many({"user_id": user["id"], "used": False})
    await gdb.password_reset_tokens.insert_one({
        "token_hash": _token_hash(raw_token),
        "user_id": user["id"],
        "tenant_id": tenant["id"],
        "email": email,
        "created_at": now.isoformat(),
        "expires_at_iso": expires_at.isoformat(),
        "expires_at": expires_at,  # BSON date — drives the TTL index cleanup
        "used": False,
    })

    base = _reset_base_url(request)
    reset_link = f"{base}/reset-password?token={raw_token}"
    try:
        resp = await send_email(
            to=email,
            subject=f"Reset your {DEFAULT_APP_NAME} password",
            html=password_reset_email_html(
                user.get("name"), reset_link, RESET_TOKEN_TTL_MINUTES
            ),
        )
        if resp.get("skipped"):
            log.warning("[auth/forgot-password] email skipped (no RESEND_API_KEY) for %s", email)
    except Exception:  # best-effort — never leak send failures to the client
        log.exception("[auth/forgot-password] failed to send reset email to %s", email)

    return {"ok": True, "message": _GENERIC_FORGOT_MSG}


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordIn):
    """Validate a reset token (unexpired + unused), set the new password,
    burn the token, and clear any active brute-force lockout."""
    rec = await gdb.password_reset_tokens.find_one({"token_hash": _token_hash(payload.token)})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail=_INVALID_TOKEN_MSG)
    try:
        exp = datetime.fromisoformat(rec.get("expires_at_iso", ""))
    except (TypeError, ValueError):
        exp = None
    if not exp or exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail=_INVALID_TOKEN_MSG)

    set_current_tenant(rec.get("tenant_id"))
    user = await db.users.find_one({"id": rec["user_id"]})
    if not user:
        raise HTTPException(status_code=400, detail=_INVALID_TOKEN_MSG)

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(payload.new_password), "password_reset_at": now_iso()}},
    )
    await gdb.password_reset_tokens.update_one(
        {"_id": rec["_id"]}, {"$set": {"used": True, "used_at": now_iso()}}
    )
    # Clear lockout so the user can sign in immediately after resetting.
    await gdb.login_attempts.delete_one({"email": user.get("email")})
    return {"ok": True, "message": "Your password has been reset. You can now sign in."}

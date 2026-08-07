"""Shared test configuration & fixtures for FinFlow integration tests.

Centralises the credential resolution so individual test modules don't hardcode
admin/office passwords. Override via environment variables:

  TEST_BACKEND_URL    — base URL (defaults to REACT_APP_BACKEND_URL from .env)
  TEST_ADMIN_EMAIL    — super-admin email
  TEST_ADMIN_PASSWORD — super-admin password
  TEST_OFFICE_EMAIL   — office-admin email
  TEST_OFFICE_PASSWORD — office-admin password

Test credentials.md is the canonical source of dev creds; CI should inject
secrets via environment.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Tuple


def generate_test_password(prefix: str = "TestPwd") -> str:
    """Return a strong, random per-call password used for throwaway users
    created inside tests. Avoids static strings appearing in source code that
    code-scanning tools flag as hardcoded secrets."""
    # 16 url-safe chars (~96 bits) + a stable prefix that satisfies the
    # backend's min-length validators and includes an upper / lower / digit.
    return f"{prefix}#{secrets.token_urlsafe(12)}"


def _read_frontend_env_var(key: str) -> str | None:
    env_file = Path("/app/frontend/.env")
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return None


def backend_url() -> str:
    return (
        os.getenv("TEST_BACKEND_URL")
        or _read_frontend_env_var("REACT_APP_BACKEND_URL")
        or "http://localhost:8001"
    )


def api_base() -> str:
    return f"{backend_url().rstrip('/')}/api"


def _read_backend_env_var(key: str) -> str | None:
    env_file = Path("/app/backend/.env")
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            val = line.split("=", 1)[1].strip()
            return val.strip('"').strip("'")
    return None


def admin_credentials() -> Tuple[str, str]:
    """(email, password) for the seeded super-admin.
    Falls back to the ADMIN_EMAIL/ADMIN_PASSWORD values in backend/.env so
    rotating the seeded credentials doesn't break test runs."""
    return (
        os.getenv("TEST_ADMIN_EMAIL")
        or _read_backend_env_var("ADMIN_EMAIL")
        or "admin@kmfoundation.online",
        os.getenv("TEST_ADMIN_PASSWORD")
        or _read_backend_env_var("ADMIN_PASSWORD")
        or "Admin@786",
    )


def office_credentials(office: str = "blr1") -> Tuple[str, str]:
    """(email, password) for a seeded office-admin account."""
    return (
        os.getenv("TEST_OFFICE_EMAIL", f"{office}@finflow.com"),
        os.getenv("TEST_OFFICE_PASSWORD", "Office@123"),
    )

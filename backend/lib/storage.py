"""Emergent object-storage helper (init-once, reusable storage key)."""
import logging
import os

import requests

log = logging.getLogger("storage")

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "finflow"

_storage_key: str | None = None


def init_storage() -> str | None:
    """Initialise (once) and return a session-scoped storage key."""
    global _storage_key
    if _storage_key:
        return _storage_key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")
    if not emergent_key:
        log.warning("[storage] EMERGENT_LLM_KEY not set — uploads disabled")
        return None
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": emergent_key}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _key_or_reinit() -> str:
    global _storage_key
    key = _storage_key or init_storage()
    if not key:
        raise RuntimeError("Object storage is not configured (EMERGENT_LLM_KEY missing)")
    return key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = _key_or_reinit()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if resp.status_code == 403:  # key expired → refresh once
        global _storage_key
        _storage_key = None
        key = _key_or_reinit()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = _key_or_reinit()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60,
    )
    if resp.status_code == 403:
        global _storage_key
        _storage_key = None
        key = _key_or_reinit()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key}, timeout=60,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

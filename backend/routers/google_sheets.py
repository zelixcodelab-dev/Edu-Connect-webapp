"""Google Sheets + Drive lead-import integration.

Server-side OAuth 2.0 Authorization Code flow. The browser NEVER receives a
Google access/refresh token — FastAPI exchanges the code and stores the
credentials (encrypted with Fernet) against the already-authenticated app user
in ``db.google_connections``.

Two routers are exposed:
  * ``router``       (prefix ``/api/google``)         — app data endpoints, JWT-guarded.
  * ``oauth_router`` (prefix ``/api/oauth/sheets``)   — the OAuth callback Google
    redirects the browser to (no JWT; identified by the one-time ``state``).
"""
from __future__ import annotations

import logging
import os
import re
import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from db import db
from auth_lib import get_current_user, gen_id, now_iso
from lib.activity_log import log_event

log = logging.getLogger("server")

router = APIRouter(prefix="/api/google", tags=["google-sheets"])
oauth_router = APIRouter(prefix="/api/oauth/sheets", tags=["google-oauth"])

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "").rstrip("/")
ENC_KEY = os.environ.get("GOOGLE_TOKEN_ENCRYPTION_KEY", "")

# Google returns scopes in a different shape than requested (e.g. "email" vs the
# full userinfo.email URL), which makes oauthlib raise "Scope has changed".
# Relaxing this lets the token exchange succeed for our confidential web client.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

LEAD_SOURCES = ("walk_in", "referral", "social", "website", "csv", "google_sheets", "other")

FIELDS = ("name", "phone", "email", "course", "place", "source", "notes")

_fernet = None
if ENC_KEY:
    from cryptography.fernet import Fernet
    _fernet = Fernet(ENC_KEY.encode())


def _configured() -> bool:
    return bool(CLIENT_ID and CLIENT_SECRET and REDIRECT_URI and _fernet)


def _guard_configured() -> None:
    if not _configured():
        raise HTTPException(503, "Google Sheets is not configured on the server.")


def _require_admin(user: dict) -> None:
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Only admins can manage the Google Sheets connection")


def _enc(value: Optional[str]) -> Optional[str]:
    return _fernet.encrypt(value.encode()).decode() if value else None


def _dec(value: Optional[str]) -> Optional[str]:
    return _fernet.decrypt(value.encode()).decode() if value else None


def _client_config() -> dict:
    return {"web": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [REDIRECT_URI],
    }}


def _origin_from_request(request) -> str:
    """Unused for redirect derivation — proxies rewrite Origin to internal hosts.
    The browser-supplied ``origin`` query param is used instead (reliable)."""
    o = (request.headers.get("origin") or request.headers.get("referer") or "").strip()
    if o:
        parts = o.split("/", 3)
        o = "/".join(parts[:3])
    return o


_ORIGIN_RE = re.compile(r"^https://[a-zA-Z0-9.-]+(:\d+)?$")


def _redirect_uri_for(origin: Optional[str]) -> str:
    """Build the callback URL from the BROWSER's origin (window.location.origin,
    passed by the frontend) so the flow works on preview AND production
    (kmconnect.co.in) without redeploying. Proxy header rewriting makes the
    server-side Origin header unreliable, so we trust the explicit param — and
    Google still enforces that the result is a registered redirect URI.
    Falls back to the env default when the param is missing/malformed."""
    if origin and _ORIGIN_RE.match(origin.strip()):
        return f"{origin.strip().rstrip('/')}/api/oauth/sheets/callback"
    return REDIRECT_URI


def _new_flow(redirect_uri: Optional[str] = None):
    from google_auth_oauthlib.flow import Flow
    flow = Flow.from_client_config(_client_config(), scopes=SCOPES)
    flow.redirect_uri = redirect_uri or REDIRECT_URI
    return flow


async def _save_credentials(uid: str, creds, email: Optional[str] = None) -> None:
    old = await db.google_connections.find_one({"user_id": uid, "provider": "google_sheets"})
    # Google omits refresh_token on subsequent exchanges — preserve the old one.
    refresh = creds.refresh_token or (_dec(old.get("refresh_token")) if old else None)
    doc = {
        "user_id": uid,
        "provider": "google_sheets",
        "google_email": email or (old.get("google_email") if old else None),
        "access_token": _enc(creds.token),
        "refresh_token": _enc(refresh),
        "expiry": creds.expiry,
        "scopes": list(creds.scopes or SCOPES),
        "updated_at": datetime.now(timezone.utc),
        "refresh_error": None,
    }
    await db.google_connections.update_one(
        {"user_id": uid, "provider": "google_sheets"}, {"$set": doc}, upsert=True
    )


async def _credentials_for(uid: str):
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    row = await db.google_connections.find_one({"user_id": uid, "provider": "google_sheets"})
    if not row or not row.get("refresh_token"):
        raise HTTPException(404, "Google account is not connected")
    creds = Credentials(
        token=_dec(row.get("access_token")),
        refresh_token=_dec(row["refresh_token"]),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        scopes=row.get("scopes") or SCOPES,
        expiry=row.get("expiry"),
    )
    if not creds.valid:
        if not creds.refresh_token:
            raise HTTPException(401, "Google connection expired — please reconnect")
        try:
            creds.refresh(Request())
            await _save_credentials(uid, creds, row.get("google_email"))
        except Exception as exc:  # noqa: BLE001
            log.warning("[google] token refresh failed for user=%s: %s", uid, exc)
            await db.google_connections.update_one(
                {"user_id": uid, "provider": "google_sheets"},
                {"$set": {"refresh_error": str(exc)[:200], "updated_at": datetime.now(timezone.utc)}},
            )
            raise HTTPException(401, "Google authorization must be renewed — please reconnect")
    return creds


def _services(creds):
    from googleapiclient.discovery import build
    return (
        build("drive", "v3", credentials=creds, cache_discovery=False),
        build("sheets", "v4", credentials=creds, cache_discovery=False),
    )


def _google_error(exc):
    from googleapiclient.errors import HttpError
    if isinstance(exc, HttpError):
        status = getattr(exc.resp, "status", 502)
        try:
            status = int(status)
        except (TypeError, ValueError):
            status = 502
        raise HTTPException(status if status in (400, 401, 403, 404) else 502,
                            "Google API request failed. Check sheet access and try again.")
    log.exception("[google] unexpected API error")
    raise HTTPException(502, "Google request failed")


# ------------------------------------------------------------------ status / connect
@router.get("/status")
async def google_status(user: dict = Depends(get_current_user)):
    if not _configured():
        return {"configured": False, "connected": False}
    row = await db.google_connections.find_one(
        {"user_id": user["id"], "provider": "google_sheets"},
        {"_id": 0, "google_email": 1, "updated_at": 1, "refresh_error": 1},
    )
    return {
        "configured": True,
        "connected": bool(row),
        "google_email": (row or {}).get("google_email"),
        "connected_at": (row or {}).get("updated_at"),
        "needs_reconnect": bool((row or {}).get("refresh_error")),
    }


_indexes_ready = False


async def _ensure_indexes() -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    try:
        # Abandoned OAuth flows self-expire after 10 min (row never reaches the callback).
        await db.oauth_states.create_index("created_at", expireAfterSeconds=600)
        await db.sheet_sync_rows.create_index([("sync_id", 1), ("row_hash", 1)], unique=True)
        await db.sheet_syncs.create_index([("office", 1), ("campaign_id", 1)])
        await db.sheet_sync_runs.create_index([("sync_id", 1), ("ran_at", -1)])
    except Exception:  # noqa: BLE001 — index may already exist / race
        pass
    _indexes_ready = True


@router.get("/connect")
async def google_connect(request: Request, origin: Optional[str] = None,
                        user: dict = Depends(get_current_user)):
    _guard_configured()
    _require_admin(user)
    await _ensure_indexes()
    state = secrets.token_urlsafe(32)
    redirect_uri = _redirect_uri_for(origin)
    flow = _new_flow(redirect_uri)
    url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
        state=state,
    )
    # Persist the PKCE code_verifier + the exact redirect_uri used — the callback
    # rebuilds a fresh Flow and must present BOTH unchanged at token exchange,
    # else Google returns "invalid_grant" (missing verifier / redirect mismatch).
    await db.oauth_states.insert_one({
        "state": state,
        "user_id": user["id"],
        "provider": "google_sheets",
        "code_verifier": getattr(flow, "code_verifier", None),
        "redirect_uri": redirect_uri,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc).timestamp() + 600,
    })
    return {"authorization_url": url}


@router.delete("/disconnect")
async def google_disconnect(user: dict = Depends(get_current_user)):
    _require_admin(user)
    row = await db.google_connections.find_one({"user_id": user["id"], "provider": "google_sheets"})
    if row:
        token = _dec(row.get("refresh_token")) if _fernet else None
        if token:
            try:
                import httpx
                async with httpx.AsyncClient(timeout=10) as client:
                    await client.post("https://oauth2.googleapis.com/revoke", data={"token": token})
            except Exception:  # noqa: BLE001 — best-effort revoke
                pass
        await db.google_connections.delete_one({"_id": row["_id"]})
    return {"disconnected": True}


@oauth_router.get("/callback")
async def google_callback(code: Optional[str] = None, state: Optional[str] = None,
                          error: Optional[str] = None):
    row = await db.oauth_states.find_one_and_delete({"state": state, "provider": "google_sheets"}) if state else None
    redirect_uri = (row or {}).get("redirect_uri") or REDIRECT_URI
    # Always return the user to the FRONTEND app, which may live on a different
    # domain than this backend (e.g. kmconnect.co.in ↔ *.up.railway.app).
    dest = f"{FRONTEND_URL.rstrip('/')}/settings" if FRONTEND_URL else f"{redirect_uri.split('/api/', 1)[0]}/settings"
    if error or not code or not state:
        return RedirectResponse(f"{dest}?google=error")
    if not row or row["expires_at"] < datetime.now(timezone.utc).timestamp():
        return RedirectResponse(f"{dest}?google=error")
    if not _configured():
        return RedirectResponse(f"{dest}?google=error")
    try:
        flow = _new_flow(redirect_uri)
        flow.code_verifier = row.get("code_verifier")
        flow.fetch_token(code=code)
        creds = flow.credentials
        email = None
        try:
            from googleapiclient.discovery import build
            oauth2 = build("oauth2", "v2", credentials=creds, cache_discovery=False)
            email = oauth2.userinfo().get().execute().get("email")
        except Exception:  # noqa: BLE001
            email = None
        await _save_credentials(row["user_id"], creds, email)
    except Exception as exc:  # noqa: BLE001
        log.warning("[google] callback token exchange failed: %s", exc)
        return RedirectResponse(f"{dest}?google=error")
    return RedirectResponse(f"{dest}?google=connected")


# ------------------------------------------------------------------ spreadsheets
@router.get("/spreadsheets")
async def list_spreadsheets(user: dict = Depends(get_current_user)):
    _require_admin(user)
    creds = await _credentials_for(user["id"])
    drive, _ = _services(creds)
    try:
        files, token = [], None
        while True:
            resp = drive.files().list(
                q="mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
                spaces="drive", pageSize=200, pageToken=token, orderBy="modifiedTime desc",
                fields="nextPageToken,files(id,name,modifiedTime)",
            ).execute()
            files += resp.get("files", [])
            token = resp.get("nextPageToken")
            if not token or len(files) >= 500:
                break
        return {"files": files}
    except Exception as exc:  # noqa: BLE001
        _google_error(exc)


@router.get("/spreadsheets/{spreadsheet_id}/worksheets")
async def list_worksheets(spreadsheet_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    creds = await _credentials_for(user["id"])
    _, sheets = _services(creds)
    try:
        data = sheets.spreadsheets().get(
            spreadsheetId=spreadsheet_id, includeGridData=False,
            fields="spreadsheetId,properties.title,sheets(properties(sheetId,title,index))",
        ).execute()
        return {
            "spreadsheet_id": data["spreadsheetId"],
            "title": data["properties"]["title"],
            "worksheets": [s["properties"] for s in data.get("sheets", [])],
        }
    except Exception as exc:  # noqa: BLE001
        _google_error(exc)


@router.get("/spreadsheets/{spreadsheet_id}/values")
async def read_values(spreadsheet_id: str, sheet: str = Query(...),
                      user: dict = Depends(get_current_user)):
    _require_admin(user)
    creds = await _credentials_for(user["id"])
    _, sheets = _services(creds)
    try:
        safe = sheet.replace("'", "''")
        range_a1 = f"'{safe}'!A:Z"
        result = sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=range_a1,
            majorDimension="ROWS", valueRenderOption="UNFORMATTED_VALUE",
        ).execute()
        return {"range": result.get("range"), "values": result.get("values", [])}
    except Exception as exc:  # noqa: BLE001
        _google_error(exc)


class TemplateIn(BaseModel):
    title: str = Field(default="KM Connect — Leads Import", min_length=1, max_length=200)


@router.post("/template")
async def create_template(body: TemplateIn, user: dict = Depends(get_current_user)):
    _require_admin(user)
    creds = await _credentials_for(user["id"])
    _, sheets = _services(creds)
    headers = [["name", "phone", "email", "course", "place", "source", "notes"]]
    try:
        created = sheets.spreadsheets().create(
            body={"properties": {"title": body.title},
                  "sheets": [{"properties": {"title": "Leads"}}]},
            fields="spreadsheetId,spreadsheetUrl,properties.title",
        ).execute()
        sid = created["spreadsheetId"]
        sheets.spreadsheets().values().update(
            spreadsheetId=sid, range="Leads!A1:G1", valueInputOption="RAW",
            body={"values": headers},
        ).execute()
        return {"spreadsheet_id": sid, "url": created.get("spreadsheetUrl"), "headers": headers[0]}
    except Exception as exc:  # noqa: BLE001
        _google_error(exc)


# ------------------------------------------------------------------ import
class ImportRow(BaseModel):
    name: str = ""
    phone: str = ""
    email: str = ""
    course: str = ""
    place: str = ""
    source: str = ""
    notes: str = ""


class ImportIn(BaseModel):
    campaign_id: str
    rows: List[ImportRow]


def _phone_key(raw: str) -> str:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


def _name_place_key(name: str, place: str) -> str:
    n = " ".join((name or "").lower().split())
    p = " ".join((place or "").lower().split())
    return f"{n}|{p}" if n else ""


def _row_hash(row: dict) -> str:
    """Stable fingerprint of a row's content — used to detect brand-new rows."""
    import hashlib
    key = "|".join((str(row.get(f, "")) or "").strip().lower() for f in FIELDS)
    return hashlib.sha256(key.encode()).hexdigest()


def _parse_values(values: list) -> list[dict]:
    """Map a raw Sheets value grid → list of lead-row dicts using the header row.

    Raises 400 when there is no recognisable ``name`` column."""
    if len(values) < 2:
        return []
    headers = [str(h or "").strip().lower() for h in values[0]]
    pos = {f: headers.index(f) for f in FIELDS if f in headers}
    if "name" not in pos:
        raise HTTPException(400, "No 'name' column found in the header row")
    out: list[dict] = []
    for raw in values[1:]:
        row = {f: (str(raw[pos[f]]).strip() if f in pos and pos[f] < len(raw) and raw[pos[f]] is not None else "")
               for f in FIELDS}
        if any(row.values()):
            out.append(row)
    return out


async def _dedup_and_insert(rows: list[dict], *, campaign_id: str, office: str,
                            role: str, user_office: Optional[str], actor: dict) -> dict:
    """Shared dedup + insert used by both manual import and auto-sync.

    ``rows`` are plain dicts with FIELDS keys. Dedups by phone (name+place
    fallback) against the caller's lead scope and within the batch. Returns a
    summary dict + the list of created lead ids."""
    dedup_scope = {"campaign_id": campaign_id}
    existing = await db.leads.find(
        dedup_scope, {"_id": 0, "phone": 1, "name": 1, "place": 1}
    ).to_list(200_000)
    existing_phone: set[str] = set()
    existing_name: set[str] = set()
    for d in existing:
        pk = _phone_key(d.get("phone", ""))
        if pk:
            existing_phone.add(pk)
        else:
            nk = _name_place_key(d.get("name", ""), d.get("place", ""))
            if nk:
                existing_name.add(nk)

    created: list[dict] = []
    duplicates: list[dict] = []
    invalids: list[dict] = []
    seen_phone: set[str] = set()
    seen_name: set[str] = set()
    now = now_iso()
    for i, row in enumerate(rows):
        name = (row.get("name") or "").strip()
        if not name:
            invalids.append({"row": i + 1, "reason": "missing name"})
            continue
        phone = (row.get("phone") or "").strip()
        place = (row.get("place") or "").strip()
        pk = _phone_key(phone)
        nk = _name_place_key(name, place) if not pk else ""
        reason: Optional[str] = None
        if pk:
            if pk in existing_phone:
                reason = "phone already in CRM"
            elif pk in seen_phone:
                reason = "phone repeated in import"
        elif nk:
            if nk in existing_name:
                reason = "name already in CRM"
            elif nk in seen_name:
                reason = "name repeated in import"
        if reason:
            duplicates.append({"row": i + 1, "name": name, "phone": phone, "reason": reason})
            continue
        if pk:
            seen_phone.add(pk)
        elif nk:
            seen_name.add(nk)
        src = (row.get("source") or "").strip().lower()
        created.append({
            "id": gen_id(),
            "name": name,
            "phone": phone,
            "email": (row.get("email") or "").strip(),
            "course": (row.get("course") or "").strip(),
            "place": place,
            "source": src if src in LEAD_SOURCES else "google_sheets",
            "status": "new",
            "assigned_to_user_id": None,
            "office": office,
            "campaign_id": campaign_id,
            "next_follow_up": None,
            "notes": (row.get("notes") or "").strip(),
            "follow_ups": [],
            "created_by_user_id": actor["id"],
            "created_at": now,
            "updated_at": now,
        })

    if created:
        await db.leads.insert_many([dict(d) for d in created])
        await log_event(
            event_type="lead.sheets_import", actor=actor,
            subject_type="lead", subject_label=f"{len(created)} leads",
            after={"count": len(created), "campaign_id": campaign_id},
            office=office,
            note=f"Imported {len(created)} leads from Google Sheets",
            reversible=True,
            extras={"lead_ids": [c["id"] for c in created], "campaign_id": campaign_id},
        )
    return {
        "created_count": len(created),
        "duplicate_count": len(duplicates),
        "invalid_count": len(invalids),
        "duplicates": duplicates[:200],
        "invalids": invalids[:200],
        "created_ids": [c["id"] for c in created],
    }


async def _campaign_in_scope(campaign_id: str, role: str, user_office: Optional[str]) -> dict:
    cscope = {} if role == "super_admin" else {"office": user_office}
    campaign = await db.campaigns.find_one(
        {**cscope, "id": campaign_id}, {"_id": 0, "id": 1, "name": 1, "office": 1}
    )
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    return campaign


@router.post("/import", status_code=201)
async def import_leads(body: ImportIn, user: dict = Depends(get_current_user)):
    """Import validated rows (from a Google Sheet) into a campaign."""
    _require_admin(user)
    role = user.get("role")
    campaign = await _campaign_in_scope(body.campaign_id, role, user.get("office"))
    summary = await _dedup_and_insert(
        [r.model_dump() for r in body.rows],
        campaign_id=body.campaign_id, office=campaign["office"],
        role=role, user_office=user.get("office"), actor=user,
    )
    summary.pop("created_ids", None)
    return summary


# ------------------------------------------------------------------ auto-sync
SYNC_INTERVAL_HOURS = 6


class SyncCreateIn(BaseModel):
    campaign_id: str
    spreadsheet_id: str
    spreadsheet_name: str = ""
    worksheet: str
    interval_hours: int = Field(default=SYNC_INTERVAL_HOURS, ge=1, le=168)


def _sync_scope(user: dict) -> dict:
    return {} if user.get("role") == "super_admin" else {"office": user.get("office")}


def _sync_public(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "campaign_id": doc["campaign_id"],
        "campaign_name": doc.get("campaign_name"),
        "spreadsheet_id": doc["spreadsheet_id"],
        "spreadsheet_name": doc.get("spreadsheet_name"),
        "worksheet": doc["worksheet"],
        "enabled": doc.get("enabled", True),
        "interval_hours": doc.get("interval_hours", SYNC_INTERVAL_HOURS),
        "google_email": doc.get("google_email"),
        "last_synced_at": doc.get("last_synced_at"),
        "last_status": doc.get("last_status"),
        "last_run_summary": doc.get("last_run_summary"),
        "paused_reason": doc.get("paused_reason"),
        "created_at": doc.get("created_at"),
    }


async def _run_sync(sync: dict, trigger: str) -> dict:
    """Read the linked worksheet, import only rows not seen before, record a run."""
    sid = sync["id"]
    uid = sync["user_id"]
    now = datetime.now(timezone.utc)
    try:
        creds = await _credentials_for(uid)
    except HTTPException as exc:
        await db.sheet_syncs.update_one(
            {"id": sid},
            {"$set": {"enabled": False, "paused_reason": str(exc.detail),
                      "last_status": "error", "updated_at": now}},
        )
        await _record_run(sync, trigger, error=str(exc.detail))
        return {"error": str(exc.detail)}
    try:
        _, sheets = _services(creds)
        safe = sync["worksheet"].replace("'", "''")
        result = sheets.spreadsheets().values().get(
            spreadsheetId=sync["spreadsheet_id"], range=f"'{safe}'!A:Z",
            majorDimension="ROWS", valueRenderOption="UNFORMATTED_VALUE",
        ).execute()
        rows = _parse_values(result.get("values", []))
    except HTTPException as exc:
        await db.sheet_syncs.update_one(
            {"id": sid}, {"$set": {"last_status": "error", "paused_reason": str(exc.detail), "updated_at": now}})
        await _record_run(sync, trigger, error=str(exc.detail))
        return {"error": str(exc.detail)}
    except Exception as exc:  # noqa: BLE001
        log.exception("[google-sync] read failed for sync=%s", sid)
        await db.sheet_syncs.update_one(
            {"id": sid}, {"$set": {"last_status": "error", "updated_at": now}})
        await _record_run(sync, trigger, error="Could not read the sheet")
        return {"error": str(exc)}

    hashed = [(_row_hash(r), r) for r in rows]
    all_hashes = [h for h, _ in hashed]
    seen_docs = await db.sheet_sync_rows.find(
        {"sync_id": sid, "row_hash": {"$in": all_hashes}}, {"_id": 0, "row_hash": 1}
    ).to_list(200_000)
    seen = {d["row_hash"] for d in seen_docs}
    new_pairs = [(h, r) for h, r in hashed if h not in seen]

    summary = await _dedup_and_insert(
        [r for _, r in new_pairs],
        campaign_id=sync["campaign_id"], office=sync["office"],
        role="super_admin" if sync.get("scope_all") else "office_admin",
        user_office=sync.get("office"),
        actor={"id": sync["user_id"], "name": sync.get("user_name", "Auto-sync"),
               "role": "office_admin", "office": sync.get("office")},
    )
    if new_pairs:
        try:
            await db.sheet_sync_rows.insert_many(
                [{"sync_id": sid, "row_hash": h, "seen_at": now} for h, _ in new_pairs],
                ordered=False,
            )
        except Exception:  # noqa: BLE001 — dup key races are fine
            pass
    run_summary = {
        "new_rows": len(new_pairs),
        "created_count": summary["created_count"],
        "duplicate_count": summary["duplicate_count"],
        "invalid_count": summary["invalid_count"],
    }
    await db.sheet_syncs.update_one(
        {"id": sid},
        {"$set": {"last_synced_at": now, "last_status": "ok",
                  "last_run_summary": run_summary, "paused_reason": None, "updated_at": now}},
    )
    await _record_run(sync, trigger, summary=run_summary)
    return run_summary


async def _record_run(sync: dict, trigger: str, *, summary: dict | None = None, error: str | None = None) -> None:
    await db.sheet_sync_runs.insert_one({
        "id": gen_id(),
        "sync_id": sync["id"],
        "campaign_id": sync["campaign_id"],
        "office": sync.get("office"),
        "trigger": trigger,
        "ran_at": datetime.now(timezone.utc),
        "summary": summary,
        "error": error,
    })


@router.post("/sync", status_code=201)
async def create_sync(body: SyncCreateIn, user: dict = Depends(get_current_user)):
    """Enable auto-sync for a spreadsheet↔campaign pair, then baseline current rows
    as already-seen so future runs only pick up NEW rows."""
    _require_admin(user)
    _guard_configured()
    role = user.get("role")
    campaign = await _campaign_in_scope(body.campaign_id, role, user.get("office"))
    conn = await db.google_connections.find_one(
        {"user_id": user["id"], "provider": "google_sheets"}, {"_id": 0, "google_email": 1})
    if not conn:
        raise HTTPException(404, "Google account is not connected")
    await _ensure_indexes()

    existing = await db.sheet_syncs.find_one({
        "campaign_id": body.campaign_id, "spreadsheet_id": body.spreadsheet_id,
        "worksheet": body.worksheet,
    })
    now = datetime.now(timezone.utc)
    sync_id = existing["id"] if existing else gen_id()
    doc = {
        "id": sync_id,
        "user_id": user["id"],
        "user_name": user.get("name"),
        "google_email": conn.get("google_email"),
        "campaign_id": body.campaign_id,
        "campaign_name": campaign.get("name"),
        "office": campaign["office"],
        "scope_all": role == "super_admin",
        "spreadsheet_id": body.spreadsheet_id,
        "spreadsheet_name": body.spreadsheet_name or body.spreadsheet_id,
        "worksheet": body.worksheet,
        "interval_hours": body.interval_hours,
        "enabled": True,
        "paused_reason": None,
        "last_synced_at": now,
        "last_status": "baselined",
        "updated_at": now,
    }
    if not existing:
        doc["created_at"] = now
    await db.sheet_syncs.update_one({"id": sync_id}, {"$set": doc}, upsert=True)

    # Baseline: mark all current rows as seen so we don't re-import them.
    try:
        creds = await _credentials_for(user["id"])
        _, sheets = _services(creds)
        safe = body.worksheet.replace("'", "''")
        result = sheets.spreadsheets().values().get(
            spreadsheetId=body.spreadsheet_id, range=f"'{safe}'!A:Z",
            majorDimension="ROWS", valueRenderOption="UNFORMATTED_VALUE",
        ).execute()
        rows = _parse_values(result.get("values", []))
        if rows:
            try:
                await db.sheet_sync_rows.insert_many(
                    [{"sync_id": sync_id, "row_hash": _row_hash(r), "seen_at": now} for r in rows],
                    ordered=False,
                )
            except Exception:  # noqa: BLE001
                pass
    except HTTPException:
        pass
    return _sync_public({**doc, "created_at": doc.get("created_at", now)})


@router.get("/syncs")
async def list_syncs(campaign_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    _require_admin(user)
    q = _sync_scope(user)
    if campaign_id:
        q["campaign_id"] = campaign_id
    rows = await db.sheet_syncs.find(q).sort("created_at", -1).to_list(200)
    return {"syncs": [_sync_public(r) for r in rows]}


async def _get_sync_scoped(sync_id: str, user: dict) -> dict:
    sync = await db.sheet_syncs.find_one({"id": sync_id, **_sync_scope(user)})
    if not sync:
        raise HTTPException(404, "Sync not found")
    return sync


@router.post("/syncs/{sync_id}/run")
async def run_sync_now(sync_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    sync = await _get_sync_scoped(sync_id, user)
    result = await _run_sync(sync, "manual")
    return result


class SyncPatchIn(BaseModel):
    enabled: bool


@router.patch("/syncs/{sync_id}")
async def toggle_sync(sync_id: str, body: SyncPatchIn, user: dict = Depends(get_current_user)):
    _require_admin(user)
    await _get_sync_scoped(sync_id, user)
    update = {"enabled": body.enabled, "updated_at": datetime.now(timezone.utc)}
    if body.enabled:
        update["paused_reason"] = None
    await db.sheet_syncs.update_one({"id": sync_id}, {"$set": update})
    return {"enabled": body.enabled}


@router.delete("/syncs/{sync_id}")
async def delete_sync(sync_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    await _get_sync_scoped(sync_id, user)
    await db.sheet_syncs.delete_one({"id": sync_id})
    await db.sheet_sync_rows.delete_many({"sync_id": sync_id})
    await db.sheet_sync_runs.delete_many({"sync_id": sync_id})
    return {"deleted": True}


@router.get("/syncs/{sync_id}/runs")
async def sync_history(sync_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    await _get_sync_scoped(sync_id, user)
    rows = await db.sheet_sync_runs.find(
        {"sync_id": sync_id}, {"_id": 0}
    ).sort("ran_at", -1).to_list(50)
    return {"runs": rows}


async def sweep_due_syncs() -> None:
    """Background sweep — run enabled syncs whose interval has elapsed."""
    from datetime import timedelta
    if not _configured():
        return
    now = datetime.now(timezone.utc)
    cursor = db.sheet_syncs.find({"enabled": True})
    async for sync in cursor:
        interval = sync.get("interval_hours", SYNC_INTERVAL_HOURS)
        last = sync.get("last_synced_at")
        due = last is None or (now - last) >= timedelta(hours=interval)
        if not due:
            continue
        try:
            await _run_sync(sync, "auto")
        except Exception:  # noqa: BLE001
            log.exception("[google-sync] auto run failed for sync=%s", sync.get("id"))

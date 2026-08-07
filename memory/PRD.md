# PRD — White-Label Multi-Tenant CRM ("Edu Connect")

## Original Problem Statement
Clone/port a CRM web app to resell to other companies. Remove all original branding
(FinFlow/KM), default to "Edu Connect", and add a Platform Owner super-dashboard to
customise the app per company: access/permissions, logo, app name, enabled modules, etc.

## Core Requirements
- Port uploaded zip codebase into the environment. (DONE)
- Multi-tenant architecture — isolated MongoDB database per company + one shared platform DB. (DONE)
- De-brand all existing references across code, UI, PDFs, assets. (DONE)
- Default branding: "Edu Connect". (DONE)
- Platform Owner super-dashboard to manage companies, branding, modules, access. (DONE)
- Mock/bypass integrations (email, push, S3, WhatsApp) — keys missing. (DONE, MOCKED)

## Architecture
- Backend: FastAPI + Motor (async MongoDB). `/app/backend`
  - `db.py` — multi-tenant router. `gdb` = shared platform DB; `db` = context-scoped proxy to the current tenant DB. `ensure_tenant_indexes()` builds per-tenant indexes (best-effort/hardened).
  - `lib/whitelabel.py` — branding defaults, module catalog, `provision_tenant()`, tenant seeding.
  - `routers/platform.py` — Platform Owner console API (prefix `/api/platform`).
  - `routers/branding.py` — public + tenant branding.
  - `auth_lib.py` — JWT auth, tenant vs platform-owner scope resolution.
  - `seed.py` — seeds platform owner + default tenant on startup.
- Frontend: React (CRA). `/app/frontend`
  - `src/lib/branding.jsx` — React context applying dynamic CSS variables.
  - `src/pages/PlatformConsole.jsx` — super-admin dashboard.
  - `src/App.js` — routes `/platform` (owner) vs `/` (tenant).
- Deployment configs at repo root/backend: `render.yaml`, `vercel.json`, `railway.json`, backend `Dockerfile`.

## Key DB Schema
- `{DB_NAME}_platform.tenants` — company registry (branding, enabled_modules, status).
- `{DB_NAME}_platform.platform_owners` — platform owner accounts.
- `{DB_NAME}_t_{tenant_id}.*` — isolated per-company CRM collections (users, students, leads, invoices, transactions, etc.).

## Key API Endpoints
- `POST /api/auth/login` — handles both platform-owner and tenant logins.
- `GET  /api/platform/tenants` / `POST /api/platform/tenants` — list / provision companies.
- `PATCH /api/platform/tenants/{id}` — update branding/modules/status.
- `POST /api/platform/tenants/{id}/reset-admin` — reset a company admin password.
- `DELETE /api/platform/tenants/{id}` — delete a company.
- `GET  /api/branding/public` (verify exact path in `routers/branding.py`).

## Credentials (see /app/memory/test_credentials.md)
- Platform Owner: `owner@educonnect.app` / `Owner@12345`
- Company Admin (default tenant): `admin@educonnect.app` / `Admin@12345`

## Status Log
- 2026-06: Ported + de-branded codebase; multi-tenant isolation; Platform Console (API+UI);
  dynamic CSS-variable branding; auth session desync fixed; deployment configs created;
  defensive MONGO_URL/DB_NAME startup checks.
- 2026-06: **Hardened tenant provisioning** — `ensure_tenant_indexes` now creates every index
  independently inside try/except with logging, and default-data seeding runs via
  `_seed_tenant_defaults_safe`. A storage-limited/full MongoDB (e.g. Railway free tier
  `OutOfDiskSpace`) can no longer abort provisioning or leave a company un-loginable.
  Verified via API: provision company → new admin login → delete. PASS.

## Backlog / Remaining (P1/P2)
- P1: Wire real integration keys when available — Resend (email), VAPID (web push),
  S3 (file upload), WhatsApp. Currently mocked/bypassed.
- P2: External DB capacity — user's Railway free-tier MongoDB is out of disk space
  (infrastructure limit, not a code issue). User must upgrade/clean up for full functionality.

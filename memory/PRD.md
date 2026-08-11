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

- 2026-06: **CORS hardening for external deploys** — `_ALLOW_ORIGIN_REGEX` in `backend/server.py`
  now auto-allows `*.vercel.app`, `*.up.railway.app`, `*.onrender.com`, `*.netlify.app`
  (custom domains still via `CORS_ORIGINS`). Root-caused a "Can't reach the server" login
  failure on the user's Vercel frontend → Railway backend: CORS preflight from the Vercel
  origin returned 400 with no `Access-Control-Allow-Origin`. Verified: vercel origin → 200
  with echoed origin; evil.com → 400 blocked.

### External deployment notes (Vercel frontend + Railway backend)
- Frontend `REACT_APP_BACKEND_URL` MUST be the backend's **public** Railway domain
  (e.g. `https://<svc>.up.railway.app`), NOT the private `*.railway.internal` hostname
  (browsers can't resolve it). CRA bakes this at BUILD time → redeploy frontend after change.
- Backend must allow the frontend origin: either the new regex (after pushing this code) or
  set `CORS_ORIGINS=https://<frontend-domain>` on Railway and redeploy backend.

- 2026-06: **Atlas 38-byte DB-name fix + tenant self-repair.** MongoDB Atlas rejects database
  names > 38 bytes; the natural `educonnect_t_<32-hex-uuid>` = 45 bytes → `AtlasError 8000`,
  which broke login (tenant scan threw `OperationFailure`). Fixes:
  - `db.tenant_db_name()` keeps the readable full name when ≤ 38 bytes, else falls back to a
    deterministic `<base>_t_<16-hex sha1(uuid)>` (64-bit, stable) that always fits.
  - `lib.whitelabel.ensure_tenant_admin()` + boot-seed repair: if a tenant's registry row exists
    but its admin user was never created (earlier provisioning failed on the long name), the
    admin user + defaults are (re)created on next startup so the company is loginable.
  - Verified on preview: owner + tenant-admin login, new-company provisioning, and deletion all
    work; all generated names ≤ 38 bytes.
  - MIGRATION NOTE: on non-Atlas Mongo where a tenant DB name was 39–64 bytes and already held
    data, the name now shortens → that data is orphaned. Only the *default* tenant is
    auto-repaired. Fresh Atlas deploys are unaffected (no prior tenant data existed).

- 2026-06: **Brand logo integrated.** Added the EDU Connect (by Zelix Code Lab) logo as the
  default brand asset: `frontend/public/brand-logo.png` (login + in-app BrandMark) plus regenerated
  `favicon.png`, `apple-touch-icon.png`, `pwa-icon-192/512`, `pwa-icon-maskable-512`. Set
  `DEFAULT_BRANDING.logo_url = "/brand-logo.png"` in backend `lib/whitelabel.py` and frontend
  `lib/branding.jsx`; simplified `merged_branding` so an empty stored logo falls back to the
  default (companies can still override with their own logo). Verified on preview: login hero +
  logged-in sidebar both render the logo. NOTE: appears on the live site only after Save to
  Github + redeploy of BOTH frontend (public assets) and backend (branding default).

## Platform Console Rebuild — Multi-Module SaaS Control Center (in progress)
Goal: transform the single-page Platform Console into a scalable control center with 6 modules
(Clients, My Apps, Database, VPS Server, Connect, Settings) + Developer dashboard, RBAC, audit,
global search, "Needs Your Attention". Built phase-by-phase. Design blueprint: /app/design_guidelines.json
(premium minimal SaaS, red accent, Fraunces+Manrope, light/dark, app-launcher home).

### Phase 1 — Foundation (DONE, 2026-06, self-tested)
- Backend (`routers/platform.py`): RBAC (roles platform_owner/admin/developer/support/viewer +
  granular ALL_PERMISSIONS + `require_permission` dep, enforced server-side; owner ⇒ all).
  Audit log (`gdb.platform_audit`, `record_audit`, `GET /platform/audit`, wired into client
  create/edit/delete/reset). `GET /platform/attention` (real signals: suspended clients, locked
  logins, empty-state). `GET /platform/search?q=` (grouped results). `/platform/me` now returns permissions.
- Frontend: new module-launcher Home (`pages/PlatformHome.jsx`), ⌘K command palette
  (`components/platform/CommandPalette.jsx`), reusable kit (`components/platform/PlatformKit.jsx`:
  StatusBadge, StatCard, SectionHeader, EmptyState, LoadingState, AttentionCard, Avatar,
  useHasPermission), module inner-layout shell + shared top bar (`PlatformShell.jsx`),
  generic module page (`PlatformModulePage.jsx`), module registry (`lib/platformModules.js`).
  Routes: `/platform` (Home), `/platform/clients/*` (existing company mgmt = Clients module),
  `/platform/:moduleKey` (module shells). CSS motion added to index.css.
- Verified: /me perms(24), /attention, /search, /audit + audit side-effect on create; UI launcher,
  palette, clients module, module shells — no page errors.

### Phase 2 — Clients + Connect (DONE, 2026-06, self-tested E2E)
- Backend: Connect ticketing (`routers/connect.py`, `gdb.tickets`): list+counts, create, get, patch
  (status/priority/assign), add message (client/staff/internal), resolve; SLA target from priority
  (urgent 4h/high 8h/normal 24h/low 72h) with on_track/at_risk/breached state; permission-gated
  (ticket.*) + audited. Platform: `GET /tenants/{id}/users`, `plan` field + Trial count in summary,
  `open_tickets` in summary, urgent-ticket alerts in /attention.
- Frontend: Clients redesign (`PlatformConsole.jsx` → shell + stat cards + data table + row→detail),
  `PlatformClientDetail.jsx` (tabbed: Overview/Users/Applications/Database/Subscription/Activity/
  SupportTickets/Security — real data on Overview/Users/Activity/Tickets), `PlatformConnect.jsx`
  (dashboard + filters + create dialog + table), `PlatformTicketDetail.jsx` (conversation timeline,
  reply + internal notes, status/priority/assign, SLA panel, resolve). Routes added.
- Verified E2E (Playwright, no page errors): clients table → client detail tabs → connect dashboard
  → create/open ticket → staff reply (auto → in_progress). Backend endpoints verified via curl.


- Phase 2: Clients module full redesign (stat cards, data table, tabbed detail) + Connect (real support tickets: dashboard, list, conversation, assignment, SLA).
- Phase 3: My Apps registry (generic app catalog) + Settings (users/roles/permissions, branding, plans).
- Phase 4: Database + VPS Server modules (real data where safe + read-only infra connection when creds provided; danger actions gated by permission + confirmation + audit).
- Later: Developer dashboard + staff user accounts (RBAC already supports the roles).

## Backlog / Remaining (P1/P2)

### Phase 4 — Database + VPS (DONE, 2026-06, self-tested E2E)
- Backend (`routers/registry.py`): Database — real MongoDB stats via the app's own `client` for the
  platform DB + each tenant DB only (never arbitrary DBs, no creds): `GET /database/connections`
  (dbstats: collections, size, status), `GET /database/{name}/collections` (real doc counts),
  `POST /database/{name}/backup` (audited checkpoint marker; real dump needs a backup agent).
  VPS — server registry (`gdb.servers`): CRUD + `POST /servers/{id}/action` (start/stop/restart) —
  permission-gated (server.view/deploy/restart) + confirmation + audit; records intent (no live agent).
- Frontend: `PlatformDatabase.jsx` (stat cards, connections table, collections dialog, backup) and
  `PlatformVps.jsx` (stat cards, agent notice, server table + add dialog + confirmed danger actions).
  Routes added; module launcher now fully wired (all 6 modules live).
- Verified E2E + curl: real DB connections/collections, backup, server create + audited restart. Zero page errors.
- NOTE: live VPS metrics/Docker/terminal + a read-only server/DB connection are pending real credentials from the user.


### Phase 3 — My Apps + Settings (DONE, 2026-06, self-tested E2E)
- Backend (`routers/registry.py`): Apps registry (`gdb.apps`, seeds EduConnect Pro once) — list+counts,
  create/get/patch/delete, active-users from assigned clients; app.* gated + audited. Settings: platform
  singleton get/patch; staff CRUD in `gdb.platform_owners` with `platform_role` (owner protected); roles
  matrix; plans CRUD (seeds Trial/Starter/Pro). Auth now respects stored `platform_role` (scoped staff perms).
- Frontend: `PlatformApps.jsx` + `PlatformSettings.jsx` (General, Users & Access = staff + roles matrix,
  Clients & Plans, Security = audit log). Routes added.
- Verified E2E + curl: apps CRUD, staff create → staff login (role support) → 403 on client.create, plans,
  settings, audit populated. Zero page errors.

- P1: Wire real integration keys when available — Resend (email), VAPID (web push),
  S3 (file upload), WhatsApp. Currently mocked/bypassed.
- P2: External DB capacity — user's Railway free-tier MongoDB is out of disk space
  (infrastructure limit, not a code issue). User must upgrade/clean up for full functionality.

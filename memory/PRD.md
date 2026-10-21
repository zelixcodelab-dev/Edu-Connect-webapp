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

## KMConnect feature-merge (2026-06) — porting new CRM features into the multi-tenant app
Source: user-uploaded `kmconnect-bykm-updated-main.zip` (a NEWER single-tenant KMConnect CRM).
Approach: cherry-pick each NEW feature feature-by-feature (NOT a blind overwrite — the two
codebases diverged: the zip added CRM features; this app added the multi-tenant platform + rebrand
+ Railway/Vercel/CORS infra in the SAME files). NEVER overwrite db.py / auth.py / App.js / AppShell.jsx /
lib/api.js / lib/auth.jsx wholesale.
Features to port (user confirmed all 4, in order): 1) Attendance+Payroll, 2) Academic-Year selector,
3) Google Sheets sync (needs Google OAuth creds), 4) WebAuthn passkey login (needs lib + domain config).

### Feature 1 — Staff Attendance + Payroll (DONE, 2026-06, tested 100% BE+FE)
- Backend: copied `routers/attendance.py` (GPS check-in/out, breaks, monthly payroll, salary,
  regularization, payslip PDF). Uses tenant-aware `db` proxy → works per-company automatically.
  Registered in `server.py`. Prefix `/api/attendance`. Late-alert background sweep intentionally
  DEFERRED (only half-works across tenants without per-tenant context).
- Permissions: added "attendance" to `models.py` PERMISSION_PAGES; STAFF_DEFAULT_PERMISSIONS
  attendance="edit", USER="none". Upgraded `auth_lib.require_edit()` to consult role-default maps
  (so staff can check in by default). Added "attendance" to `whitelabel.MODULE_CATALOG` + a startup
  backfill in server.py that $addToSet's "attendance" into existing tenants' enabled_modules.
- Frontend: copied `pages/Attendance.jsx`, `components/attendance/*`, `components/AuthedImage.jsx`,
  `lib/payslipPdf.js`. Wired route in App.js (/attendance, roles super/office/staff, page=attendance),
  nav in AppShell (GROUP_ROUTES.office += /attendance; ALL_NAV nav-attendance) + BottomNav (staff bar).
- Test: /app/backend/tests/test_attendance.py (9 pass). Staff test acct: TEST_att_staff_1@educonnect.app / Staff@12345.

### Feature 2 — Academic-Year selector (DONE, 2026-06, verified BE curl + FE render)
- Backend: added `lib/academic_year.py` (calendar-year = academic year; helpers date_filter/with_year/
  in_year/available_years) + `routers/academic.py` (GET /api/academic-years → {years, current}).
  Registered in server.py. Threaded `year: Optional[int]` into list/aggregation endpoints (ignore-safe):
  transactions (date), students (created_at), leads (created_at), invoices (issue_date),
  dashboard/summary (year window overrides period + scopes all-time totals & outstanding).
  Other endpoints simply ignore the extra `year` param (FastAPI drops unknowns) — safe to extend later.
- Frontend: added `lib/academicYear.jsx` (AcademicYearProvider + useAcademicYear), `components/
  AcademicYearSelect.jsx` (header dropdown). Wired provider around AppShell in App.js; selector in the
  topbar. KEY MECHANISM: `lib/api.js` request interceptor injects `?year=<selected>` into all GET
  requests (exempt: clients, messages, academic-years, platform). Year persisted in localStorage
  (educonnect_academic_year). "All years" = no filter.
- Verified: /api/academic-years → [2026]; dashboard summary?year=2026 → period 2026-01-01..12-31;
  transactions?year filter applied; selector renders in header as "All years".
- PENDING (Feature 4): WebAuthn passkeys (needs webauthn lib + domain/RP config + careful merge into multi-tenant auth.py).

### Feature 4 — WebAuthn passkeys (BUILT, 2026-06, verified BE + FE render; device ceremony needs real hardware)
- Backend: copied `routers/webauthn.py` (webauthn==3.0.0). Multi-tenant: token issuance uses
  create_access_token(..., tenant_id, scope); removed PIN prerequisite; RP_NAME → "EduConnect Pro".
  Added PASSWORDLESS `/api/webauthn/login/begin` + `/login/finish` (email-first: find_tenant_for_email →
  bind context → verify → issue tenant JWT). Registered in server.py. RP auto-derives from origin.
- Env (PREVIEW set): WEBAUTHN_RP_ID=saas-customizer.preview.emergentagent.com, WEBAUTHN_ORIGIN=preview URL.
  PRODUCTION (user sets on Railway): WEBAUTHN_RP_ID=educonnectpro.app, WEBAUTHN_ORIGIN=https://educonnectpro.app,
  WEBAUTHN_RP_NAME="EduConnect Pro". Passkeys are domain-bound (preview creds won't work on prod).
- Frontend: copied `lib/webauthn.js` (+passkeyLogin); new `components/settings/PasskeySettings.jsx` in
  Settings; "Sign in with a passkey" button on AuthPage; auth.jsx gained loginWithPasskey(token).
- Verified: /webauthn/status→configured:true; /login/begin unknown email→400; Settings card + login button
  render. NOTE: the OS biometric prompt can only be tested on a real device.

### Feature 3 — Google Sheets sync (BUILT, 2026-06, awaiting user's Google OAuth keys to activate)
- Backend: copied `routers/google_sheets.py` (OAuth 2.0 Auth-Code flow; tokens Fernet-encrypted in
  db.google_connections). Two routers registered in server.py: `router` (prefix /api/google) +
  `oauth_router` (prefix /api/oauth/sheets). Endpoints: /google/status, /google/connect,
  /google/disconnect, /google/spreadsheets(+/worksheets/values), /google/template, /google/import,
  /google/sync, /google/syncs. Admin-only. Redirect URI auto-derives from the browser origin
  (works on preview + prod). Gated by `_configured()` → returns 503 + {configured:false} until keys set.
- Deps (appended to requirements.txt, NOT via pip freeze): google-auth==2.56.2,
  google-auth-oauthlib==1.4.1, google-auth-httplib2==0.4.0, google-api-python-client==2.198.0.
- Env (backend/.env): GOOGLE_CLIENT_ID="" and GOOGLE_CLIENT_SECRET="" (USER MUST FILL from Google
  Cloud OAuth Web client), GOOGLE_REDIRECT_URI + FRONTEND_URL default to the preview URL,
  GOOGLE_TOKEN_ENCRYPTION_KEY = a generated Fernet key (set). User must add
  `<backend>/api/oauth/sheets/callback` to the Google Console Authorized redirect URIs.
- Frontend: copied `components/settings/GoogleSheetsSettings.jsx`, wired into Settings.jsx for
  super_admin + office_admin. Shows a clear "not configured" notice until keys are added.
- Scheduled auto-sync loop intentionally NOT wired (cross-tenant limitation) — manual Connect + Import
  + "Sync now" work per-company. Verified: /api/google/status → configured:false; /connect → 503;
  Settings card renders the not-configured state.




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

### Phase 4.1 — Real infra wiring (DONE, 2026-06, self-tested)
- Database: `READONLY_MONGO_URL` env (optional). If set, the Database module browses that external
  cluster READ-ONLY (lists its databases + collection stats) via a cached motor client; if unset it
  falls back to platform+tenant DBs. Credentials never sent to frontend.
- VPS: server records gained `agent_url` + `agent_key` (key hidden from API responses). Backend proxy:
  `GET /servers/{id}/metrics`, `GET /servers/{id}/containers`, `POST /servers/{id}/containers/{name}/{action}`
  (server.restart-gated + audited) → call the agent with `X-Agent-Key`. Graceful 409/502 when no agent.
  Agent scaffold at `/app/vps-agent/agent.py` (FastAPI+psutil+docker CLI; run on the VPS with AGENT_KEY).
  Frontend: Add-Server dialog has Agent URL/key; live-metrics dialog (CPU/RAM/Disk) via the agent.
- App Detail: `PlatformAppDetail.jsx` — tabbed (Overview/Deployments/Clients/Database/API/Server/Logs/
  Versions/Settings); real Overview + assigned-Clients + inline Settings edit; honest empty states elsewhere.
- Verified: app detail E2E (zero errors); RO fallback, has_agent flag, hidden key, metrics 409 via curl.
- TO ACTIVATE: user sets `READONLY_MONGO_URL` on Railway backend, and runs the VPS agent then enters
  Agent URL/key per server.


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

### Phase 4c — Live DB Browser (DONE, 2026-08, self-tested E2E)
- Backend (`routers/registry.py`): read-only document browser + xlsx export.
  `GET /database/{db}/collections/{col}/documents?page&limit&field&value` — paginated (25/pg, cap 100),
  ObjectId/datetime JSON-safed, simple case-insensitive "contains" search (`$regex` escaped; `_id` exact),
  find-only (no writes ever). `GET .../export` streams an xlsx (openpyxl, cap 5000 rows, nested→JSON cells,
  control chars stripped), audited as `database.export`. Both gated by `database.view`. Uses `_db_read_client`
  so it targets the external cluster automatically once `READONLY_MONGO_URL` is set, else platform+tenant DBs.
- Frontend (`PlatformDatabase.jsx`): collection rows now open a document browser dialog — flat auto-column
  table, field+value search + clear, prev/next pagination with count, "Export .xlsx" download, and a
  click-row full-document JSON viewer.
- Verified E2E + curl: pagination, search match/no-match, valid xlsx (header+rows), 404 on unknown db;
  frontend table + JSON dialog render correctly (screenshots).
- Added dep: openpyxl 3.1.5 (requirements.txt via pip freeze).

### Phase 4b — VPS Docker Container Panel (DONE, 2026-08, self-tested E2E)
- Backend proxy (`routers/registry.py`) already had: `GET /servers/{id}/containers`, `GET
  /servers/{id}/containers/{name}/logs?tail=N`, `POST /servers/{id}/containers/{name}/{action}`
  (start/stop/restart) — permission-gated (server.view / server.restart) + audited via `_agent_call`.
- Frontend (`PlatformVps.jsx`): added Docker containers panel (shown only when server has_agent).
  Containers dialog = connected/disconnected agent status, manual refresh, container list with
  state badges (Running/Stopped/Restarting/Error), per-container Start/Stop/Restart (confirmation
  + audit; Start disabled when running, Stop/Restart disabled when stopped; per-row busy spinner;
  auto-refresh after action; success/error toasts). Logs dialog = terminal viewer, adjustable tail
  (100/200/500/1000), Refresh logs without closing.
- Verified E2E: ran the real `vps-agent/agent.py` (live psutil metrics) + a mock agent; backend proxy
  returned real container list, logs (tail param) and stop action with audit; frontend dialogs
  rendered correctly (screenshots). Test server cleaned up afterwards.
- NOTE: resource stats per container (CPU/RAM/network) intentionally deferred to a later monitoring phase.



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

## 2026-06 — Full KMConnect sync + per-company module switches + Product Tour (tested: iteration_2.json, BE 100%, FE fixed)
- 3-way merge (base = finflow archive, ours = /app, theirs = latest kmconnect zip 95185e0e…) of every changed file; conflicts resolved by hand.
  db.py, auth_lib core, multi-tenant login and platform routes were kept. 20+ new KM files copied in: MoneyOutFields (Payout/Expense/Income),
  ClientTxnDialog, InvoiceCreateDialog, SCReport (/sc-report), accountStatementPdf, CelebrationOverlay + celebrate/feedbackSound,
  PIN lock (components/auth/*, PinSettingsSection), SoundHapticsSettings, Campaign Sheets import/sync, StageChangeDialog,
  StudentBulkUploadDialog, Reveal/Shimmer, and the dashboard AnimatedNumber/LivePulse/ChartInteractions.
- PIN verify made tenant-aware (find_tenant_for_email → tenant JWT + branding/modules). The sweep loops (follow-ups, late attendance,
  sheet sync) now run per tenant via _sweep_all_tenants, skipping companies that have the module off.
- New modules in MODULE_CATALOG: academic_year, google_sheets, passkeys, pin_lock, sc_report, celebrations, product_tour.
  Each new module is switched ON once for existing companies (tracked in tenant.modules_backfilled). This also fixes the old attendance backfill, which turned attendance back on at every restart.
  Backend gate: auth_lib.MODULE_API_PREFIXES → 403 when a module is off. Frontend gate: lib/perm.hasModule (nav, settings cards, year selector,
  PinLockGate, CelebrationGate, the SC Report button, the Sheets import button).
- Product Tour (components/ProductTour.jsx): starts on a tenant user's first login and waits until the PIN-setup prompt is closed.
  Spotlight, "N of M", Next/Back/Skip/Esc. POST /api/auth/tour saves users.tour_status. Replay from profile menu → "Take the tour" (profile-take-tour).
  Role- and module-aware. Never shown on /platform.
- /leave redirects to /attendance?tab=leave. The Staff Dashboard leave tile already points there.
- Branding strings brought in by the merge were replaced (KM Foundation → company wording; FinFlow emails/PDF → EduConnect Pro).
## Backlog
- P1: owner-editable tour steps per company; short per-page tours; onboarding checklist; tour completion stats in the console.
- P2: short TTL cache for tenant_has_module; clean up stale DB test_database_t_3b5e3f1f… (full-length name).

## 2026-06 — Custom Tour Steps, Onboarding Checklist, Tour Insights (tested: iteration_3.json, BE 13/13, FE 100%)
- lib/tour.py holds DEFAULT_TOUR_STEPS plus resolve/clean/tour_stats (one aggregate). Each company's override is stored in tenant.tour_steps.
- Platform: GET/PUT/DELETE /api/platform/tenants/{id}/tour and POST /tour/reset-users ("replay for all"). _tenant_stats.tour gives the list column.
  UI: PlatformClientDetail → "Product Tour" tab (components/platform/TourEditor.jsx: edit, enable, reorder, add/remove custom messages, reset, insights).
  PlatformConsole table has a Tour column (tour-stats-{slug}).
- Tenant: GET /api/onboarding/tour returns the enabled steps in saved order. ProductTour.jsx combines them with META (selectors/module/roles); custom steps show centred.
- Onboarding checklist: GET /api/onboarding/checklist, POST /checklist/dismiss (users.onboarding_dismissed). Items are role-filtered:
  admins see 6 items, staff see student, lead and payment. The flags are company-wide. Shown on Dashboard and StaffDashboard. Module "onboarding" (backfilled ON).
## Backlog
- Choose whether staff checklist ticks should count only that staff member's own records (right now they are company-wide).
- Swap window.confirm in TourEditor for AlertDialog; warn about unsaved tour edits.
- 2026-06: Setup celebration. When a user's checklist is complete, the card is replaced by "Your workspace is ready!" (onboarding-complete)
  with the milestone celebrate() overlay and sound, but only if the celebrations module is on. "Got it" calls POST /api/onboarding/checklist/celebrated
  (users.onboarding_celebrated), so it shows once per user. Users who hid the checklist don't see it.

## 2026-06 — Platform Console pending tabs (tested: iteration_4.json, BE 13/13 after fix, FE 100%)
- Client detail (components/platform/ClientTabs.jsx):
  Applications: assign/unassign apps (PUT /api/platform/tenants/{id}/applications/{appId}).
  Database: dbstats plus collection counts.
  Subscription: manual plan from Settings → Plans, status trial/active/past_due/cancelled, trial end date, seat limit (0 = unlimited, empty = plan default), notes; saved to tenant.subscription.
  Security: login history (gdb.login_events written by /auth/login), failed/success counts for 24h, strikes and lockouts with Unlock, audit log, and "Sign out all users" (tenant.sessions_revoked_at checked against JWT iat in auth_lib, with a 10s cache).
- Seat limit is enforced by lib/subscription.enforce_seat_limit in POST /api/users (including reactivation), /users/{id}/reactivate, and both staff login-creation paths. Error: "Seat limit reached: X of Y users on the <plan> plan…".
- App detail (components/platform/AppTabs.jsx):
  Deployments (gdb.app_deployments; a successful deploy to the app's own environment bumps app.version).
  Versions/changelog (gdb.app_versions).
  API keys (gdb.app_api_keys stores a sha256 hash; the key is shown once; public GET /api/platform/app-api/whoami with X-App-Key).
  Server link (app.server_id, with live metrics when the server has an agent).
  Databases of assigned clients.
  Logs (platform_audit filtered on meta.app_id).
## Backlog
- AlertDialog instead of window.confirm across the console; show an explanation on /login after a forced sign-out.

## 2026-06 — Trial reminders and expiry handling + forced sign-out notice (tested: iteration_5.json, BE 10/10; FE race fixed and re-verified)
- lib/subscription.trial_info(sub) returns days_left, expired (the day after trial_ends_at), near (7 days or less) and expiry_action. The setting is subscription.expiry_action: keep | read_only | block.
  auth_lib enforces it through the cached tenant_access: block → 403 on every request and at login; read_only → 403 on non-GET requests except /api/auth/*.
- /auth/me and login return `trial`. TrialBanner.jsx shows for super_admin/office_admin: sky colour, amber at 7 days or less, red at 3 or less or expired.
  It can be dismissed for the day, except when expired and read-only.
- Console: "Trial ends" column (TrialBadge), Subscription tab has the "On trial expiry" select, and Home attention lists trials that are expired or end within 7 days.
- api.js handleSessionEnd: a revoked session (401), an expired token (401) or a trial block (403) stores sessionStorage auth.notice {kind, text, at}, calls /auth/logout to clear the cookie, then redirects to /login.
  AuthPage reads the notice without consuming it (valid for 2 minutes) and clears it on sign-in, so it survives a hard reload.

## 2026-06 — Behance-style collapsible sidebar (client app only; tested: iteration_6.json, rail bug fixed and re-verified)
- AppShell SidebarContent was rewritten as a floating rounded panel. It has a header with logo, name and collapse chevron (sidebar-collapse-btn); a profile card (sidebar-profile); live menu search (sidebar-search); a compact Academic Year select; uppercase section labels; and groups with a rotating chevron.
  Active item: brand-colour pill (hsl(var(--primary))) with a left bar and filled icon. Bottom has a Dark-mode switch (sidebar-theme-toggle) and Sign out (sidebar-logout-btn / drawer-logout-btn).
- Rail mode is about 80px, with centred icons, Radix tooltips, badge dots, and search/year icons that expand the sidebar (search also gets focus). It's saved in localStorage sidebarRail, and the topbar toggle does the same.
  NavLink is wrapped in a span inside TooltipTrigger asChild, because Slot breaks NavLink's function className.
- The mobile drawer uses the same design: a rounded right edge, z-[70] so it sits above the bottom nav, width 84vw (max 300px). The Platform Console sidebar is unchanged.

## 2026-06 — Pinned Favourites + sidebar tweaks (tested: iteration_7.json, BE 8/8, FE 100%)
- PUT /api/auth/pins saves users.nav_pins (max 8, unique, must start with "/"). /me returns it.
  AppShell has a "Pinned" section (pinned-section, pinned-{tid}), hover pin/unpin buttons (nav-pin-/unpin-{tid}), HTML5 drag reorder (pinned-row-{i}) and a mobile up-arrow (pin-up-{tid}).
  Only visible pins count toward the limit; pins hidden by permissions or modules are pruned on the next save. On mobile the pin buttons are always visible.
- Removed the top-bar desktop-sidebar-toggle (collapse is only via sidebar-collapse-btn). Approvals and Activity moved into the Office group.

## 2026-06 — Monochrome "Dashboard design 2020" client UI (tested: iteration_8.json; dark-mode contrast and leftover-red fixes applied and visually verified)
- html.theme-mono is added by useMonoTheme() (AppShell + AuthPage) and removed on unmount, so the Platform Console keeps its own look.
  index.css overrides all tokens with !important to beat inline brand vars: B/W light theme, inverted dark, Poppins, black/white pill btn-amber, greyscale charts. Legacy orange/amber utilities map to foreground.
- Desktop nav is now DesktopRail: an 84px black rounded rail with a .rail-cell-active white notch (concave corners via box-shadow pseudo-elements) and tooltips.
  It shows the user's pins (or the defaults Overview/Students/CRM/Messages/Attendance), then a menu button, Settings and Sign out.
  rail-menu-btn opens the rail-flyout (full SidebarContent, variant "flyout", testids prefixed "flyout-").
- Dashboard hero (dashboard-hero): "Hi <name>." with an illustration at /illustrations/dashboard-hero.png and right-column hero-stat-* cards. PALETTES in dashboardUtils are monochrome.

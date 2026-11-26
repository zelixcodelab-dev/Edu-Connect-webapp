# Mithu AI integration plan (feature branch only)

Status: design/contract draft. This file does not enable AI access or change application data.

## Confirmed EduConnect implementation
- Frontend: React 19, Create React App/Craco, React Router 7, Axios. Vercel config: `frontend/vercel.json`.
- API: FastAPI app in `backend/server.py`; Render blueprint at root `render.yaml` runs `uvicorn server:app` from `backend`.
- Database: Motor; tenant-specific DB context proxy in `backend/db.py`; shared platform DB is separate.
- Authentication: `backend/auth_lib.py`, HS256 access JWT, cookie and Bearer token, resolves user from DB and binds tenant context.
- Roles: tenant `super_admin`, `office_admin`, `user`, `staff`; platform scope/owner roles separately handled.
- Student scope: `backend/routers/students.py` uses creator + office visibility and linked-client filtering, with super_admin tenant-wide view.
- Lead scope: `backend/routers/leads.py`: super_admin tenant-wide; office_admin own office; staff assigned leads only.
- College confidential field: `sc_rates` is stripped for non-super-admin callers in `backend/routers/colleges.py`.

## Non-negotiable architecture
1. Mithu is a separate FastAPI service in `zelixcodelab-dev/Mithu-AI-Assistant`.
2. The browser never calls Mithu with a role or tenant identifier as authorization.
3. EduConnect's `get_current_user` remains the single authentication authority.
4. EduConnect creates a short-lived signed Ed25519 assertion after authentication and database-backed user resolution.
5. Mithu validates issuer, audience, signature, expiry, subject and token ID using the public key only.
6. Mithu never receives `MONGO_URL`, the EduConnect `JWT_SECRET`, or any EduConnect DB credentials.
7. The gateway must call the same permission-aware application service/query functions used by existing API routes, or reproduce their filters exactly with regression tests.
8. Initial tools are GET-only. Mutating tools are excluded.
9. Staging fixtures only; no production data queries or modifications.

## Proposed endpoints
- `POST /internal/ai/identity-assertion`: authenticated EduConnect user; returns a short-lived assertion for server-to-server calls.
- `GET /internal/ai/colleges`: returns tenant college catalogue while preserving existing `sc_rates` masking.
- `GET /internal/ai/students`: same list/visibility semantics as `GET /api/students`.
- `GET /internal/ai/students/{student_id}`: same visibility semantics as `GET /api/students/{student_id}`.
- `GET /internal/ai/leads`: same scope as `GET /api/leads` with safe filters only.

These routes must be authenticated server-to-server. The gateway must not trust user, role, tenant, office or permission headers merely because Mithu supplies them. It should validate the signed assertion itself or accept a signed assertion and reconstruct trusted context.

## Frontend integration
- Add Mithu widget only after the backend gateway is complete.
- Reuse existing `AuthProvider` and `frontend/src/lib/api.js` for the current session; do not ask users to log in twice.
- Main backend should proxy authenticated chat calls to the Mithu service. Do not expose `EDUCONNECT_SERVICE_TOKEN` or OpenAI credentials to the browser.
- Respect the current user scope and do not render tool data not returned by the authorized backend.
- Use a feature flag to keep the widget disabled until staging validation passes.

## Deployment
- Existing CRA frontend remains on Vercel.
- Existing FastAPI remains on its current separate hosting.
- Mithu is a distinct Docker service with its own isolated database.
- No deployment or environment-variable changes are included in this plan.

## Acceptance tests
- expired, wrong-issuer, wrong-audience and wrong-signature assertions rejected
- tenant A cannot resolve tenant B records
- office admin cannot read records outside own office/shared scope
- staff can only access assigned leads and permitted student scope
- linked `user` can only see its existing linked-client/referrer/owned student scope
- non-super-admin responses never contain college `sc_rates`
- platform scope cannot accidentally route into a tenant database
- every write tool name is rejected/unregistered
- all tests run against synthetic fixtures

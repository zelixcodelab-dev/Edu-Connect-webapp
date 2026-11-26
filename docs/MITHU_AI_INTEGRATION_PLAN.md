# Mithu AI integration plan — live voice feature branch

Status: live voice scaffolding is implemented on `feat/mithu-voice-integration`. This branch is not deployed and does not enable voice by default. No production database query, migration or write has been made.

## Confirmed EduConnect implementation
- Frontend: React 19, Create React App/Craco, React Router 7, Axios. Vercel config: `frontend/vercel.json`.
- API: FastAPI app in `backend/server.py`; Render blueprint at root `render.yaml` runs `uvicorn server:app` from `backend`.
- Database: Motor; tenant-specific DB context proxy in `backend/db.py`; shared platform DB is separate.
- Authentication: `backend/auth_lib.py`, HS256 access JWT, cookie and Bearer token, resolves user from DB and binds tenant context.
- Roles: tenant `super_admin`, `office_admin`, `user`, `staff`; platform scope/owner roles are handled separately.
- Student scope: `backend/routers/students.py` applies creator + office visibility and linked-client filtering, with super-admin tenant-wide view.
- Lead scope: `backend/routers/leads.py`: super-admin tenant-wide; office-admin own office; staff assigned leads only.
- College confidential field: `sc_rates` is stripped for non-super-admin callers in `backend/routers/colleges.py`.

## Voice architecture
1. An authenticated EduConnect user requests a voice ticket from `POST /api/mithu/voice-ticket`.
2. EduConnect verifies the current session with its existing `get_current_user` dependency and creates a 90-second Ed25519 identity assertion from server-side user/tenant/role/office/permission context.
3. The frontend opens a WebSocket directly to the Mithu service. It sends the assertion in the WebSocket subprotocol, not in a URL query parameter.
4. Mithu verifies issuer, audience, EdDSA signature, subject, role/scope, expiry and assertion lifetime.
5. Mithu opens the trusted server-to-server WebSocket to GPT-Live. The OpenAI API key remains on the Mithu server.
6. The browser streams mono PCM16LE at 24 kHz; Mithu forwards input and output audio/transcript events.
7. GPT-Live Responses delegation can call only registered read-only tools. Mithu executes those tools server-side with the verified identity assertion and returns results to the live session.
8. The browser widget shows live captions and provides start, mute and end controls. Audio and captions are not saved by the widget.

## Files changed on this branch
- `backend/routers/mithu.py`: authenticated 90-second identity assertion endpoint.
- `backend/server.py`: mounts the Mithu ticket router.
- `frontend/src/components/mithu/MithuVoiceAssistant.jsx`: browser voice UI, microphone capture, PCM conversion, playback and captions.
- `frontend/src/pages/AppShell.jsx`: mounts the voice assistant in the authenticated app shell.
- `frontend/.env.mithu.example`: feature-flag example.

## Mithu service counterpart
Repository: `zelixcodelab-dev/Mithu-AI-Assistant`, branch `feat/mithu-realtime-voice`.
- `app/voice.py`: authenticated GPT-Live WebSocket bridge, browser event allow-list and server-side Responses function-call handling.
- `app/voice_prompts.py`: Malayalam/Manglish/English voice behavior and safety instructions.
- `app/main.py`: mounts the voice WebSocket endpoint and advertises configured capability.
- `app/security.py`: verifies the short-lived identity assertions.

## Environment variables

### EduConnect backend (existing FastAPI service)
- `MITHU_VOICE_ENABLED=true`
- `MITHU_IDENTITY_PRIVATE_KEY_PEM`: Ed25519 private key, stored only in backend secret manager.
- `MITHU_IDENTITY_ISSUER=educonnect-pro`
- `MITHU_IDENTITY_AUDIENCE=mithu-ai`
- `MITHU_VOICE_WS_URL=wss://<your-mithu-host>/api/v1/voice/ws`

### Mithu voice service (separate container)
- `OPENAI_API_KEY`
- `MITHU_LIVE_MODEL=gpt-live-1.1`
- `MITHU_RESPONSES_MODEL=gpt-6-luna`
- `MITHU_LIVE_VOICE=marin`
- `IDENTITY_ISSUER=educonnect-pro`
- `IDENTITY_AUDIENCE=mithu-ai`
- `IDENTITY_PUBLIC_KEY_PEM`: matching Ed25519 public key.
- `EDUCONNECT_API_ENABLED=false` until the read-only gateway is implemented.
- `EDUCONNECT_INTERNAL_API_URL` and `EDUCONNECT_SERVICE_TOKEN` only after the gateway is ready.
- `CORS_ORIGINS`: the approved EduConnect frontend origin(s).

Generate a fresh key pair for Mithu (do not use the existing HS256 JWT secret):
```bash
openssl genpkey -algorithm Ed25519 -out mithu_identity_private.pem
openssl pkey -in mithu_identity_private.pem -pubout -out mithu_identity_public.pem
```
Put the private key only in the EduConnect backend's secret manager and the public key in Mithu's secret manager. Never commit either key.

### EduConnect frontend (Vercel)
- `REACT_APP_MITHU_VOICE_ENABLED=true` to render the voice widget.
- This flag is deliberately opt-in; it is not enabled by the committed code.

## Read-only gateway dependency
The existing application still needs its dedicated internal AI gateway endpoints:
- `GET /internal/ai/colleges`
- `GET /internal/ai/students`
- `GET /internal/ai/students/{student_id}`
- `GET /internal/ai/leads`

These routes have not been implemented in this voice branch. Keep `EDUCONNECT_API_ENABLED=false` until they are implemented and permission-tested. Voice can answer general education questions without them; it must not claim to have checked live records.

The gateway must independently verify the signed assertion and call the same permission-aware logic as the existing routes. It must not trust unsigned role/tenant/office headers, and Mithu must never access EduConnect MongoDB directly.

## Release status
- Code is present on feature branches only.
- The assistant is not deployed.
- No environment variables have been changed in hosting.
- The production database is not connected to Mithu.
- No student records or other application data were modified.
- Voice tools are read-only; the voice widget does not save audio/transcripts.

## Required pre-deployment tests
- missing, expired, altered, wrong-issuer and wrong-audience identity assertions rejected
- user identity is derived only by `get_current_user`
- no assertion can be issued when `MITHU_VOICE_ENABLED` is false
- only approved EduConnect frontend role/scope claims are included
- browser cannot send arbitrary GPT-Live commands or call unregistered tools
- student/lead tools enforce tenant, office, assigned and linked-client visibility
- non-super-admin responses never contain college `sc_rates`
- all write tool names are rejected/unregistered
- microphone input/output, interruption, mute, stop, dropped connection and mobile Safari/Chrome behavior are tested
- all tests use synthetic fixtures and a non-production OpenAI project/environment


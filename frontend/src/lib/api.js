import axios from "axios";

// Defensive URL normalization: in some Vercel/Netlify dashboards, operators
// configure REACT_APP_BACKEND_URL without the scheme (e.g. just the bare
// "myapp.up.railway.app" instead of "https://myapp.up.railway.app"). Without
// a scheme, axios treats the value as a relative path and prepends the
// current origin — so requests silently land on the SPA host, return the
// index.html, and look like a successful 200 with empty payload. Catch that
// here so a misconfigured env var still produces a working app.
function normalizeBackend(raw) {
  const v = (raw || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

const BACKEND_URL = normalizeBackend(process.env.REACT_APP_BACKEND_URL);
export const API = `${BACKEND_URL}/api`;

// Token storage helpers — used as a FALLBACK when cross-origin cookies are
// blocked by the browser (e.g. Chrome's third-party cookie deprecation when
// frontend and backend live on different sub/domains in production).
//
// MOBILE-SAFE: many mobile webviews & private-mode browsers reject
// localStorage with QuotaExceededError / SecurityError on the very first
// write (Safari private mode, Instagram/FB/TikTok in-app browsers, Brave
// strict shields, some Android WebViews). If we let those throw the login
// flow surfaces a generic "Something went wrong" toast. Catch defensively
// and degrade to a same-tab in-memory token store — auth still works for
// the duration of the session and is automatically restored if persistence
// becomes available again.
//
// SECURITY NOTE: localStorage is intentionally chosen as the cross-origin
// fallback, knowing it is read-accessible to any script on this origin.
// Mitigations:
//   • Same-origin deploys use httpOnly + Secure + SameSite=Strict cookies
//     (set by backend `/auth/login`) — localStorage is then dormant.
//   • The token is a short-lived JWT (7-day exp); backend can revoke a stolen
//     token via the password-reset endpoint which clears `password_reset_at`.
//   • The codebase has no `dangerouslySetInnerHTML` user-content paths, so XSS
//     attack surface is limited to vendored deps which are version-pinned.
const TOKEN_KEY = "finflow_access_token";

// Module-scoped in-memory mirror — only used when localStorage is unavailable.
let inMemoryToken = null;

function safeLocalStorage() {
  // Touching `window.localStorage` itself can throw on some browsers (Safari
  // ITP, some Android WebViews when the host disabled DOM storage). Guard the
  // *access*, not just the call.
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export const setStoredToken = (t) => {
  inMemoryToken = t || null;
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    if (!t) ls.removeItem(TOKEN_KEY);
    else ls.setItem(TOKEN_KEY, t);
  } catch {
    // QuotaExceededError / SecurityError — fall back to in-memory only.
  }
};

export const getStoredToken = () => {
  const ls = safeLocalStorage();
  if (ls) {
    try {
      const t = ls.getItem(TOKEN_KEY);
      if (t) return t;
    } catch {
      // ignore — fall through to in-memory mirror
    }
  }
  return inMemoryToken;
};

const api = axios.create({
  baseURL: API,
  withCredentials: true,
  // 45s tolerates a serverless/Railway "cold start" (a sleeping backend can
  // take 20-40s to wake on the first request) so the first login/branding
  // call doesn't fail with a false "can't reach server" while the container
  // spins up. Warm requests still return in well under a second.
  timeout: 45_000,
});

// Attach Authorization: Bearer <token> to every request when we have a
// stored token. Backend reads either the cookie OR the Authorization header
// (see auth_lib.get_current_user), so same-origin deploys keep using cookies
// and cross-origin deploys transparently fall back to localStorage.
api.interceptors.request.use((config) => {
  const t = getStoredToken();
  if (t) {
    config.headers = config.headers || {};
    if (!config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${t}`;
    }
  }
  return config;
});

// Retry transient network / timeout failures. Common on (a) Android carrier
// networks where the first TLS handshake races the DNS resolver, and (b) a
// sleeping backend cold-starting — the first request times out, the next one
// succeeds. We retry up to 3 times with increasing backoff so a cold start or
// a flaky first connect turns into a successful load instead of a scary error.
const _MAX_RETRIES = 3;
function _shouldRetry(err) {
  if (!err) return false;
  // The `config` object is REUSED across retry attempts, so we track the
  // attempt count there (a flag on the Error itself is recreated each attempt).
  const count = err?.config?.__retryCount || 0;
  if (count >= _MAX_RETRIES) return false;
  // No response received → transport-layer failure (not an HTTP 4xx/5xx).
  if (!err.response && err.config) {
    const msg = String(err.message || "").toLowerCase();
    return (
      err.code === "ECONNABORTED" ||
      err.code === "ERR_NETWORK" ||
      msg.includes("network error") ||
      msg.includes("timeout")
    );
  }
  return false;
}
api.interceptors.response.use(
  (resp) => resp,
  async (err) => {
    if (_shouldRetry(err)) {
      const count = (err.config.__retryCount || 0) + 1;
      // Increasing backoff: 0.6s, 1.5s, 3s — gives a cold backend time to wake.
      const backoff = [600, 1500, 3000][count - 1] || 3000;
      await new Promise((r) => setTimeout(r, backoff));
      try {
        return await api.request({ ...err.config, __retryCount: count });
      } catch (retryErr) {
        return Promise.reject(retryErr);
      }
    }
    return Promise.reject(err);
  },
);

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default api;

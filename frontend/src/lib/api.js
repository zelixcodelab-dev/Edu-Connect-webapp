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
  // 25s is generous enough for slow mobile networks yet short enough that a
  // truly-dropped request fails loud instead of hanging the login button
  // forever. Android carriers occasionally stall TLS handshakes indefinitely.
  timeout: 25_000,
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

// Retry-once on transient network / timeout failures. Common on Android
// carrier networks where the first TLS handshake races the DNS resolver and
// axios sees "Network Error" before the browser has actually completed the
// connect. A single retry with 400ms backoff turns a scary "network error"
// toast into a successful login for the vast majority of users.
function _shouldRetry(err) {
  if (!err) return false;
  // Axios manufactures a fresh Error object on every attempt, so a flag on
  // the error itself is invisible to the next call. The `config` object,
  // however, is REUSED across retry attempts — that's where we mark the
  // attempt and where we check it on subsequent failures.
  if (err?.config?.__retried) return false;
  // No response received → transport-layer failure.
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
      await new Promise((r) => setTimeout(r, 400));
      try {
        // Mark on the config (which axios preserves across attempts) so the
        // next failure trips the guard and doesn't loop indefinitely.
        return await api.request({ ...err.config, __retried: true });
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

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import api, { formatApiError, setStoredToken } from "./api";

const AuthContext = createContext(null);

// Mobile-only PIN unlock. Desktop keeps the normal login flow.
const isMobileViewport = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

// Re-lock triggers (per user spec):
// - fresh browser open / reload
// - 5 minutes of inactivity within a session
const INACTIVITY_LOCK_MS = 5 * 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = unauth, obj = user
  const [error, setError] = useState("");
  // PIN unlock state — separate from `user` so we can hold the identity
  // while gating access behind the lock screen.
  const [locked, setLocked] = useState(false);
  const [setupPinPromptOpen, setSetupPinPromptOpen] = useState(false);
  const inactivityTimer = useRef(null);

  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current);
      inactivityTimer.current = null;
    }
  }, []);

  const armInactivityTimer = useCallback(() => {
    clearInactivityTimer();
    if (!isMobileViewport()) return; // desktop stays unlocked
    inactivityTimer.current = setTimeout(() => {
      // Only lock if the user still has PIN enabled AND is signed in.
      const email = sessionStorage.getItem("pin_lock.email_hint");
      if (email) setLocked(true);
    }, INACTIVITY_LOCK_MS);
  }, [clearInactivityTimer]);

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      // Lock the app on every fresh mount when the user has PIN enabled and
      // we're on a phone-sized viewport — matches the "fresh open / reload"
      // spec. The login() and unlockWithUser() flows explicitly setLocked(false)
      // right after they run, so this only fires on genuine reloads.
      if (isMobileViewport() && data?.pin_enabled) {
        setLocked(true);
      }
      // Remember the email so the inactivity timer can display who to unlock
      // as, without an extra network hit.
      if (data?.email && data?.pin_enabled) {
        try { sessionStorage.setItem("pin_lock.email_hint", data.email); } catch { /* no-op */ }
      }
    } catch {
      // Boot-time auth check failed → mark unauthenticated AND clear any
      // stale stored token so the interceptor doesn't keep sending it.
      setStoredToken(null);
      setUser(false);
    }
  }, []);

  // Silent refresh used by the focus/visibility listener. Unlike fetchMe this
  // NEVER logs the user out on failure — mobile browsers fire visibility
  // events on every keyboard popup, app switch, biometric prompt, etc. A
  // transient /auth/me hiccup (iOS Safari ITP cookie blip, brief Wi-Fi/4G
  // handover) must not blast an authenticated user back to /login.
  const silentRefresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      // Keep the current session as-is. The next request that ACTUALLY
      // matters (user-initiated navigation / mutation) will surface a real
      // error if the session is genuinely dead.
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  // Inactivity re-lock on mobile: 5 minutes of no keyboard/mouse/touch/scroll
  // marks the session as sleeping and forces a PIN unlock. ALSO: lock when
  // the tab is backgrounded for more than 60s (user could hand the phone
  // over while the tab is still "warm").
  useEffect(() => {
    if (!user || user === false || locked) return;
    if (!isMobileViewport() || !user.pin_enabled) return;
    const events = ["click", "keydown", "touchstart", "scroll", "pointerdown"];
    const bump = () => armInactivityTimer();
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    armInactivityTimer();
    // ---- Background-lock (60s) ----
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      // Just came back into focus. If we were away for > 60s, lock the app.
      if (hiddenAt && Date.now() - hiddenAt > 60_000) {
        setLocked(true);
      }
      hiddenAt = 0;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener("visibilitychange", onVisibility);
      clearInactivityTimer();
    };
  }, [user, locked, armInactivityTimer, clearInactivityTimer]);

  // Live-refresh: when the tab regains focus or visibility, pull fresh /auth/me so
  // server-side permission changes pushed by a super-admin take effect without
  // requiring the office-admin to sign out and back in. Only runs when logged in.
  useEffect(() => {
    if (!user || user === false) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") silentRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user, silentRefresh]);

  const login = useCallback(async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      // Backend returns the JWT in the body alongside the user object so
      // cross-origin deploys (where Chrome blocks third-party cookies) can
      // fall back to Authorization: Bearer auth.
      if (data?.access_token) setStoredToken(data.access_token);
      const { access_token: _t, ...rest } = data || {};
      setUser(rest);
      setLocked(false);
      // Remember the email so the inactivity timer + lock screen can render
      // the user's identity without a fresh network hit.
      try {
        if (rest?.email && rest?.pin_enabled) {
          sessionStorage.setItem("pin_lock.email_hint", rest.email);
        }
      } catch { /* no-op */ }
      // Prompt mobile users without a PIN to set one — once per login.
      if (isMobileViewport() && rest && !rest.pin_enabled) {
        setSetupPinPromptOpen(true);
      }
      return true;
    } catch (e) {
      // Prefer the server-side error detail; fall through to a friendlier
      // message for the two commonest transport failures on mobile
      // (blocked/dropped cross-origin request → "Network Error", stalled TLS
      // handshake → "timeout of X ms exceeded"). Plain axios messages read
      // like a stack trace to non-technical users.
      const serverDetail = e?.response?.data?.detail;
      if (serverDetail) {
        setError(formatApiError(serverDetail));
      } else {
        const raw = String(e?.message || "").toLowerCase();
        if (raw.includes("network error") || e?.code === "ERR_NETWORK") {
          setError("Can't reach the server. Check your internet connection and try again.");
        } else if (raw.includes("timeout") || e?.code === "ECONNABORTED") {
          setError("The server is taking longer than usual (it may be waking up). Please wait a few seconds and try again.");
        } else {
          setError(e?.message || formatApiError(null));
        }
      }
      return false;
    }
  }, []);

  const register = useCallback(async (payload) => {
    setError("");
    try {
      const { data } = await api.post("/auth/register", payload);
      // Backend returns {ok, approval_status, message} — user must be approved before login
      return { ok: true, pending: data?.approval_status === "pending", message: data?.message };
    } catch (e) {
      const serverDetail = e?.response?.data?.detail;
      setError(serverDetail ? formatApiError(serverDetail) : (e?.message || formatApiError(null)));
      return { ok: false };
    }
  }, []);

  const loginWithPasskey = useCallback(async (token) => {
    if (token) setStoredToken(token);
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      return true;
    } catch {
      setStoredToken(null);
      setUser(false);
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch (err) {
      // Surface server-side logout failures in dev tools but always clear
      // the local session so the user isn't stuck.
      console.error("[auth] logout failed:", err?.message || err);
    }
    setStoredToken(null);
    setUser(false);
    setLocked(false);
    clearInactivityTimer();
    try {
      sessionStorage.removeItem("pin_lock.email_hint");
    } catch { /* no-op */ }
  }, [clearInactivityTimer]);

  // Unlock success handler used by the PIN lock screen.
  const unlockWithUser = useCallback((fresh) => {
    setUser(fresh);
    setLocked(false);
    try {
      if (fresh?.email) sessionStorage.setItem("pin_lock.email_hint", fresh.email);
    } catch { /* no-op */ }
  }, []);

  // "Sign in with password instead" — full logout so user reaches /login.
  const bailToPasswordLogin = useCallback(() => {
    setLocked(false);
    setStoredToken(null);
    setUser(false);
    try {
      sessionStorage.removeItem("pin_lock.email_hint");
    } catch { /* no-op */ }
  }, []);

  const updateProfile = useCallback(async (payload) => {
    const { data } = await api.patch("/auth/me", payload);
    setUser(data);
    return data;
  }, []);

  // Stabilise the context value so consumers don't re-render whenever
  // AuthProvider re-renders for unrelated reasons. New reference is only
  // produced when one of the actual deps changes.
  const ctxValue = useMemo(
    () => ({
      user, error, setError, login, loginWithPasskey, register, logout, updateProfile, refresh: fetchMe,
      // PIN-unlock state
      locked, setLocked, unlockWithUser, bailToPasswordLogin,
      setupPinPromptOpen, setSetupPinPromptOpen,
    }),
    [user, error, login, loginWithPasskey, register, logout, updateProfile, fetchMe,
     locked, unlockWithUser, bailToPasswordLogin, setupPinPromptOpen],
  );

  return (
    <AuthContext.Provider value={ctxValue}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

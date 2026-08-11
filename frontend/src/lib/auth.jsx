import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { formatApiError, setStoredToken } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = unauth, obj = user
  const [error, setError] = useState("");

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
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
    () => ({ user, error, setError, login, register, logout, updateProfile, refresh: fetchMe }),
    [user, error, login, register, logout, updateProfile, fetchMe],
  );

  return (
    <AuthContext.Provider value={ctxValue}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

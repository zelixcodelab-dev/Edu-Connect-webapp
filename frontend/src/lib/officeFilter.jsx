/**
 * Office filter context — used by the CRM dashboard so the Super Admin can
 * pin every widget on the page to a single office (KM BLR / KM TCR / KM KMLY).
 *
 * Persistence: `localStorage['crm.selectedOffice']`.
 *
 * Non-super_admin users read the context but the setter is a no-op — office
 * admins + staff are scoped by the backend to their own office already.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";

const OfficeFilterCtx = createContext({ office: null, setOffice: () => {}, isSuper: false });

export const OFFICE_OPTIONS = Object.freeze([
  { code: "KM_BLR", label: "KM BLR" },
  { code: "KM_TCR", label: "KM TCR" },
  { code: "KM_KMLY", label: "KM KMLY" },
]);

const STORAGE_KEY = "crm.selectedOffice";

export function OfficeFilterProvider({ children }) {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";

  const [office, setOfficeState] = useState(() => {
    if (typeof window === "undefined") return null;
    // Non-super admins have their office pinned by the backend — the context
    // just mirrors it so children can pass it as a prop-drilling shortcut.
    if (!isSuper) return null;
    return localStorage.getItem(STORAGE_KEY) || null;
  });

  // Seed from the user object once auth resolves (super admin's home office
  // is a sensible default if nothing is stored yet).
  useEffect(() => {
    if (!isSuper) { setOfficeState(null); return; }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) { setOfficeState(stored); return; }
    if (user?.office) {
      setOfficeState(user.office);
      localStorage.setItem(STORAGE_KEY, user.office);
    }
  }, [isSuper, user?.office]);

  const setOffice = useCallback((next) => {
    if (!isSuper) return;
    setOfficeState(next || null);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* localStorage disabled — silently ignore */ }
  }, [isSuper]);

  const value = useMemo(() => ({ office, setOffice, isSuper }), [office, setOffice, isSuper]);
  return <OfficeFilterCtx.Provider value={value}>{children}</OfficeFilterCtx.Provider>;
}

export function useOfficeFilter() {
  return useContext(OfficeFilterCtx);
}

/** Merge the current office filter into an axios `params` object. Handy inline
 *  helper — call as `params: officeParams(office, { campaign_id })`. Skips the
 *  merge when no office is active so backend keeps its default role scoping. */
export function officeParams(office, extra) {
  const base = extra || {};
  if (!office) return base;
  return { ...base, office };
}

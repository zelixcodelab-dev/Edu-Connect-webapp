import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import api, { getApiYear, setApiYear } from "@/lib/api";

const AcademicYearContext = createContext(null);

const CURRENT_YEAR = new Date().getFullYear();

// Resolve the initial selection: whatever was persisted, else the current
// calendar year (the product default). Kept in sync with api.js's injector.
function initialYear() {
  const stored = getApiYear();
  if (stored) return stored;
  const def = String(CURRENT_YEAR);
  setApiYear(def);
  return def;
}

export function AcademicYearProvider({ children }) {
  const [year, setYearState] = useState(initialYear); // string year OR "all"
  const [years, setYears] = useState([CURRENT_YEAR]);
  const [current, setCurrent] = useState(CURRENT_YEAR);

  useEffect(() => {
    let alive = true;
    api
      .get("/academic-years")
      .then(({ data }) => {
        if (!alive) return;
        setYears(data.years?.length ? data.years : [CURRENT_YEAR]);
        setCurrent(data.current || CURRENT_YEAR);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Changing the year re-scopes the ENTIRE app. We persist + update the API
  // injector, then reload so every page refetches with the new lens.
  const setYear = useCallback(
    (next) => {
      const val = next == null ? "all" : String(next);
      // Persist the raw choice ("all" or a year). api.js skips injecting a
      // ?year param when the value is "all", but we must still store it so a
      // reload doesn't fall back to the current-year default.
      setApiYear(val);
      setYearState(val);
      if (typeof window !== "undefined") window.location.reload();
    },
    [],
  );

  return (
    <AcademicYearContext.Provider value={{ year, setYear, years, current }}>
      {children}
    </AcademicYearContext.Provider>
  );
}

export function useAcademicYear() {
  const ctx = useContext(AcademicYearContext);
  if (!ctx) throw new Error("useAcademicYear must be used within AcademicYearProvider");
  return ctx;
}

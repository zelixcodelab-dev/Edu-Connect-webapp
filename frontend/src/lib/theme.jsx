import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const ThemeCtx = createContext({ theme: "light", toggle: () => {}, setTheme: () => {} });

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    // Boot-time localStorage access can throw on mobile in-app browsers, Safari
    // private mode, and Android WebViews where DOM storage is disabled. If it
    // throws here (inside the React tree's root provider), the whole app
    // white-screens — so guard the access AND the getItem call separately.
    try {
      if (typeof window === "undefined") return "light";
      const saved = window.localStorage?.getItem("finflow-theme");
      if (saved === "dark" || saved === "light") return saved;
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try { window.localStorage?.setItem("finflow-theme", theme); } catch (e) { void e; }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  // Stabilise the context value so consumers don't re-render on every parent
  // render — only when `theme` actually flips.
  const ctxValue = useMemo(
    () => ({ theme, toggle, setTheme }),
    [theme, toggle],
  );

  return <ThemeCtx.Provider value={ctxValue}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

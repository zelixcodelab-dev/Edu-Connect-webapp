import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "./api";

// Must mirror backend lib/whitelabel.DEFAULT_BRANDING.
export const DEFAULT_BRANDING = {
  app_name: "EduConnect Pro",
  app_short: "Connect",
  company_line: "Admissions & Finance Suite",
  logo_url: "/brand-logo.png",
  brand_color: "#C70000",
  hero_title: "AdmissionOps,",
  hero_accent: "Real-Time Tracker.",
  hero_tagline: "The complete partner & admission management platform for education consultancies.",
  eyebrow: "Admissions · Office Portal",
  currency: "INR",
};

const BrandingCtx = createContext({
  branding: DEFAULT_BRANDING,
  enabledModules: null,
  setBrandingData: () => {},
});

export function hexToHsl(hex) {
  if (!hex) return null;
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      default: hue = (r - g) / d + 4; break;
    }
    hue /= 6;
  }
  return {
    h: Math.round(hue * 360),
    s: Math.round(sat * 100),
    l: Math.round(l * 100),
  };
}

// True when black text reads better than white on this colour (WCAG contrast).
export function prefersDarkText(hex) {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return false;
  const lin = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05);
}

// Fill + text colour a brand gets on buttons, mirroring the theme rules below.
export function brandSwatch(hex, dark = false) {
  const hsl = hexToHsl(hex);
  if (!hsl) return { bg: dark ? "#fafafa" : "#111111", fg: dark ? "#0f0f0f" : "#ffffff" };
  if (dark && hsl.l < 15) return { bg: "#fafafa", fg: "#0f0f0f" };
  return { bg: hex, fg: prefersDarkText(hex) ? "#121212" : "#ffffff" };
}

// Apply a branding object to the document: CSS brand variables, primary
// colour, page title and favicon. Safe to call repeatedly.
export function applyBranding(branding) {
  if (typeof document === "undefined") return;
  const b = { ...DEFAULT_BRANDING, ...(branding || {}) };
  const root = document.documentElement;
  const color = b.brand_color || DEFAULT_BRANDING.brand_color;
  root.style.setProperty("--brand-a", color);
  root.style.setProperty("--brand-b", "#101010");
  const hsl = hexToHsl(color);
  if (hsl) {
    const primary = `${hsl.h} ${Math.max(hsl.s, 30)}% ${Math.min(hsl.l, 45)}%`;
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--ring", primary);
    root.style.setProperty("--accent", primary);
    root.style.setProperty("--chart-1", primary);
    root.style.setProperty("--brand-hsl", `${hsl.h} ${hsl.s}% ${hsl.l}%`);
    root.style.setProperty("--brand-fg", prefersDarkText(color) ? "0 0% 7%" : "0 0% 100%");
    // Near-black brands would vanish on the dark canvas; invert them there.
    const tooDark = hsl.l < 15;
    root.style.setProperty("--brand-hsl-dark", tooDark ? "0 0% 98%" : `${hsl.h} ${hsl.s}% ${hsl.l}%`);
    root.style.setProperty("--brand-fg-dark", tooDark ? "0 0% 6%" : prefersDarkText(color) ? "0 0% 7%" : "0 0% 100%");
  }
  if (b.app_name) document.title = b.app_name;
  // Favicon from logo (data URL or path). Falls back silently if none.
  try {
    if (b.logo_url) {
      let link = document.querySelector("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = b.logo_url;
    }
  } catch (e) { void e; }
}

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [enabledModules, setEnabledModules] = useState(null);

  // Theme the login page with the default/public branding on first load.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get("/branding");
        if (mounted && data?.branding) {
          setBranding((prev) => ({ ...DEFAULT_BRANDING, ...prev, ...data.branding }));
          applyBranding({ ...DEFAULT_BRANDING, ...data.branding });
        } else {
          applyBranding(DEFAULT_BRANDING);
        }
      } catch {
        applyBranding(DEFAULT_BRANDING);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const setBrandingData = useCallback((newBranding, modules) => {
    const merged = { ...DEFAULT_BRANDING, ...(newBranding || {}) };
    setBranding(merged);
    applyBranding(merged);
    if (modules !== undefined) setEnabledModules(modules || null);
  }, []);

  const resetBranding = useCallback(() => {
    setBranding(DEFAULT_BRANDING);
    setEnabledModules(null);
    // Re-pull the public default so the login page is themed correctly.
    api.get("/branding").then(({ data }) => {
      const b = { ...DEFAULT_BRANDING, ...(data?.branding || {}) };
      setBranding(b);
      applyBranding(b);
    }).catch(() => applyBranding(DEFAULT_BRANDING));
  }, []);

  const value = useMemo(
    () => ({ branding, enabledModules, setBrandingData, resetBranding }),
    [branding, enabledModules, setBrandingData, resetBranding],
  );

  return <BrandingCtx.Provider value={value}>{children}</BrandingCtx.Provider>;
}

export const useBranding = () => useContext(BrandingCtx);

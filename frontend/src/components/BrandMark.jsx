import React from "react";
import { useBranding } from "@/lib/branding";

// Renders the active company's logo, or a branded monogram fallback built
// from the app name initials. Used across the login page and app shell.
export default function BrandMark({ size = 44, rounded = "rounded-xl", className = "" }) {
  const { branding } = useBranding();
  const name = branding?.app_name || "EduConnect Pro";
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const dim = { width: size, height: size };

  if (branding?.logo_url) {
    return (
      <div
        className={`${rounded} bg-card border border-border flex items-center justify-center overflow-hidden shrink-0 ${className}`}
        style={dim}
      >
        <img
          src={branding.logo_url}
          alt={name}
          className="w-full h-full object-contain"
          style={{ padding: 2 }}
        />
      </div>
    );
  }

  return (
    <div
      className={`${rounded} bg-amber-gradient text-white flex items-center justify-center shrink-0 font-display font-bold ${className}`}
      style={{ ...dim, fontSize: size * 0.4 }}
      aria-label={name}
    >
      {initials}
    </div>
  );
}

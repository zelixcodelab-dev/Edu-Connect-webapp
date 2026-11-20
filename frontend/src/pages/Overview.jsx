import React, { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlass, X, ArrowElbowDownLeft } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import { greetingForNow } from "@/lib/format";
import { useTileAlerts } from "@/lib/useTileAlerts";
import { HubTile } from "@/pages/SectionHub";
import { launcherItems, sectionItems } from "@/pages/AppShell";
import Dashboard from "@/pages/Dashboard";

const LAUNCHER_ROLES = ["super_admin", "office_admin"];
const sectionKey = (item) => item.to.startsWith("/section/") ? item.to.split("/")[2] : null;

function TileSearch({ value, onChange, onEnter, inputRef }) {
  return (
    <div className="relative max-w-xl" data-testid="overview-search">
      <MagnifyingGlass size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search pages… (press / to focus)"
        onKeyDown={(e) => { if (e.key === "Enter") onEnter(); if (e.key === "Escape") onChange(""); }}
        data-testid="overview-search-input"
        className="w-full h-12 rounded-2xl border border-border bg-card pl-11 pr-24 text-sm outline-none focus:border-[hsl(var(--primary))]/50 focus:ring-4 focus:ring-[hsl(var(--primary))]/10 transition-[border-color,box-shadow]" />
      {value && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <span className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-md border border-border"><ArrowElbowDownLeft size={10} /> open</span>
          <button type="button" onClick={() => onChange("")} aria-label="Clear search" data-testid="overview-search-clear" className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

export default function Overview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [q, setQ] = useState("");
  const allowed = LAUNCHER_ROLES.includes(user?.role);
  const items = useMemo(() => (allowed ? launcherItems(user) : []), [user, allowed]);
  const alertFor = useTileAlerts((item) => sectionKey(item) && sectionItems(user, sectionKey(item)));
  const searchable = useMemo(() => {
    const seen = new Set();
    return items.flatMap((i) => [i, ...(sectionKey(i) ? sectionItems(user, sectionKey(i)) : [])])
      .filter((i) => !seen.has(i.tid) && seen.add(i.tid));
  }, [items, user]);
  const term = q.trim().toLowerCase();
  const shown = term ? searchable.filter((i) => `${i.label} ${i.blurb || ""}`.toLowerCase().includes(term)) : items;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!allowed) return <Dashboard />;
  return (
    <div className="space-y-6" data-testid="overview-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{greetingForNow()}</p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-1" data-testid="overview-greeting">Hi {user?.name?.split(" ")[0] || "there"}.</h1>
          <p className="text-sm text-muted-foreground mt-1">Where would you like to go today?</p>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="overview-count">{term ? `${shown.length} match${shown.length === 1 ? "" : "es"}` : `${items.length} destinations`}</p>
      </div>
      <TileSearch value={q} onChange={setQ} inputRef={inputRef} onEnter={() => shown[0] && navigate(shown[0].to)} />
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center" data-testid="overview-search-empty">No pages match "{q}"</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-5" data-testid="home-launcher-grid">
          {shown.map((item, i) => <HubTile key={item.tid} item={item} index={i} alert={alertFor(item)} />)}
        </div>
      )}
    </div>
  );
}

import React, { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlass, X, ArrowElbowDownLeft, ShareNetwork, QrCode } from "@phosphor-icons/react";
import { toast } from "sonner";
import { buildApplyUrl } from "@/lib/applyUrl";
import { ApplyQrDialog } from "@/components/ApplyQrDialog";
import { useAuth } from "@/lib/auth";
import { greetingForNow } from "@/lib/format";
import { useTileAlerts } from "@/lib/useTileAlerts";
import { HubTile, TileGrid } from "@/pages/SectionHub";
import OverviewStats from "@/components/dashboard/OverviewStats";
import { launcherItems, sectionItems, ITEM_BLURBS } from "@/pages/AppShell";
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

const ACTION_BTN = "inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-border bg-card text-sm font-medium hover:bg-muted transition-colors";

function ShareApplyActions({ user }) {
  const url = buildApplyUrl();
  const copy = () => navigator.clipboard.writeText(url).then(
    () => toast.success(`Public form link copied · ${url}`),
    () => { window.prompt("Copy the application link:", url); },
  );
  return (
    <div className="flex flex-wrap gap-2" data-testid="overview-share-actions">
      <button type="button" onClick={copy} className={ACTION_BTN} data-testid="share-apply-link-btn" title="Copy the public admission form link">
        <ShareNetwork size={16} /> Share application link
      </button>
      <ApplyQrDialog url={url} name={user?.branding?.app_name || user?.business_name} logo={user?.branding?.logo_url}
        color={user?.branding?.brand_color || "#111111"} testId="overview-apply-qr"
        trigger={<button type="button" data-testid="overview-apply-qr-open" className={ACTION_BTN}><QrCode size={16} /> QR</button>} />
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
  const shown = term
    ? [...searchable.filter((i) => i.label.toLowerCase().includes(term)),
       ...searchable.filter((i) => !i.label.toLowerCase().includes(term) && (i.blurb || ITEM_BLURBS[i.to] || "").toLowerCase().includes(term))]
    : items;

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
          <p className="text-sm text-muted-foreground mt-1">Your education business at a glance.</p>
        </div>
        <ShareApplyActions user={user} />
      </div>
      <OverviewStats />
      <TileSearch value={q} onChange={setQ} inputRef={inputRef} onEnter={() => shown[0] && navigate(shown[0].to)} />
      <div className="flex items-baseline justify-between !mt-8">
        <p className="font-display text-lg font-semibold tracking-tight" data-testid="overview-modules-title">{term ? "Search results" : "Workspace modules"}</p>
        <p className="text-xs text-muted-foreground" data-testid="overview-count">{term ? `${shown.length} match${shown.length === 1 ? "" : "es"}` : `${items.length} destinations`}</p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center" data-testid="overview-search-empty">No pages match "{q}"</p>
      ) : (
        <TileGrid testid="home-launcher-grid">
          {shown.map((item, i) => <HubTile key={item.tid} item={item} index={i} alert={alertFor(item)} featured={!term && item.to === "/dashboard"} />)}
        </TileGrid>
      )}
    </div>
  );
}

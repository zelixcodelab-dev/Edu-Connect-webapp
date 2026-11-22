import React, { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlass, X, ArrowElbowDownLeft, ShareNetwork, QrCode, WhatsappLogo, Tray } from "@phosphor-icons/react";
import { toast } from "sonner";
import { buildApplyUrl } from "@/lib/applyUrl";
import { ApplyQrDialog } from "@/components/ApplyQrDialog";
import { useAuth } from "@/lib/auth";
import { greetingForNow } from "@/lib/format";
import { useTileAlerts } from "@/lib/useTileAlerts";
import { HubTile, TileGrid } from "@/pages/SectionHub";
import OverviewStats, { useOverviewStats } from "@/components/dashboard/OverviewStats";
import { launcherItems, sectionItems, ITEM_BLURBS } from "@/pages/AppShell";
import Dashboard from "@/pages/Dashboard";

const LAUNCHER_ROLES = ["super_admin", "office_admin"];
const sectionKey = (item) => item.to.startsWith("/section/") ? item.to.split("/")[2] : null;

function TileSearch({ value, onChange, onEnter, inputRef }) {
  return (
    <div className="relative w-full sm:w-80" data-testid="overview-search">
      <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      {!value && <kbd className="hidden lg:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-md border border-border pointer-events-none">/</kbd>}
      <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search pages…"
        onKeyDown={(e) => { if (e.key === "Enter") onEnter(); if (e.key === "Escape") onChange(""); }}
        data-testid="overview-search-input"
        className={`w-full h-10 rounded-xl border border-border bg-card pl-10 ${value ? "pr-24" : "pr-9"} text-sm outline-none focus:border-[hsl(var(--primary))]/50 focus:ring-4 focus:ring-[hsl(var(--primary))]/10 transition-[border-color,box-shadow]`} />
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

function ShareApplyActions({ user, count }) {
  const url = buildApplyUrl();
  const brand = user?.branding?.app_name || user?.business_name || "us";
  const wa = `https://wa.me/?text=${encodeURIComponent(`Apply for admission with ${brand}: ${url}`)}`;
  const copy = () => navigator.clipboard.writeText(url).then(
    () => toast.success(`Public form link copied · ${url}`),
    () => { window.prompt("Copy the application link:", url); },
  );
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="overview-share-actions">
      {count != null && (
        <span className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-semibold" data-testid="overview-link-share-count" title="Applications received through the public form this month">
          <Tray size={15} weight="duotone" /> {count} application{count === 1 ? "" : "s"} this month
        </span>
      )}
      <button type="button" onClick={copy} className={ACTION_BTN} data-testid="share-apply-link-btn" title="Copy the public admission form link">
        <ShareNetwork size={16} /> Share application link
      </button>
      <a href={wa} target="_blank" rel="noopener noreferrer" data-testid="share-apply-whatsapp-btn" title="Send the application link on WhatsApp" aria-label="Share on WhatsApp"
        className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-[#25D366] text-white hover:brightness-95 transition-[filter]">
        <WhatsappLogo size={19} weight="fill" />
      </a>
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
  const stats = useOverviewStats();
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
    <div className="space-y-3" data-testid="overview-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{greetingForNow()}</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight" data-testid="overview-greeting">Hi {user?.name?.split(" ")[0] || "there"}.</h1>
          <p className="text-sm text-muted-foreground">Your education business at a glance.</p>
        </div>
        <ShareApplyActions user={user} count={stats?.applications_month} />
      </div>
      <OverviewStats d={stats} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <p className="font-display text-lg font-semibold tracking-tight" data-testid="overview-modules-title">{term ? "Search results" : "Workspace modules"}</p>
          <p className="text-xs text-muted-foreground" data-testid="overview-count">{term ? `${shown.length} match${shown.length === 1 ? "" : "es"}` : `${items.length} destinations`}</p>
        </div>
        <TileSearch value={q} onChange={setQ} inputRef={inputRef} onEnter={() => shown[0] && navigate(shown[0].to)} />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center" data-testid="overview-search-empty">No pages match "{q}"</p>
      ) : (
        <TileGrid testid="home-launcher-grid" wide>
          {shown.map((item, i) => <HubTile key={item.tid} item={item} index={i} alert={alertFor(item)} featured={!term && item.to === "/dashboard"} dense />)}
        </TileGrid>
      )}
    </div>
  );
}

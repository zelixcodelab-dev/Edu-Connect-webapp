import React from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowUpRight, ArrowRight } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import { sectionItems, GROUP_META, ITEM_BLURBS } from "@/pages/AppShell";
import { useTileAlerts } from "@/lib/useTileAlerts";

export const ACCENTS = { indigo: "#5969E8", violet: "#9176E8", cyan: "#38A8CE", emerald: "#27A783", amber: "#E5A342", coral: "#E47785", slate: "#64748B" };
const ACCENT_BY_PATH = {
  "/dashboard": "indigo", "/users": "indigo", "/office-overview": "indigo", "/staff": "indigo",
  "/admission-revenue": "amber", "/section/accounts": "amber", "/accounts": "amber", "/transactions": "amber", "/agents": "amber", "/invoices": "amber", "/quick-entry": "amber", "/sc-report": "amber", "/my-ledger": "amber",
  "/messages": "coral", "/expense-requests": "coral", "/activity": "coral",
  "/clients": "cyan", "/employees": "cyan", "/section/details": "cyan", "/colleges": "cyan", "/categories": "cyan",
  "/students": "emerald", "/my-students": "emerald", "/attendance": "emerald",
  "/section/office": "violet", "/branding": "violet", "/leads": "violet",
  "/settings": "slate",
};
export const accentFor = (to) => ACCENTS[ACCENT_BY_PATH[to] || "slate"];

function TileBadge({ item, alert }) {
  if (alert?.n > 0) {
    return (
      <span className="absolute top-4 right-4 flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_6px_14px_-4px_hsl(var(--primary)/0.6)]" data-testid={`hub-tile-alert-${item.tid}`}>
        <span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-current animate-ping opacity-75" /><span className="relative w-1.5 h-1.5 rounded-full bg-current" /></span>
        {alert.n > 99 ? "99+" : alert.n} {alert.label}
      </span>
    );
  }
  if (item.count > 0) return <span className="absolute top-4 right-4 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground" data-testid={`hub-tile-count-${item.tid}`}>{item.count} pages</span>;
  return <ArrowUpRight size={16} weight="bold" className="absolute top-4 right-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />;
}

export function HubTile({ item, index, alert = null, featured = false, dense = false, span = false }) {
  const Icon = item.icon;
  const c = accentFor(item.to);
  const blurb = featured ? "Business analytics and performance" : item.blurb || ITEM_BLURBS[item.to];
  return (
    <Link to={item.to} data-testid={`hub-tile-${item.tid}`}
      style={{ animationDelay: `${index * 50}ms`, ...(featured ? { backgroundImage: `linear-gradient(135deg, ${c}24, ${c}08)`, borderColor: `${c}40` } : {}) }}
      className={`hub-tile group relative flex flex-col rounded-[22px] border border-border bg-card ${dense ? "p-4 min-h-[100px]" : "p-5 min-h-[150px]"} shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:-translate-y-1 hover:shadow-[0_18px_36px_-20px_rgba(0,0,0,0.35)] transition-[transform,box-shadow] duration-300 ${featured || span ? "col-span-2" : ""}`}>
      <span className={`${dense ? "w-10 h-10" : "w-11 h-11"} rounded-[14px] flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3`} style={{ background: `${c}1f`, color: c }}>
        <Icon size={24} weight="duotone" />
      </span>
      {featured ? (
        <span className="absolute top-4 right-4 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: `${c}1f`, color: c }} data-testid="hub-tile-featured-tag">Overview</span>
      ) : <TileBadge item={item} alert={alert} />}
      <p className={`font-display font-semibold tracking-tight ${dense ? "mt-2.5" : "mt-4"} truncate ${featured ? (dense ? "text-xl" : "text-2xl") : "text-base"}`} data-testid={`hub-tile-label-${item.tid}`}>{item.label}</p>
      {blurb && <p className={`text-xs text-muted-foreground mt-0.5 ${dense ? "truncate" : "line-clamp-2"}`} title={blurb}>{blurb}</p>}
      {featured && (
        <span className={`mt-auto ${dense ? "pt-1.5" : "pt-3"} inline-flex items-center gap-1.5 text-sm font-semibold`} style={{ color: c }}>
          Explore workspace <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-1" />
        </span>
      )}
    </Link>
  );
}

export function TileGrid({ children, testid, wide = false }) {
  return <div className={`grid grid-cols-2 lg:grid-cols-4 ${wide ? "xl:grid-cols-5 sm:gap-3 grid-flow-row-dense" : "sm:gap-4"} gap-3`} data-testid={testid}>{children}</div>;
}

export default function SectionHub() {
  const { key } = useParams();
  const { user } = useAuth();
  const items = sectionItems(user, key);
  const alertFor = useTileAlerts();
  if (!items || !GROUP_META[key]) return <Navigate to="/" replace />;
  const meta = GROUP_META[key];
  return (
    <div className="space-y-6" data-testid={`section-hub-${key}`}>
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Section</p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-1" data-testid="section-hub-title">{meta.label}</h1>
        <p className="text-sm text-muted-foreground mt-1">{meta.blurb}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="section-hub-empty">No pages are enabled in this section.</p>
      ) : (
        <TileGrid testid="section-hub-grid">
          {items.map((item, i) => <HubTile key={item.tid} item={item} index={i} alert={alertFor(item)} />)}
        </TileGrid>
      )}
    </div>
  );
}

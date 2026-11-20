import React from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowUpRight } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import { sectionItems, GROUP_META, ITEM_BLURBS } from "@/pages/AppShell";
import { useTileAlerts } from "@/lib/useTileAlerts";

export function HubTile({ item, index, compact = false, alert = null }) {
  const Icon = item.icon;
  return (
    <Link to={item.to} data-testid={`hub-tile-${item.tid}`}
      style={{ animationDelay: `${index * 60}ms` }}
      className="hub-tile group relative flex flex-col rounded-[28px] border border-border bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:-translate-y-1 hover:shadow-[0_18px_40px_-18px_hsl(var(--primary)/0.45)] hover:border-[hsl(var(--primary))]/30 transition-[transform,box-shadow,border-color] duration-300">
      {item.count > 0 && <span className="absolute top-3 left-3 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]" data-testid={`hub-tile-count-${item.tid}`}>{item.count} pages</span>}
      {alert?.n > 0 ? (
        <span className="absolute top-3 right-3 flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-rose-500 text-white shadow-[0_6px_14px_-4px_rgba(244,63,94,0.6)]" data-testid={`hub-tile-alert-${item.tid}`}>
          <span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-white animate-ping opacity-75" /><span className="relative w-1.5 h-1.5 rounded-full bg-white" /></span>
          {alert.n > 99 ? "99+" : alert.n} {alert.label}
        </span>
      ) : (
        <ArrowUpRight size={16} weight="bold" className="absolute top-4 right-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
      <div className={`flex-1 flex items-center justify-center ${compact ? "py-5" : "py-8 sm:py-10"}`}>
        <div className={`relative ${compact ? "w-20 h-20" : "w-28 h-28 sm:w-32 sm:h-32"} rounded-full flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,hsl(var(--primary)/0.14),hsl(var(--primary)/0.03)_65%,transparent_72%)] ring-1 ring-[hsl(var(--primary))]/10`}>
          <div className="absolute inset-3 rounded-full bg-card/70 shadow-[inset_0_2px_10px_hsl(var(--primary)/0.08)]" />
          <Icon size={compact ? 44 : 64} weight="duotone" className="absolute text-[hsl(var(--primary))] opacity-40 translate-x-1.5 translate-y-1.5 blur-[1px]" />
          <Icon size={compact ? 40 : 60} weight="fill" className="relative text-[hsl(var(--primary))] drop-shadow-[0_10px_16px_hsl(var(--primary)/0.4)] group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-300" />
        </div>
      </div>
      <div className="rounded-2xl bg-[hsl(var(--primary))]/[0.06] group-hover:bg-[hsl(var(--primary))]/[0.1] px-4 py-3 text-center transition-colors">
        <p className={`font-display ${compact ? "text-sm" : "text-base"} font-semibold tracking-tight truncate`} data-testid={`hub-tile-label-${item.tid}`}>{item.label}</p>
        {(item.blurb || ITEM_BLURBS[item.to]) && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.blurb || ITEM_BLURBS[item.to]}</p>}
      </div>
    </Link>
  );
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
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-5" data-testid="section-hub-grid">
          {items.map((item, i) => <HubTile key={item.tid} item={item} index={i} alert={alertFor(item)} />)}
        </div>
      )}
    </div>
  );
}

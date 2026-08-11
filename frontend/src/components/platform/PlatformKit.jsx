import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ShieldAlert, Info, PauseCircle, ChevronRight, Loader2 } from "lucide-react";

// ── StatusBadge ─────────────────────────────────────────────
const STATUS_MAP = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  online: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  resolved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  trial: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  degraded: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  maintenance: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  suspended: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  offline: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  critical: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};
export function StatusBadge({ status, className = "" }) {
  const key = String(status || "").toLowerCase();
  const tone = STATUS_MAP[key] || "bg-muted text-muted-foreground";
  return (
    <span data-testid={`status-${key}`} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tone} ${className}`}>
      {status}
    </span>
  );
}

// ── StatCard ────────────────────────────────────────────────
export function StatCard({ icon: Icon, label, value, tint = "bg-primary/10 text-primary" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4" data-testid={`stat-${label}`}>
      {Icon && (
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${tint}`}>
          <Icon size={20} strokeWidth={2} />
        </div>
      )}
      <div>
        <p className="text-2xl font-display font-semibold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  );
}

// ── SectionHeader ───────────────────────────────────────────
export function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ── EmptyState ──────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, desc, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center" data-testid="empty-state">
      {Icon && (
        <div className="mx-auto w-14 h-14 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground mb-4">
          <Icon size={26} strokeWidth={1.75} />
        </div>
      )}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {desc && <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{desc}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── LoadingState ────────────────────────────────────────────
export function LoadingState({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm" data-testid="loading-state">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

// ── AttentionCard ───────────────────────────────────────────
const SEVERITY = {
  critical: { border: "border-l-rose-500", icon: ShieldAlert, tint: "text-rose-600 dark:text-rose-400" },
  warning: { border: "border-l-amber-500", icon: AlertTriangle, tint: "text-amber-600 dark:text-amber-400" },
  info: { border: "border-l-sky-500", icon: Info, tint: "text-sky-600 dark:text-sky-400" },
  pause: { border: "border-l-amber-500", icon: PauseCircle, tint: "text-amber-600 dark:text-amber-400" },
};
export function AttentionCard({ item, index = 0 }) {
  const nav = useNavigate();
  const cfg = SEVERITY[item.severity] || SEVERITY.info;
  const Icon = cfg.icon;
  return (
    <button
      onClick={() => item.link && nav(item.link)}
      data-testid={`attention-${item.id}`}
      style={{ animationDelay: `${index * 60}ms` }}
      className={`platform-fade-in group w-full text-left rounded-xl border border-border border-l-4 ${cfg.border} bg-card p-4 flex items-start gap-3 transition-all hover:shadow-md hover:border-primary/30`}
    >
      <div className={`mt-0.5 shrink-0 ${cfg.tint}`}><Icon size={18} strokeWidth={2} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug truncate">{item.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.subtitle}</p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
    </button>
  );
}

// ── Avatar ──────────────────────────────────────────────────
export function Avatar({ name = "", size = 36 }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <div className="rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0"
         style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials}
    </div>
  );
}

// ── PermissionGuard ─────────────────────────────────────────
export function useHasPermission(user) {
  const perms = user?.permissions;
  return React.useCallback((perm) => {
    if (!perm) return true;
    if (user?.role === "platform_owner" || !perms) return true; // owner ⇒ all
    return perms.includes(perm);
  }, [perms, user?.role]);
}

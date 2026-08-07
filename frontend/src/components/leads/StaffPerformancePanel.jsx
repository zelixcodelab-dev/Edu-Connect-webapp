/**
 * Staff Performance panel — CRM Overview (super_admin + office_admin).
 *
 * Live-updates every 30 seconds and lets the operator flip between Today /
 * Week / Month time windows. Each row shows:
 *   • Avatar + name + role/office chip
 *   • Total leads touched inside the window
 *   • Follow-ups + missed counts
 *   • A compact "status bar" — coloured segments proportional to the lead
 *     status distribution — plus per-status pills
 *   • A drill-down button that opens the touched leads in the shared lead
 *     detail dialog (via /leads?assigned_to=…&updated_since=…)
 */
import React, { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import UserAvatar from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LEAD_STATUS_META } from "./constants";
import {
  ChartLineUp,
  ClockCountdown,
  CircleNotch,
  Warning,
  ArrowSquareOut,
  CheckCircle,
} from "@phosphor-icons/react";

const WINDOWS = [
  ["live", "Live"],
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
];

// "Live" polls every 15s so the operator can watch activity roll in in
// near-real-time; the historical windows only need a gentle 60s refresh.
const REFRESH_MS = { live: 15_000, today: 60_000, week: 60_000, month: 60_000 };

// Ordered subset that dominates most pipelines — the segmented bar shows
// these in this order for a consistent visual footprint. Statuses NOT here
// still count toward "touched" and appear in the per-status pill row.
const BAR_STATUSES = [
  ["new", "bg-sky-500"],
  ["not_connected", "bg-slate-400"],
  ["interested", "bg-violet-500"],
  ["follow_up", "bg-blue-500"],
  ["converted", "bg-emerald-500"],
  ["application_submitted", "bg-teal-500"],
  ["admission_confirmed", "bg-indigo-500"],
  ["fee_paid", "bg-lime-500"],
  ["completed", "bg-green-500"],
  ["not_turned", "bg-orange-500"],
  ["lost", "bg-rose-500"],
];

function StatusBar({ byStatus, total }) {
  if (!total) {
    return (
      <div className="h-1.5 rounded-full bg-muted/60 w-full" data-testid="perf-status-bar-empty" />
    );
  }
  return (
    <div
      className="h-1.5 rounded-full overflow-hidden bg-muted/40 flex w-full"
      role="img"
      aria-label={`${total} leads touched`}
      data-testid="perf-status-bar"
    >
      {BAR_STATUSES.map(([key, cls]) => {
        const n = byStatus[key] || 0;
        if (!n) return null;
        const pct = (n / total) * 100;
        return (
          <div
            key={key}
            className={cls}
            style={{ width: `${pct}%` }}
            title={`${LEAD_STATUS_META[key]?.label || key}: ${n}`}
          />
        );
      })}
    </div>
  );
}

function TouchedLeadsDialog({ open, onOpenChange, staff, window: winProp }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !staff?.user_id) return;
    let cancel = false;
    setLoading(true);
    api
      .get(`/leads/staff-performance/${staff.user_id}`, { params: { window: winProp } })
      .then(({ data }) => {
        if (cancel) return;
        setRows(data?.leads || []);
      })
      .catch(() => { if (!cancel) setRows([]); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [open, staff?.user_id, winProp]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" data-testid="perf-drilldown-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2.5">
            <UserAvatar name={staff?.name} photoUrl={staff?.photo_url} size="md" />
            {staff?.name}
            <Badge className="bg-muted text-muted-foreground border-transparent ml-1">
              {WINDOWS.find((w) => w[0] === winProp)?.[1]}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Leads {staff?.name?.split(" ")[0] || "this staff"} worked on in the selected window.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto -mx-1">
          {loading ? (
            <div className="text-center py-8 text-sm text-muted-foreground" data-testid="perf-drilldown-loading">
              <CircleNotch className="animate-spin mx-auto mb-2" size={20} />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground" data-testid="perf-drilldown-empty">
              No leads touched in this window.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((l) => {
                const meta = LEAD_STATUS_META[l.status] || {};
                return (
                  <div key={l.id} className="px-3 py-2.5 flex items-center gap-3" data-testid={`perf-touched-lead-${l.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{l.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {l.phone || "no phone"}
                        {l.updated_at && (
                          <span className="ml-2">· updated {new Date(l.updated_at).toLocaleString()}</span>
                        )}
                      </p>
                    </div>
                    <Badge className={`text-[10px] border ${meta.cls || ""}`}>{meta.label || l.status}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function StaffPerformancePanel({ officeOverride = "all" }) {
  const [window, setWindow] = useState("live");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [drill, setDrill] = useState(null); // staff row

  const load = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const params = { window };
      if (officeOverride && officeOverride !== "all") {
        params.office = officeOverride;
      }
      const { data } = await api.get("/leads/staff-performance", { params });
      setRows(data?.staff || []);
      setRefreshedAt(new Date());
    } catch {
      setRows([]);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [window, officeOverride]);

  useEffect(() => {
    load();
    const ms = REFRESH_MS[window] || 60_000;
    const t = setInterval(() => load({ silent: true }), ms);
    return () => clearInterval(t);
  }, [load, window]);

  const refreshMs = REFRESH_MS[window] || 60_000;
  const refreshLabel = refreshMs >= 60_000
    ? `every ${Math.round(refreshMs / 1000)}s`
    : `every ${Math.round(refreshMs / 1000)}s`;
  const anyTouched = rows.some((r) => r.touched > 0);

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
      data-testid="staff-performance-panel"
    >
      <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center justify-center">
            <ChartLineUp size={18} weight="duotone" />
          </div>
          <div>
            <h3 className="font-display text-base sm:text-lg font-semibold leading-tight">Staff performance</h3>
            <p className="text-[11px] text-muted-foreground">
              Live · auto-refresh {refreshLabel}
              {refreshedAt && (
                <> · updated {refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 self-start sm:self-auto" data-testid="perf-window-chips">
          {WINDOWS.map(([v, label]) => {
            const active = window === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setWindow(v)}
                data-testid={`perf-window-${v}`}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v === "live" && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-500 animate-pulse" : "bg-emerald-500/40"}`}
                    data-testid="perf-live-dot"
                  />
                )}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-sm text-muted-foreground" data-testid="perf-loading">
          <CircleNotch className="animate-spin mx-auto mb-2" size={20} />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground" data-testid="perf-empty">
          No staff in scope yet.
        </div>
      ) : !anyTouched ? (
        <div className="text-center py-10 text-sm text-muted-foreground" data-testid="perf-idle">
          Nothing touched in this window yet — check back after your team starts working.
        </div>
      ) : (
        <div className="divide-y divide-border/70" data-testid="perf-rows">
          {rows.map((s) => (
            <div key={s.user_id} className="py-3 first:pt-0 last:pb-0" data-testid={`perf-row-${s.user_id}`}>
              <div className="flex items-center gap-3">
                <UserAvatar name={s.name} photoUrl={s.photo_url} size="lg" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.role === "office_admin" ? "Office Admin" : "Staff"}
                    {s.office && <> · {(s.office || "").replace("KM_", "KM ")}</>}
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-3 shrink-0">
                  <MetricPill icon={ChartLineUp} tone="amber" label="Touched" value={s.touched} testid={`perf-touched-${s.user_id}`} />
                  <MetricPill icon={ClockCountdown} tone="sky" label="Follow-ups" value={s.follow_ups} testid={`perf-followups-${s.user_id}`} />
                  <MetricPill icon={Warning} tone="rose" label="Missed" value={s.missed} testid={`perf-missed-${s.user_id}`} />
                  <MetricPill icon={CheckCircle} tone="emerald" label="Converted" value={s.by_status?.converted || 0} testid={`perf-converted-${s.user_id}`} />
                </div>
                {s.touched > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-1 shrink-0 h-8"
                    onClick={() => setDrill({ ...s })}
                    data-testid={`perf-drilldown-${s.user_id}`}
                  >
                    <ArrowSquareOut size={14} className="sm:mr-1.5" />
                    <span className="hidden sm:inline text-xs">View</span>
                  </Button>
                )}
              </div>
              {/* Mobile summary row */}
              <div className="flex sm:hidden items-center justify-between gap-2 mt-2 text-[11px]">
                <span className="font-semibold text-amber-700 dark:text-amber-300">{s.touched} touched</span>
                <span className="text-blue-600 dark:text-blue-300">{s.follow_ups} follow-ups</span>
                <span className="text-rose-600 dark:text-rose-300">{s.missed} missed</span>
                <span className="text-emerald-600 dark:text-emerald-400">{s.by_status?.converted || 0} converted</span>
              </div>
              <div className="mt-2.5">
                <StatusBar byStatus={s.by_status} total={s.touched} />
                {s.touched > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {BAR_STATUSES.map(([key]) => {
                      const n = s.by_status?.[key] || 0;
                      if (!n) return null;
                      const meta = LEAD_STATUS_META[key];
                      return (
                        <Badge
                          key={key}
                          className={`text-[10px] border ${meta?.cls || ""}`}
                          data-testid={`perf-pill-${s.user_id}-${key}`}
                        >
                          {meta?.label || key} · {n}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <TouchedLeadsDialog
        open={!!drill}
        onOpenChange={(v) => !v && setDrill(null)}
        staff={drill}
        window={window}
      />
    </section>
  );
}

function MetricPill({ icon: Icon, tone, label, value, testid }) {
  const cls = {
    amber: "text-amber-700 dark:text-amber-300",
    sky: "text-blue-600 dark:text-blue-300",
    rose: "text-rose-600 dark:text-rose-300",
    emerald: "text-emerald-600 dark:text-emerald-400",
  }[tone] || "text-foreground";
  return (
    <div className="flex items-center gap-1" data-testid={testid}>
      <Icon size={14} weight="duotone" className={cls} />
      <span className={`text-sm font-semibold ${cls}`}>{value}</span>
      <span className="text-[11px] text-muted-foreground hidden md:inline">{label}</span>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Funnel, TrendUp, XCircle, WarningCircle } from "@phosphor-icons/react";

const STAGES = [
  { key: "new", label: "New", bar: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" },
  { key: "not_connected", label: "Not Connected", bar: "bg-slate-500", text: "text-slate-600 dark:text-slate-400" },
  { key: "interested", label: "Interested", bar: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  { key: "follow_up", label: "Follow-up", bar: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  { key: "converted", label: "Converted", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  { key: "application_submitted", label: "Application Submitted", bar: "bg-teal-500", text: "text-teal-600 dark:text-teal-400" },
  { key: "admission_confirmed", label: "Admission Confirmed", bar: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400" },
  { key: "fee_paid", label: "Fee Paid", bar: "bg-lime-500", text: "text-lime-600 dark:text-lime-400" },
  { key: "completed", label: "Completed", bar: "bg-green-600", text: "text-green-700 dark:text-green-300" },
];

export default function LeadFunnel() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.get("/leads/stats")
      .then(({ data }) => setStats(data))
      .catch(() => setErr(true));
  }, []);

  if (err) return null;

  const by = stats?.by_status || {};
  const total = stats?.total ?? 0;
  const converted = by.converted || 0;
  const applicationSubmitted = by.application_submitted || 0;
  const admissionConfirmed = by.admission_confirmed || 0;
  const feePaid = by.fee_paid || 0;
  const completed = by.completed || 0;
  const enrolled = converted + applicationSubmitted + admissionConfirmed + feePaid + completed;
  const lost = by.lost || 0;
  const notTurned = by.not_turned || 0;
  const missed = stats?.missed ?? 0;
  const conversionRate = total > 0 ? Math.round((enrolled / total) * 100) : 0;
  const maxCount = Math.max(1, ...STAGES.map((s) => by[s.key] || 0));

  return (
    <Card className="border border-border bg-card rounded-xl shadow-none" data-testid="lead-funnel">
      <div className="p-6 flex items-center justify-between gap-3 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-orange-100/60 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center">
            <Funnel size={18} weight="duotone" />
          </div>
          <div>
            <p className="label-eyebrow">Leads CRM</p>
            <h3 className="font-display text-lg leading-none mt-1">Conversion funnel</h3>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl tabular-nums text-emerald-600 dark:text-emerald-400" data-testid="funnel-conversion-rate">{conversionRate}%</p>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end"><TrendUp size={12} /> conversion</p>
        </div>
      </div>

      <div className="p-6 space-y-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="funnel-empty">No leads yet. Add leads in the CRM to see the pipeline.</p>
        ) : (
          STAGES.map((s) => {
            const count = by[s.key] || 0;
            const pct = Math.round((count / maxCount) * 100);
            return (
              <div key={s.key} className="flex items-center gap-3" data-testid={`funnel-stage-${s.key}`}>
                <span className="w-20 text-xs text-muted-foreground shrink-0">{s.label}</span>
                <div className="flex-1 h-7 rounded-md bg-muted/60 overflow-hidden">
                  <div className={`h-full ${s.bar} rounded-md transition-all duration-500 flex items-center justify-end px-2`} style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}>
                    {count > 0 && <span className="text-[11px] font-semibold text-white tabular-nums">{count}</span>}
                  </div>
                </div>
                <span className={`w-8 text-right text-sm font-medium tabular-nums ${s.text}`}>{count}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="px-6 py-4 border-t border-border/60 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground"><span className="font-medium text-foreground tabular-nums">{total}</span> total leads</span>
        <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400" data-testid="funnel-lost"><XCircle size={14} weight="duotone" /> <span className="font-medium tabular-nums">{lost}</span> lost</span>
        {notTurned > 0 && (
          <span className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400" data-testid="funnel-not-turned"><WarningCircle size={14} weight="duotone" /> <span className="font-medium tabular-nums">{notTurned}</span> not turned</span>
        )}
        <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400" data-testid="funnel-missed"><WarningCircle size={14} weight="duotone" /> <span className="font-medium tabular-nums">{missed}</span> missed follow-ups</span>
      </div>
    </Card>
  );
}

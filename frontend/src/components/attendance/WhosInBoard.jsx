import React, { useCallback, useEffect, useMemo, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowsClockwise, Circle } from "@phosphor-icons/react";

const OFFICES = [
  { value: "all", label: "All offices" },
  { value: "KM_BLR", label: "KM Bangalore" },
  { value: "KM_TCR", label: "KM Thrissur" },
  { value: "KM_KMLY", label: "KM Kollam" },
];

const STATE_META = {
  in: { label: "In", dot: "bg-emerald-500", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  on_break: { label: "On break", dot: "bg-amber-500", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  checked_out: { label: "Checked out", dot: "bg-stone-400", cls: "bg-stone-400/10 text-stone-600 dark:text-stone-300 border-stone-400/30" },
  leave: { label: "Leave", dot: "bg-sky-500", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  absent: { label: "Absent", dot: "bg-rose-500", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
};

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—");

function CountPill({ label, value, dot }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <span className="text-lg font-bold tabular-nums text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export default function WhosInBoard({ user }) {
  const isSuper = user.role === "super_admin";
  const [office, setOffice] = useState("all");
  const [data, setData] = useState({ counts: {}, rows: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const q = isSuper && office !== "all" ? `?office=${office}` : "";
      const { data } = await api.get(`/attendance/board${q}`);
      setData(data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [office, isSuper]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const grouped = useMemo(() => {
    const g = {};
    (data.rows || []).forEach((r) => { (g[r.office || "—"] = g[r.office || "—"] || []).push(r); });
    return g;
  }, [data.rows]);

  const c = data.counts || {};

  return (
    <div className="space-y-5" data-testid="whos-in-board">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-2">
          <CountPill label="In" value={c.in || 0} dot="bg-emerald-500" />
          <CountPill label="On break" value={c.on_break || 0} dot="bg-amber-500" />
          <CountPill label="Absent" value={c.absent || 0} dot="bg-rose-500" />
          <CountPill label="Leave" value={c.leave || 0} dot="bg-sky-500" />
          <CountPill label="Checked out" value={c.checked_out || 0} dot="bg-stone-400" />
        </div>
        <div className="flex items-center gap-2">
          {isSuper && (
            <select
              value={office}
              onChange={(e) => setOffice(e.target.value)}
              data-testid="board-office"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              {OFFICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          <button onClick={load} data-testid="board-refresh" className="h-9 px-3 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
            <ArrowsClockwise size={15} /> Refresh
          </button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2 flex items-center gap-1"><Circle size={8} weight="fill" className="text-emerald-500 animate-pulse" /> Live · auto-refreshes every 30s</p>

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">Loading…</Card>
      ) : (data.rows || []).length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">No staff in scope.</Card>
      ) : (
        Object.entries(grouped).map(([off, rows]) => (
          <div key={off}>
            {isSuper && <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{off}</p>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid={`board-group-${off}`}>
              {rows.map((r) => {
                const meta = STATE_META[r.state] || STATE_META.absent;
                return (
                  <div key={r.user_id} data-testid={`board-row-${r.user_id}`} className={`flex items-center justify-between gap-2 p-3 rounded-xl border ${meta.cls}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.role === "office_admin" ? "Office Admin" : "Staff"}
                        {r.check_in ? ` · in ${fmtTime(r.check_in)}` : ""}
                        {r.check_out ? ` · out ${fmtTime(r.check_out)}` : ""}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0">
                      <span className={`h-2 w-2 rounded-full ${meta.dot} ${r.state === "on_break" ? "animate-pulse" : ""}`} /> {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

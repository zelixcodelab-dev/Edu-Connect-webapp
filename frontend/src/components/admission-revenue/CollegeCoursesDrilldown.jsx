import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { CurrencyInr, BookOpen, Buildings, Warning, TrendUp, Coins } from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

const fmtInr = (n) => formatMoney(n || 0, "INR").replace(/^[₹$€£¥]\s?/, "");

/**
 * Course-wise revenue drilldown for a single college in the given FY.
 * Fetched from GET /api/admission-revenue/college-courses?college=&fy=
 *
 * Props:
 *   college  the exact college name to drill into (null = dialog closed)
 *   fy       the currently-selected FY label (e.g. "2026-27")
 *   onClose  called when the user dismisses the dialog
 */
export default function CollegeCoursesDrilldown({ college, fy, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const open = Boolean(college);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setData(null);
      try {
        const r = await api.get("/admission-revenue/college-courses", {
          params: { college, fy },
        });
        if (!cancelled) setData(r.data);
      } catch (err) {
        if (!cancelled) toast.error("Could not load courses for this college");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, college, fy]);

  const courses = data?.courses || [];
  const totals = data?.totals || {};

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent
        className="bg-card max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="college-courses-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2">
            <Buildings size={20} className="text-amber-700 dark:text-amber-400 mt-0.5" />
            <span className="truncate">{data?.college || college}</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Course-wise revenue for FY {data?.fy || fy}.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground text-center py-8">No data.</p>
        ) : (
          <>
            {/* Grand totals mini cards */}
            <div className="grid grid-cols-3 gap-2" data-testid="drill-totals">
              <MiniStat
                icon={TrendUp}
                label="Admissions"
                value={totals.count || 0}
                accent="orange"
                testid="drill-total-count"
              />
              <MiniStat
                icon={CurrencyInr}
                label="In · from college"
                value={`₹ ${fmtInr(totals.amount)}`}
                accent="orange"
                testid="drill-total-in"
              />
              <MiniStat
                icon={Coins}
                label="Net revenue"
                value={`₹ ${fmtInr(totals.net)}`}
                accent={(totals.net || 0) >= 0 ? "emerald" : "rose"}
                testid="drill-total-net"
              />
            </div>

            {/* Course rows */}
            <Card className="p-3 border border-border bg-card shadow-none mt-3">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen size={14} className="text-muted-foreground" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Course breakdown
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {courses.length} course{courses.length === 1 ? "" : "s"}
                </span>
              </div>
              {courses.length === 0 ? (
                <div
                  className="text-center py-8 text-sm text-muted-foreground flex flex-col items-center gap-2"
                  data-testid="drill-empty"
                >
                  <Warning size={20} className="text-muted-foreground/60" />
                  No admissions found for this college in FY {data.fy}.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left py-1.5 pl-1 font-semibold">Course</th>
                      <th className="text-right py-1.5 font-semibold w-10">#</th>
                      <th className="text-right py-1.5 font-semibold whitespace-nowrap">In (₹)</th>
                      <th className="text-right py-1.5 font-semibold whitespace-nowrap">Out (₹)</th>
                      <th className="text-right py-1.5 pr-1 font-semibold whitespace-nowrap">Net (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {courses.map((r, idx) => {
                      const netVal = Number(r.net || 0);
                      const netCls = netVal > 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : netVal < 0
                          ? "text-rose-700 dark:text-rose-400"
                          : "text-muted-foreground";
                      return (
                        <tr
                          key={`${r.course}-${idx}`}
                          data-testid={`drill-row-${idx}`}
                          className="hover:bg-muted/40 transition-colors"
                        >
                          <td className="py-1.5 pl-1 truncate max-w-[240px]" title={r.course}>
                            {r.course}
                          </td>
                          <td className="text-right py-1.5 tabular-nums text-muted-foreground">
                            {r.count}
                          </td>
                          <td className="text-right py-1.5 tabular-nums whitespace-nowrap pl-3">
                            {fmtInr(r.amount)}
                          </td>
                          <td className="text-right py-1.5 tabular-nums whitespace-nowrap text-rose-700/80 dark:text-rose-400/80 pl-3">
                            {fmtInr(r.sc_out)}
                          </td>
                          <td className={`text-right py-1.5 pr-1 tabular-nums whitespace-nowrap font-medium pl-3 ${netCls}`}>
                            {fmtInr(netVal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>

            <p className="text-[10px] text-muted-foreground text-right mt-2">
              Range · {data.range?.start} → {data.range?.end}. Only students with status{" "}
              <code className="px-1 rounded bg-muted">enrolled</code> or{" "}
              <code className="px-1 rounded bg-muted">completed</code> are counted.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const MINI_TONE = {
  orange: "border-orange-500/40 bg-orange-500/5 text-orange-800 dark:text-orange-300",
  emerald: "border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300",
  rose: "border-rose-500/40 bg-rose-500/5 text-rose-800 dark:text-rose-300",
};

function MiniStat({ icon: Icon, label, value, accent = "orange", testid }) {
  const tone = MINI_TONE[accent] || MINI_TONE.orange;
  return (
    <div
      className={`p-2.5 rounded-lg border ${tone}`}
      data-testid={testid}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold opacity-80">
        <Icon size={11} weight="duotone" />
        {label}
      </div>
      <div className="mt-1 text-sm font-display tabular-nums font-semibold truncate" title={String(value)}>
        {value}
      </div>
    </div>
  );
}

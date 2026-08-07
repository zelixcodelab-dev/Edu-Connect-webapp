import React from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkle, ArrowRight, Buildings, Lightning, CheckCircle } from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";

const OFFICE_LABEL = { KM_BLR: "KM BLR", KM_TCR: "KM TCR", KM_KMLY: "KM KMLY" };

export default function StaffBreakdownList({ breakdown, loading, currency, onMarkPaid, onUnmarkPaid }) {
  return (
    <Card className="lg:col-span-2 p-5 rounded-xl border border-border shadow-none" data-testid="staff-breakdown">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="label-eyebrow">Admissions by staff</p>
          <h2 className="font-display text-lg mt-1">Who's bringing students in</h2>
        </div>
        <Link to="/clients" className="text-xs text-orange-600 dark:text-orange-400 inline-flex items-center gap-1 hover:text-orange-700">
          Manage staff <ArrowRight size={12} />
        </Link>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : breakdown.length === 0 ? (
        <div className="text-center py-10 space-y-3">
          <Sparkle size={28} weight="duotone" className="mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No admissions this window.</p>
          <p className="text-xs text-muted-foreground">Add staff in <Link to="/clients" className="text-orange-600 dark:text-orange-400 underline">Our Staff</Link> and reference them when enrolling students.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {breakdown.map((row) => (
            <details key={row.staff_id} className="rounded-lg border border-border bg-card overflow-hidden group" data-testid={`staff-row-${row.staff_id}`}>
              <summary className="cursor-pointer list-none flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="w-10 h-10 rounded-full bg-amber-gradient text-white text-sm font-semibold flex items-center justify-center shrink-0">
                  {(row.name || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-foreground truncate">{row.name}</p>
                    {row.office && (
                      <Badge variant="outline" className="text-[10px] py-0">
                        <Buildings size={10} className="mr-1" /> {OFFICE_LABEL[row.office] || row.office}
                      </Badge>
                    )}
                    {row.eligible_count > 0 && (
                      <Badge className="bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 text-[10px] py-0">
                        <Lightning size={10} className="mr-0.5" /> eligible
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.admissions_count} admission{row.admissions_count === 1 ? "" : "s"}
                    {row.eligible_count > 0 && ` · ${row.eligible_count} eligible`}
                    {row.eligible_incentive > 0 && ` · ₹${row.eligible_incentive}/admission`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display text-base font-semibold tabular-nums text-foreground">
                    {formatMoney(row.incentive_earned, currency)}
                  </p>
                  {row.incentive_pending > 0 && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400">
                      {formatMoney(row.incentive_pending, currency)} pending
                    </p>
                  )}
                </div>
              </summary>

              <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-2">
                {row.admissions.map((a) => (
                  <div key={a.student_id} className="flex items-center gap-3 text-sm" data-testid={`adm-${a.student_id}`}>
                    <Link to={`/students/${a.student_id}`} className="flex-1 min-w-0 hover:underline">
                      <p className="font-medium text-foreground truncate">{a.student_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {a.college || "—"} · {new Date(a.enrolled_at).toLocaleDateString()}
                      </p>
                    </Link>
                    {a.eligible ? (
                      a.incentive_paid ? (
                        <Button
                          size="sm" variant="outline"
                          data-testid={`unmark-${a.student_id}`}
                          onClick={() => onUnmarkPaid(a.student_id)}
                          className="h-7 text-[11px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                        >
                          <CheckCircle size={12} weight="fill" className="mr-1" /> Paid
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          data-testid={`mark-paid-${a.student_id}`}
                          onClick={() => onMarkPaid(a.student_id)}
                          className="h-7 text-[11px] btn-amber border-0 px-2"
                        >
                          Mark paid · {formatMoney(a.incentive_amount, currency)}
                        </Button>
                      )
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        not eligible yet
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}

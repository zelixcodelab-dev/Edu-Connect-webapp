import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAcademicYear } from "@/lib/academicYear";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInr, Coins, CheckCircle, Warning, ArrowsClockwise, Buildings, GraduationCap, ArrowLeft } from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

export default function SCReport() {
  const { user } = useAuth();
  const { year } = useAcademicYear();
  const nav = useNavigate();
  const currency = user?.currency || "INR";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/students/sc-by-college");
      setData(r.data);
    } catch {
      toast.error("Could not load the SC report");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year]);

  const totals = data?.totals || {};
  const rows = (data?.rows || []).filter((r) =>
    !q.trim() || r.college.toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in" data-testid="sc-report-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          {user?.role === "super_admin" && (
            <button
              type="button"
              onClick={() => nav("/admission-revenue")}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
              data-testid="sc-report-back"
            >
              <ArrowLeft size={14} /> Admission Revenue
            </button>
          )}
          <p className="label-eyebrow">Service Charge</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2 flex items-center gap-2">
            <Coins size={28} className="text-amber-700 dark:text-amber-400" weight="duotone" />
            College SC Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Service charge earned vs still pending, broken down by college for {year === "all" ? "all years" : `academic year ${year}`}.
          </p>
        </div>
        <Button type="button" variant="outline" size="icon" onClick={load} className="h-10 w-10 self-start" data-testid="sc-report-refresh" title="Refresh">
          <ArrowsClockwise size={14} />
        </Button>
      </header>

      {loading ? (
        <Card className="p-12 text-center text-sm text-muted-foreground bg-card border border-border shadow-none">Loading…</Card>
      ) : !data ? (
        <Card className="p-12 text-center text-sm text-muted-foreground bg-card border border-border shadow-none">No data.</Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard label="SC Earned" hint={`${totals.students || 0} admissions · ${totals.colleges || 0} colleges`} amount={totals.earned} currency={currency} accent="amber" icon={GraduationCap} testid="sc-kpi-earned" />
            <KpiCard label="SC Collected / Cleared" hint="Already adjusted or received" amount={totals.cleared} currency={currency} accent="emerald" icon={CheckCircle} testid="sc-kpi-cleared" />
            <KpiCard label="SC Pending" hint="Still to be collected" amount={totals.pending} currency={currency} accent="rose" icon={Warning} testid="sc-kpi-pending" />
          </div>

          <Card className="border border-border bg-card rounded-lg shadow-none overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <Buildings size={18} className="text-muted-foreground" />
                <h3 className="font-display text-lg">By college</h3>
              </div>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter colleges…"
                className="h-9 sm:w-64"
                data-testid="sc-report-search"
              />
            </div>
            {rows.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground" data-testid="sc-report-empty">No colleges match.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left bg-muted/40 border-b border-border">
                      <th className="px-6 py-3 label-eyebrow">College</th>
                      <th className="px-6 py-3 label-eyebrow text-right">Admissions</th>
                      <th className="px-6 py-3 label-eyebrow text-right">SC Earned</th>
                      <th className="px-6 py-3 label-eyebrow text-right">Cleared</th>
                      <th className="px-6 py-3 label-eyebrow text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r, idx) => (
                      <tr key={r.college} className="hover:bg-muted/40" data-testid={`sc-report-row-${idx}`}>
                        <td className="px-6 py-3 font-medium truncate max-w-[280px]" title={r.college}>
                          {r.college}
                          {r.cancelled > 0 && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400">{r.cancelled} cancelled</span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right tabular-nums text-muted-foreground">{r.students}</td>
                        <td className="px-6 py-3 text-right tabular-nums font-medium">{formatMoney(r.earned, currency)}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(r.cleared, currency)}</td>
                        <td className={`px-6 py-3 text-right tabular-nums font-medium ${r.pending > 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"}`}>{formatMoney(r.pending, currency)}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/40 font-medium">
                      <td className="px-6 py-3 label-eyebrow text-muted-foreground">Total</td>
                      <td className="px-6 py-3 text-right tabular-nums">{totals.students || 0}</td>
                      <td className="px-6 py-3 text-right tabular-nums" data-testid="sc-report-total-earned">{formatMoney(totals.earned, currency)}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(totals.cleared, currency)}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-rose-700 dark:text-rose-400" data-testid="sc-report-total-pending">{formatMoney(totals.pending, currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

const ACCENTS = {
  amber: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  emerald: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  rose: "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300",
};

function KpiCard({ label, hint, amount, currency, accent, icon: Icon, testid }) {
  return (
    <Card className={`p-5 border shadow-none ${ACCENTS[accent] || ACCENTS.amber}`} data-testid={testid}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
        <Icon size={18} weight="duotone" />
      </div>
      <div className="mt-3 font-display text-2xl sm:text-3xl tabular-nums flex items-center gap-1 text-foreground">
        <CurrencyInr size={20} className="text-muted-foreground" />
        {formatMoney(amount || 0, currency).replace(/^[₹$€£¥]\s?/, "")}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
    </Card>
  );
}

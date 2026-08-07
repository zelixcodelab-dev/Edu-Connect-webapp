import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { UsersThree, Briefcase, IdentificationBadge } from "@phosphor-icons/react";

const TYPE_META = {
  sub_agent: { label: "Sub Agent", icon: UsersThree, color: "bg-violet-100/60 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  associate: { label: "Associate", icon: Briefcase, color: "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  km: { label: "KM", icon: IdentificationBadge, color: "bg-sky-100/60 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400" },
};

export default function Agents() {
  const { user } = useAuth();
  const currency = user?.currency || "USD";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/students/agent-ledger")
      .then(({ data }) => setRows(data))
      .finally(() => setLoading(false));
  }, []);

  const totals = rows.reduce((acc, r) => ({
    received: acc.received + r.total_received,
    paid: acc.paid + r.paid_to_college,
    sc: acc.sc + r.sc_adjusted,
    holding: acc.holding + r.holding,
  }), { received: 0, paid: 0, sc: 0, holding: 0 });

  return (
    <div className="space-y-6 animate-fade-in" data-testid="agents-page">
      <header>
        <p className="label-eyebrow">Network</p>
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Sub-agent ledger</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How much money has flowed through each sub-agent, associate and KM — and how much they're still holding.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="agent-totals">
        <Tile label="Routed through" value={formatMoney(totals.received, currency)} />
        <Tile label="Paid to college" value={formatMoney(totals.paid, currency)} tone="info" />
        <Tile label="SC adjusted" value={formatMoney(totals.sc, currency)} tone="success" />
        <Tile label="Currently holding" value={formatMoney(totals.holding, currency)} tone={totals.holding > 0 ? "danger" : "default"} />
      </div>

      <Card className="border border-border bg-card rounded-lg shadow-none overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground" data-testid="loading">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground" data-testid="empty-agents">
            <UsersThree size={32} className="mx-auto text-muted-foreground/50 mb-3" />
            No sub-agent activity yet. Log a payment with a sub-agent / associate / KM route on a student to populate this view.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-muted/40 border-b border-border">
                  <th className="px-6 py-3 label-eyebrow">Agent</th>
                  <th className="px-6 py-3 label-eyebrow">Type</th>
                  <th className="px-6 py-3 label-eyebrow text-center">Students</th>
                  <th className="px-6 py-3 label-eyebrow text-center">Payments</th>
                  <th className="px-6 py-3 label-eyebrow text-right">Routed</th>
                  <th className="px-6 py-3 label-eyebrow text-right">→ College</th>
                  <th className="px-6 py-3 label-eyebrow text-right">SC Adjusted</th>
                  <th className="px-6 py-3 label-eyebrow text-right">Holding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => {
                  const meta = TYPE_META[r.type] || TYPE_META.sub_agent;
                  const Icon = meta.icon;
                  return (
                    <tr key={`${r.type}-${r.name}-${i}`} className="hover:bg-muted/40" data-testid={`agent-row-${r.type}-${r.name.replace(/\W+/g, "-")}`}>
                      <td className="px-6 py-3.5 font-medium">{r.name}</td>
                      <td className="px-6 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.color}`}>
                          <Icon size={12} /> {meta.label}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-center text-muted-foreground">{r.students_count}</td>
                      <td className="px-6 py-3.5 text-center text-muted-foreground">{r.payments_count}</td>
                      <td className="px-6 py-3.5 text-right tabular-nums font-medium">{formatMoney(r.total_received, currency)}</td>
                      <td className="px-6 py-3.5 text-right tabular-nums text-sky-700 dark:text-sky-400">{formatMoney(r.paid_to_college, currency)}</td>
                      <td className="px-6 py-3.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(r.sc_adjusted, currency)}</td>
                      <td className={`px-6 py-3.5 text-right tabular-nums font-medium ${r.holding > 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"}`}>{formatMoney(r.holding, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value, tone }) {
  return (
    <Card className="p-4 border border-border bg-card rounded-lg shadow-none">
      <p className="label-eyebrow">{label}</p>
      <p className={`font-display text-2xl mt-2 tabular-nums ${
        tone === "success" ? "text-emerald-700 dark:text-emerald-400" :
        tone === "danger" ? "text-rose-700 dark:text-rose-400" :
        tone === "info" ? "text-sky-700 dark:text-sky-400" : "text-foreground"
      }`}>{value}</p>
    </Card>
  );
}

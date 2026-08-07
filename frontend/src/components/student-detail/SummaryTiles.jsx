import React from "react";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";

function Tile({ label, value, tone, hint, "data-testid": tid }) {
  return (
    <Card className="p-4 border border-border bg-card rounded-lg shadow-none" data-testid={tid}>
      <p className="label-eyebrow">{label}</p>
      <p className={`font-display text-2xl mt-2 tabular-nums ${tone === "success" ? "text-emerald-700 dark:text-emerald-400" : tone === "danger" ? "text-rose-700 dark:text-rose-400" : "text-foreground"}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1.5">{hint}</p>}
    </Card>
  );
}

export default function SummaryTiles({ s, currency }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="summary-tiles">
      <Tile
        label="SC Earned"
        value={formatMoney(s.sc_earned_effective ?? s.sc_out_fixed, currency)}
        hint={s.scholarship_amount > 0 ? `After scholarship · ${formatMoney(s.scholarship_amount, currency)}` : null}
        data-testid="tile-sc-earned"
      />
      <Tile
        label="Scheduled Total"
        value={formatMoney(Math.max(0, (s.scheduled_total || 0) - (s.collected_total || 0)), currency)}
        hint={s.collected_total > 0 ? `${formatMoney(s.collected_total, currency)} of ${formatMoney(s.scheduled_total, currency)} collected` : `Total scheduled · ${formatMoney(s.scheduled_total, currency)}`}
        data-testid="tile-scheduled-total"
      />
      <Tile
        label="Collected"
        value={formatMoney(s.collected_total, currency)}
        tone="success"
        data-testid="tile-collected"
      />
      <Tile
        label="Balance vs SC Earned"
        value={formatMoney(s.balance_vs_sc, currency)}
        tone={s.balance_vs_sc > 0 ? "danger" : "default"}
        hint={s.sc_adjusted_total > 0 ? `After SC adjusted · ${formatMoney(s.sc_adjusted_total, currency)}` : null}
        data-testid="tile-balance-vs-sc"
      />
    </div>
  );
}

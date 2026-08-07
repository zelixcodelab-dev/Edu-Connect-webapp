import React from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CurrencyInr, Cake, Lightning, ArrowRight, Plus, Calendar } from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";

export function AccountsMiniCard({ accounts, currency }) {
  const totalBalance = accounts.reduce((s, a) => s + (a.current_balance ?? a.opening_balance ?? 0), 0);
  return (
    <Card className="p-5 rounded-xl border border-border shadow-none" data-testid="accounts-mini">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
            <CurrencyInr size={16} weight="duotone" />
          </div>
          <div>
            <p className="label-eyebrow">Your books</p>
            <h2 className="font-display text-base">Accounts</h2>
          </div>
        </div>
        <Link to="/accounts" className="text-[11px] text-orange-600 dark:text-orange-400 hover:text-orange-700 inline-flex items-center gap-0.5">
          Manage <ArrowRight size={11} />
        </Link>
      </div>
      {accounts.length === 0 ? (
        <div className="text-center py-4 space-y-2" data-testid="accounts-mini-empty">
          <p className="text-xs text-muted-foreground">No accounts yet.</p>
          <Link to="/accounts" className="inline-flex items-center gap-1 text-xs text-orange-700 dark:text-orange-400 font-medium hover:underline">
            <Plus size={12} /> Add your first
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-1.5" data-testid="accounts-mini-list">
            {accounts.slice(0, 4).map((a) => (
              <div key={a.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/40" data-testid={`acc-mini-${a.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: a.color || "#10b981" }} />
                  <span className="text-sm font-medium truncate">{a.name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{(a.type || "").replace("_", " ")}</span>
                </div>
                <span className="text-sm font-display tabular-nums shrink-0">{formatMoney(a.current_balance ?? a.opening_balance ?? 0, currency)}</span>
              </div>
            ))}
          </div>
          {accounts.length > 4 && (
            <Link to="/accounts" className="block text-[11px] text-center text-muted-foreground hover:text-foreground mt-2">
              +{accounts.length - 4} more
            </Link>
          )}
          <div className="border-t border-border mt-3 pt-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Total balance</span>
            <span className="font-display text-base font-semibold tabular-nums">
              {formatMoney(totalBalance, currency)}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

export function UpcomingBirthdaysCard({ birthdays }) {
  return (
    <Card className="p-5 rounded-xl border border-border shadow-none" data-testid="upcoming-birthdays">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 flex items-center justify-center">
          <Cake size={16} weight="duotone" />
        </div>
        <div>
          <p className="label-eyebrow">Coming up</p>
          <h2 className="font-display text-base">Birthdays · next 30 days</h2>
        </div>
      </div>
      {birthdays.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          No birthdays in the next 30 days.
        </p>
      ) : (
        <div className="space-y-2">
          {birthdays.map((b) => (
            <div key={b.staff_id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/40" data-testid={`bday-${b.staff_id}`}>
              <Cake size={16} className="text-rose-600 dark:text-rose-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{b.name}</p>
                <p className="text-[11px] text-muted-foreground">{new Date(b.date_of_birth).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
              </div>
              <Badge className="bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border-0 text-[10px]">
                {b.days_until === 0 ? "Today!" : b.days_until === 1 ? "Tomorrow" : `in ${b.days_until}d`}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function IncentiveRuleCard({ onAddAdmission }) {
  return (
    <Card className="p-5 rounded-xl bg-amber-gradient-soft border border-amber-500/20" data-testid="incentive-rule-card">
      <Lightning size={20} weight="duotone" className="text-amber-700 dark:text-amber-400" />
      <h3 className="font-display text-base mt-3">Incentive rule</h3>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        Each staff member becomes <span className="text-foreground font-medium">eligible</span> for their per-admission incentive after their <span className="text-foreground font-medium">3rd admission in a month</span>. The first two admissions get backdated automatically.
      </p>
      <button
        type="button"
        onClick={onAddAdmission}
        data-testid="add-admission-btn"
        className="inline-flex items-center gap-1 mt-3 text-xs text-orange-700 dark:text-orange-400 font-medium hover:underline"
      >
        <Calendar size={12} /> Add an admission
      </button>
    </Card>
  );
}

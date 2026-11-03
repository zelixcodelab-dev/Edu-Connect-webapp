import React, { useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle, PencilSimple, ArrowCounterClockwise } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PAYMENT_MODES } from "@/components/student-detail/constants";
import ScSettlementDialog from "@/components/student-detail/ScSettlementDialog";

export default function ScSettlementCard({ s, accounts, currency, onChanged }) {
  const [open, setOpen] = useState(false);
  const st = s.sc_settlement;
  const earned = Number(s.sc_earned_effective || 0);
  if (!st && earned <= 0) return null;
  const accName = st ? accounts.find((a) => a.id === st.account_id)?.name : null;

  const undo = async () => {
    if (!window.confirm("Undo SC Settled? The credit will be removed from the account.")) return;
    try {
      await api.delete(`/students/${s.id}/sc-settlement`, { skipCelebration: true });
      toast.success("SC settlement undone");
      onChanged();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <Card className="border border-border bg-card rounded-lg shadow-none px-6 py-4 flex flex-wrap items-center justify-between gap-3" data-testid="sc-settlement-card">
      <div className="min-w-0">
        <p className="label-eyebrow">Service charge from college</p>
        {st ? (
          <p className="text-sm mt-1 flex items-center gap-1.5 flex-wrap" data-testid="sc-settled-info">
            <CheckCircle size={16} weight="fill" className="text-emerald-600" />
            <span className="font-medium text-emerald-700 dark:text-emerald-400">SC Settled</span>
            <span className="tabular-nums font-medium">{formatMoney(st.amount, currency)}</span>
            <span className="text-muted-foreground">
              · {accName || "account"} · {formatDate(st.date)}
              {st.payment_mode ? ` · ${PAYMENT_MODES.find((m) => m.value === st.payment_mode)?.label || st.payment_mode}` : ""}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">SC earned {formatMoney(earned, currency)} · not yet received</p>
        )}
      </div>
      {st ? (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={() => setOpen(true)} data-testid="sc-settle-edit-btn">
            <PencilSimple size={14} className="mr-1.5" /> Edit
          </Button>
          <Button variant="outline" size="sm" className="h-9" onClick={undo} data-testid="sc-settle-undo-btn">
            <ArrowCounterClockwise size={14} className="mr-1.5" /> Undo SC Settled
          </Button>
        </div>
      ) : (
        <Button className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setOpen(true)} data-testid="sc-settle-btn">
          <CheckCircle size={15} className="mr-1.5" /> Mark SC Settled
        </Button>
      )}
      <ScSettlementDialog open={open} onOpenChange={setOpen} s={s} accounts={accounts} onSaved={onChanged} />
    </Card>
  );
}

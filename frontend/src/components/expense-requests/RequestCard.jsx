import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle, XCircle, ClockClockwise, CurrencyInr, Buildings, X, ArrowRight,
} from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";

const OFFICE_LABEL = { KM_BLR: "KM BLR", KM_TCR: "KM TCR", KM_KMLY: "KM KMLY" };
const STATUS_STYLE = {
  pending: "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

export default function RequestCard({ r, isSuper, currency, onApprove, onReject, onCancel }) {
  return (
    <Card className="p-5 space-y-3" data-testid={`req-card-${r.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-display text-2xl font-semibold tabular-nums">
              {formatMoney(r.amount, currency)}
            </p>
            <Badge className={`${STATUS_STYLE[r.status] || ""} border-0`}>{r.status}</Badge>
            {r.kind === "salary" && <Badge variant="outline">salary</Badge>}
            {r.urgency === "urgent" && (
              <Badge className="bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border-0">urgent</Badge>
            )}
          </div>
          {r.description && <p className="text-sm text-foreground mt-1">{r.description}</p>}
          <p className="text-xs text-muted-foreground mt-1.5">
            {new Date(r.date).toLocaleDateString()}
            {isSuper && r.requested_by_name && (
              <> · by <span className="font-medium">{r.requested_by_name}</span></>
            )}
            {r.requester_office && (
              <> · <span className="inline-flex items-center gap-1"><Buildings size={11} /> {OFFICE_LABEL[r.requester_office]}</span></>
            )}
          </p>
          {r.decision_note && r.status !== "pending" && (
            <p className="text-xs text-muted-foreground mt-1 italic">Note: {r.decision_note}</p>
          )}
        </div>
        <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
          <CurrencyInr size={18} weight="duotone" />
        </div>
      </div>

      {r.status === "pending" && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          {isSuper ? (
            <>
              <Button size="sm" onClick={() => onApprove(r)} data-testid={`approve-${r.id}`} className="btn-amber border-0 h-8 flex-1">
                <CheckCircle size={14} className="mr-1" /> Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => onReject(r)} data-testid={`reject-${r.id}`} className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">
                <XCircle size={14} className="mr-1" /> Reject
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <ClockClockwise size={12} /> Awaiting super-admin
              </span>
              <Button size="sm" variant="ghost" onClick={() => onCancel(r)} data-testid={`cancel-${r.id}`} className="ml-auto h-8 text-muted-foreground hover:text-rose-600">
                <X size={14} className="mr-1" /> Cancel
              </Button>
            </>
          )}
        </div>
      )}
      {r.status === "approved" && r.linked_transaction_id && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1.5 pt-2 border-t border-border">
          <CheckCircle size={12} weight="fill" /> Logged as expense transaction <ArrowRight size={11} />
        </p>
      )}
    </Card>
  );
}

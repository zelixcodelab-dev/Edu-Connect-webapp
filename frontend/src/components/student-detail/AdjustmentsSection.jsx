import React, { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";
import { ADJUSTMENT_KIND_OPTIONS, emptyAdjustment } from "./constants";

/**
 * Reusable adjustments block — each row picks a destination:
 *   KM Foundation       → internal Accounts dropdown
 *   Sub Agent           → Sub-agent clients dropdown
 *   Associate Consultant → Associate-consultant clients dropdown
 *
 * Date + Amount + Remarks fields follow.
 *
 * Props:
 *  - adjustments, hasAdjustment, onToggleHas, onChange(idx,key,value),
 *    onAdd, onRemove, amount, currency
 *  - accounts: internal accounts list (Cash / Bank / etc.)
 *  - clients:  list of Client objects (used for Sub-Agent / Associate dropdowns)
 *  - testIdPrefix, paymentDate
 */
export default function AdjustmentsSection({
  adjustments,
  hasAdjustment,
  onToggleHas,
  onChange,
  onAdd,
  onRemove,
  amount,
  currency,
  accounts = [],
  clients = [],
  testIdPrefix = "adj",
  paymentDate,
}) {
  const adjTotal = adjustments.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  const balance = (parseFloat(amount) || 0) - adjTotal;

  const subAgents = useMemo(
    () => clients.filter((c) => c.client_type === "sub_agent_associate"),
    [clients],
  );
  const consultants = useMemo(
    () => clients.filter((c) => c.client_type === "associate_consultant"),
    [clients],
  );

  const onKindChange = (idx, nextKind) => {
    // Reset the dependent target field when the kind flips so we don't keep
    // a stale client_id selected on KM Foundation, etc. Apply ALL changes
    // in one onChange call to avoid stale-state races (each setState in the
    // parent reads from a frozen closure of `adjustments`).
    onChange(idx, {
      kind: nextKind,
      account_id: "",
      client_id: "",
      sub_agent_name: "",
    });
  };

  const onTargetChange = (idx, kind, value) => {
    if (kind === "km_foundation") {
      onChange(idx, { account_id: value });
      return;
    }
    // sub_agent / associate_consultant — value is a client_id
    const pool = kind === "sub_agent" ? subAgents : consultants;
    const picked = pool.find((c) => c.id === value);
    onChange(idx, {
      client_id: value,
      sub_agent_name: picked ? picked.name : "",
    });
  };

  return (
    <div className="rounded-md border border-border p-4 space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <Checkbox
          checked={!!hasAdjustment}
          onCheckedChange={(v) => {
            const seed =
              adjustments.length === 0 ? [emptyAdjustment(paymentDate)] : adjustments;
            onToggleHas(!!v, !!v ? seed : adjustments);
          }}
          data-testid={`${testIdPrefix}-has`}
          className="mt-1"
        />
        <div className="flex-1">
          <p className="text-sm font-medium">This payment has an adjustment</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Split the amount across KM Foundation account, Sub-Agent or Associate Consultant.
          </p>
        </div>
      </label>

      {hasAdjustment && (
        <div className="space-y-3 pt-2 border-t border-border" data-testid={`${testIdPrefix}-block`}>
          {adjustments.map((adj, idx) => (
            <div
              key={adj._key || idx}
              className="rounded-md bg-muted/40 p-3 space-y-2"
              data-testid={`${testIdPrefix}-row-${idx}`}
            >
              <div className="grid grid-cols-12 gap-2 items-start">
                {/* Kind */}
                <Select value={adj.kind} onValueChange={(v) => onKindChange(idx, v)}>
                  <SelectTrigger
                    className="col-span-5"
                    data-testid={`${testIdPrefix}-kind-${idx}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ADJUSTMENT_KIND_OPTIONS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Target (conditional) */}
                {adj.kind === "km_foundation" ? (
                  <Select
                    value={adj.account_id || ""}
                    onValueChange={(v) => onTargetChange(idx, "km_foundation", v)}
                  >
                    <SelectTrigger
                      className="col-span-6"
                      data-testid={`${testIdPrefix}-account-${idx}`}
                    >
                      <SelectValue placeholder="Pick internal account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          No internal accounts found.
                        </div>
                      ) : (
                        accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select
                    value={adj.client_id || ""}
                    onValueChange={(v) => onTargetChange(idx, adj.kind, v)}
                  >
                    <SelectTrigger
                      className="col-span-6"
                      data-testid={`${testIdPrefix}-client-${idx}`}
                    >
                      <SelectValue
                        placeholder={
                          adj.kind === "sub_agent" ? "Pick sub-agent" : "Pick consultant"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(adj.kind === "sub_agent" ? subAgents : consultants).length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          No matching clients on file.
                        </div>
                      ) : (
                        (adj.kind === "sub_agent" ? subAgents : consultants).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}

                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="col-span-1 h-10 flex items-center justify-center text-muted-foreground/70 hover:text-rose-700 dark:text-rose-400"
                  data-testid={`${testIdPrefix}-remove-${idx}`}
                  aria-label="Remove adjustment row"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Date + Amount */}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={adj.payment_date}
                  onChange={(e) => onChange(idx, "payment_date", e.target.value)}
                  data-testid={`${testIdPrefix}-date-${idx}`}
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Amount"
                  value={adj.amount}
                  onChange={(e) => onChange(idx, "amount", e.target.value)}
                  data-testid={`${testIdPrefix}-amount-${idx}`}
                />
              </div>

              <Input
                value={adj.remarks}
                onChange={(e) => onChange(idx, "remarks", e.target.value)}
                placeholder="Remarks"
                data-testid={`${testIdPrefix}-remarks-${idx}`}
              />
            </div>
          ))}

          <div className="flex items-center justify-between">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onAdd}
              data-testid={`${testIdPrefix}-add`}
            >
              <Plus size={14} className="mr-1" /> Add adjustment row
            </Button>
            <span
              className={`text-xs tabular-nums ${
                Math.abs(balance) < 0.01
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-700 dark:text-rose-400"
              }`}
              data-testid={`${testIdPrefix}-balance`}
            >
              Adjustments {formatMoney(adjTotal, currency)} of{" "}
              {formatMoney(parseFloat(amount) || 0, currency)} ·{" "}
              Δ {formatMoney(balance, currency)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

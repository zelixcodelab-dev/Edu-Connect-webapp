import React, { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AdjustmentsSection from "./AdjustmentsSection";
import {
  emptyAdjustment,
  FEE_TYPE_OPTIONS,
  SC_ADJUSTED_CLIENT_TYPES,
  CLIENT_TYPE_LABEL,
  CLIENT_TYPE_TO_RECEIVED_TYPE,
} from "./constants";
import { formatMoney } from "@/lib/format";

const RECEIVED_IN_TYPES = [
  { value: "college", label: "College Acc." },
  { value: "bank", label: "Other Bank Acc." },
];

/**
 * Single "Add Payment / Edit Payment" dialog.
 *
 * Fee Type "SC Adjusted" replaces the "Collected in" controls with a
 * Sub-Agent / Consultant / KM-Office client picker — the chosen client's
 * type is stored as received_in.type ("sub_agent" | "associate" | "km")
 * so the existing agent-ledger aggregation keeps working. A real income
 * transaction is still auto-logged on a default account by the backend.
 */
export default function PaymentDialog({
  open,
  onOpenChange,
  state, // { editing, form, currency }
  setState,
  schedules,
  accounts,
  clients,
  onSubmit,
}) {
  const f = state.form;
  const setForm = (patch) => setState({ ...state, form: { ...f, ...patch } });
  const setRecv = (patch) =>
    setForm({ received_in: { ...f.received_in, ...patch } });

  const isScAdjusted = f.fee_type === "sc_adjusted";

  // Group the SC Adjusted clients by category for the dropdown.
  const groupedClients = useMemo(() => {
    const grouped = {};
    (clients || [])
      .filter((c) => SC_ADJUSTED_CLIENT_TYPES.includes(c.client_type))
      .forEach((c) => {
        const t = c.client_type || "other";
        if (!grouped[t]) grouped[t] = [];
        grouped[t].push(c);
      });
    return grouped;
  }, [clients]);

  // When fee type flips, normalise received_in so the validator never trips.
  const onFeeTypeChange = (next) => {
    if (next === "sc_adjusted") {
      setForm({
        fee_type: next,
        received_in: {
          type: "sub_agent",
          name: "",
          client_id: "",
          account_id: "",
        },
      });
    } else if (f.fee_type === "sc_adjusted") {
      // Switching AWAY from SC adjusted → reset to a plain account-based collected_in
      setForm({
        fee_type: next,
        received_in: { type: "cash", name: "", client_id: "", account_id: "" },
      });
    } else {
      setForm({ fee_type: next });
    }
  };

  const onClientPicked = (clientId) => {
    const c = (clients || []).find((x) => x.id === clientId);
    if (!c) return;
    setRecv({
      type: CLIENT_TYPE_TO_RECEIVED_TYPE[c.client_type] || "sub_agent",
      name: c.name,
      client_id: c.id,
    });
  };

  const onAdjChange = (idx, k, v) => {
    // Support either (idx, key, value) for single-field edits or
    // (idx, patchObject) for multi-field edits done in one render — the
    // latter avoids stale-state races when changing `kind` resets the
    // dependent target fields in a single click.
    const adjs = f.adjustments.slice();
    if (k && typeof k === "object" && v === undefined) {
      adjs[idx] = { ...adjs[idx], ...k };
    } else {
      adjs[idx] = { ...adjs[idx], [k]: v };
    }
    setForm({ adjustments: adjs });
  };
  const onAdjAdd = () =>
    setForm({ adjustments: [...f.adjustments, emptyAdjustment(f.date)] });
  const onAdjRemove = (idx) =>
    setForm({ adjustments: f.adjustments.filter((_, i) => i !== idx) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-card max-w-2xl max-h-[92vh] overflow-y-auto"
        data-testid="payment-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-display">
            {state.editing ? "Edit Payment" : "New Payment"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Record a fee collection. When fee type is &ldquo;SC Adjusted&rdquo;, pick the
            Sub-Agent / Consultant / KM Office that absorbed the SC.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Row 1: Date · Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_minmax(0,180px)] gap-3">
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                required
                value={f.date}
                onChange={(e) => setForm({ date: e.target.value })}
                data-testid="pay-date"
              />
            </div>
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                required
                value={f.amount}
                onChange={(e) => setForm({ amount: e.target.value })}
                data-testid="pay-amount"
              />
            </div>
          </div>

          {/* Row 2: Fee Type */}
          <div>
            <Label>Fee Type</Label>
            <Select value={f.fee_type} onValueChange={onFeeTypeChange}>
              <SelectTrigger data-testid="pay-fee-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FEE_TYPE_OPTIONS.map((ft) => (
                  <SelectItem key={ft.value} value={ft.value}>
                    {ft.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Row 3: Collected in — context-aware */}
          {isScAdjusted ? (
            <div data-testid="pay-collected-sc">
              <Label>
                Collected in{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  (Sub-Agent · Consultant · KM Office)
                </span>
              </Label>
              <Select
                value={f.received_in.client_id || ""}
                onValueChange={onClientPicked}
              >
                <SelectTrigger data-testid="pay-collected-client">
                  <SelectValue placeholder="Pick a client" />
                </SelectTrigger>
                <SelectContent>
                  {SC_ADJUSTED_CLIENT_TYPES.filter(
                    (t) => (groupedClients[t] || []).length > 0,
                  ).map((t) => (
                    <SelectGroup key={t}>
                      <SelectLabel className="text-xs text-muted-foreground">
                        {CLIENT_TYPE_LABEL[t]}
                      </SelectLabel>
                      {groupedClients[t].map((c) => (
                        <SelectItem
                          key={c.id}
                          value={c.id}
                          data-testid={`pay-collected-client-${c.id}`}
                        >
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                  {Object.keys(groupedClients).length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No Sub-Agents / Consultants / KM Offices on file yet.
                    </div>
                  )}
                </SelectContent>
              </Select>
              {f.received_in.name && (
                <p
                  className="mt-1.5 text-xs text-muted-foreground"
                  data-testid="pay-collected-client-preview"
                >
                  Selected: {f.received_in.name}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Collected in</Label>
                <Select
                  value={f.received_in.type}
                  onValueChange={(v) => {
                    // Clear the auto-log account when switching to College
                    // (per spec: College Acc. doesn't need an internal account).
                    const next = { type: v, client_id: "" };
                    if (v === "college") next.account_id = "";
                    setRecv(next);
                  }}
                >
                  <SelectTrigger data-testid="pay-collected-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECEIVED_IN_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {f.received_in.type !== "college" && (
                <div>
                  <Label>
                    Account{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      (auto-logs as income tx)
                    </span>
                  </Label>
                  <Select
                    value={f.received_in.account_id || "_none"}
                    onValueChange={(v) =>
                      setRecv({ account_id: v === "_none" ? "" : v })
                    }
                  >
                    <SelectTrigger data-testid="pay-collected-account">
                      <SelectValue placeholder="No auto-log" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">No auto-log</SelectItem>
                      {(accounts || []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Row 4: Schedule (optional) */}
          <div>
            <Label>
              Schedule{" "}
              <span className="text-xs text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Select
              value={f.schedule_id || "_none"}
              onValueChange={(v) =>
                setForm({ schedule_id: v === "_none" ? "" : v })
              }
            >
              <SelectTrigger data-testid="pay-schedule">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">None</SelectItem>
                {(schedules || []).map((sc) => (
                  <SelectItem key={sc.id} value={sc.id}>
                    {sc.label} — {formatMoney(sc.amount, state.currency)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Row 5: Adjustments block — hidden on SC Adjusted entries (the fee type already represents an SC adjustment) */}
          {!isScAdjusted && (
            <AdjustmentsSection
              adjustments={f.adjustments}
              hasAdjustment={f.has_adjustment}
              onToggleHas={(v, seedAdjs) =>
                setForm({ has_adjustment: v, adjustments: seedAdjs })
              }
              onChange={onAdjChange}
              onAdd={onAdjAdd}
              onRemove={onAdjRemove}
              amount={f.amount}
              currency={state.currency}
              accounts={accounts}
              clients={clients}
              testIdPrefix="adj"
              paymentDate={f.date}
            />
          )}

          {/* Row 6: Remarks */}
          <div>
            <Label>Remarks</Label>
            <Input
              value={f.remarks}
              onChange={(e) => setForm({ remarks: e.target.value })}
              placeholder="e.g. Booking Amount"
              data-testid="pay-remarks"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="btn-amber border-0"
              data-testid="pay-save"
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

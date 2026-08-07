import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AdjustmentsSection, { ReceivedInBlock } from "./AdjustmentsSection";
import { PRESET_SCHEDULE_LABELS, emptyAdjustment } from "./constants";
import { formatMoney } from "@/lib/format";

export default function AddEntryDialog({
  open,
  onOpenChange,
  state,           // { form }
  setState,
  schedules,
  accounts,
  currency,
  onSubmit,
}) {
  const f = state.form;
  const updateEntry = (patch) => setState({ ...state, form: { ...f, ...patch } });
  const updateSch = (patch) => updateEntry({ schedule: { ...f.schedule, ...patch } });
  const updatePay = (patch) => updateEntry({ payment: { ...f.payment, ...patch } });
  const updateRecv = (patch) => updatePay({ received_in: { ...f.payment.received_in, ...patch } });

  const onAdjChange = (idx, k, v) => {
    const adjs = f.payment.adjustments.slice();
    adjs[idx] = { ...adjs[idx], [k]: v };
    updatePay({ adjustments: adjs });
  };
  const onAdjAdd = () => updatePay({ adjustments: [...f.payment.adjustments, emptyAdjustment(f.payment.date)] });
  const onAdjRemove = (idx) => updatePay({ adjustments: f.payment.adjustments.filter((_, i) => i !== idx) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="entry-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Add entry</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Add a planned schedule and / or record a payment received — both in one step.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          {/* Schedule section */}
          <div className="rounded-md border border-border p-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={!!f.create_schedule}
                onCheckedChange={(v) => updateEntry({ create_schedule: !!v, existing_schedule_id: v ? "" : f.existing_schedule_id })}
                data-testid="entry-create-schedule"
              />
              <span className="text-sm font-medium">Create a new schedule row</span>
            </label>

            {f.create_schedule ? (
              <div className="space-y-3 pt-1">
                <div>
                  <Label>Schedule</Label>
                  <Select value={f.schedule.label} onValueChange={(v) => updateSch({ label: v })}>
                    <SelectTrigger data-testid="entry-sch-label"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRESET_SCHEDULE_LABELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      {!PRESET_SCHEDULE_LABELS.includes(f.schedule.label) && f.schedule.label && (
                        <SelectItem value={f.schedule.label}>{f.schedule.label}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Input className="mt-2" placeholder="Or type a custom label" value={f.schedule.label} onChange={(e) => updateSch({ label: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label>Amount</Label><Input type="number" step="0.01" required value={f.schedule.amount} onChange={(e) => updateSch({ amount: e.target.value })} data-testid="entry-sch-amount" /></div>
                  <div><Label>Due date</Label><Input type="date" value={f.schedule.due_date} onChange={(e) => updateSch({ due_date: e.target.value })} /></div>
                </div>
                <div><Label>Remarks</Label><Input value={f.schedule.remarks} onChange={(e) => updateSch({ remarks: e.target.value })} placeholder="e.g. Booking Amount paid towards Tution Fees" /></div>
              </div>
            ) : (
              <div>
                <Label>Pick an existing schedule</Label>
                <Select
                  value={f.existing_schedule_id || "_none"}
                  onValueChange={(v) => updateEntry({ existing_schedule_id: v === "_none" ? "" : v })}
                >
                  <SelectTrigger data-testid="entry-existing-schedule"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">None</SelectItem>
                    {(schedules || []).map((sc) => (
                      <SelectItem key={sc.id} value={sc.id}>{sc.label} — {formatMoney(sc.amount, currency)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Payment section */}
          <div className="rounded-md border border-border p-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={!!f.log_payment}
                onCheckedChange={(v) => updateEntry({ log_payment: !!v })}
                data-testid="entry-log-payment"
              />
              <span className="text-sm font-medium">Also log a payment now</span>
            </label>

            {f.log_payment && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label>Date credited</Label><Input type="date" required value={f.payment.date} onChange={(e) => updatePay({ date: e.target.value })} data-testid="entry-pay-date" /></div>
                  <div>
                    <Label>Fee type</Label>
                    <Select value={f.payment.fee_type} onValueChange={(v) => updatePay({ fee_type: v })}>
                      <SelectTrigger data-testid="entry-pay-fee-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="booking_admission">Booking / Admission Fees</SelectItem>
                        <SelectItem value="tution">Tution Fees</SelectItem>
                        <SelectItem value="other">Other Fees</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Amount</Label>
                  <Input
                    type="number" step="0.01"
                    placeholder={f.create_schedule ? `Default: ${f.schedule.amount || "0"}` : "0.00"}
                    value={f.payment.amount}
                    onChange={(e) => updatePay({ amount: e.target.value })}
                    data-testid="entry-pay-amount"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Leave blank to use the schedule amount.</p>
                </div>

                <ReceivedInBlock
                  state={f.payment.received_in}
                  onChange={updateRecv}
                  accounts={accounts}
                  testIdPrefix="entry-pay-recv"
                />

                <AdjustmentsSection
                  adjustments={f.payment.adjustments}
                  hasAdjustment={f.payment.has_adjustment}
                  onToggleHas={(v, seedAdjs) => updatePay({ has_adjustment: v, adjustments: seedAdjs })}
                  onChange={onAdjChange}
                  onAdd={onAdjAdd}
                  onRemove={onAdjRemove}
                  amount={f.payment.amount || (f.create_schedule ? f.schedule.amount : 0)}
                  currency={currency}
                  testIdPrefix="entry-adj"
                  paymentDate={f.payment.date}
                />

                <div><Label>Remarks</Label><Input value={f.payment.remarks} onChange={(e) => updatePay({ remarks: e.target.value })} placeholder="Payment remarks" /></div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="btn-amber border-0" data-testid="entry-save">Save entry</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PRESET_SCHEDULE_LABELS } from "@/components/student-detail/constants";

/** Add / Edit payment-schedule dialog. The parent owns the `state` object
 * `{open, editing, form}` and the submit handler — this component is a
 * controlled view. Extracting it keeps StudentDetail.jsx focused on the
 * page layout and high-level state.
 */
export default function ScheduleDialog({ state, setState, onSubmit }) {
  const { form } = state;
  const updateForm = (patch) => setState({ ...state, form: { ...form, ...patch } });

  return (
    <Dialog open={state.open} onOpenChange={(v) => setState({ ...state, open: v })}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle className="font-display">
            {state.editing ? "Edit" : "Add"} schedule
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Define a planned payment installment.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label>Schedule</Label>
            <Select value={form.label} onValueChange={(v) => updateForm({ label: v })}>
              <SelectTrigger data-testid="sch-label"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRESET_SCHEDULE_LABELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                {!PRESET_SCHEDULE_LABELS.includes(form.label) && form.label && (
                  <SelectItem value={form.label}>{form.label}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Input
              className="mt-2"
              placeholder="Or type a custom label"
              value={form.label}
              onChange={(e) => updateForm({ label: e.target.value })}
            />
          </div>
          <div>
            <Label>Amount</Label>
            <Input
              type="number"
              step="0.01"
              required
              value={form.amount}
              onChange={(e) => updateForm({ amount: e.target.value })}
              data-testid="sch-amount"
            />
          </div>
          <div>
            <Label>Remarks</Label>
            <Input
              value={form.remarks}
              onChange={(e) => updateForm({ remarks: e.target.value })}
              placeholder="e.g. Booking Amount"
              data-testid="sch-remarks"
            />
          </div>
          <div>
            <Label>Due date</Label>
            <Input
              type="date"
              value={form.due_date}
              onChange={(e) => updateForm({ due_date: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setState({ ...state, open: false })}>
              Cancel
            </Button>
            <Button type="submit" className="btn-amber border-0" data-testid="sch-save">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

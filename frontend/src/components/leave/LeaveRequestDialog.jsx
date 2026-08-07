import React, { useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

export const LEAVE_TYPES = [
  { value: "casual", label: "Casual" },
  { value: "sick", label: "Sick" },
  { value: "earned", label: "Earned" },
  { value: "unpaid", label: "Unpaid" },
];

export default function LeaveRequestDialog({ open, onOpenChange, onSubmitted }) {
  const [type, setType] = useState("casual");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!from || !to) { toast.error("Pick the from and to dates"); return; }
    if (to < from) { toast.error("End date can't be before start date"); return; }
    setSaving(true);
    try {
      await api.post("/leave", { leave_type: type, from_date: from, to_date: to, reason: reason.trim() });
      toast.success("Leave request submitted");
      onSubmitted?.();
      onOpenChange(false);
      setFrom(""); setTo(""); setReason(""); setType("casual");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not submit");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-md" data-testid="leave-request-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Request leave</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Your request goes to your approver for review.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3.5">
          <div className="space-y-1.5">
            <Label>Leave type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="leave-type-select" className="bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lv-from">From</Label>
              <Input id="lv-from" type="date" data-testid="leave-from-input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lv-to">To</Label>
              <Input id="lv-to" type="date" data-testid="leave-to-input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lv-reason">Reason</Label>
            <Textarea id="lv-reason" data-testid="leave-reason-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Briefly, why?" rows={2} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} data-testid="leave-submit-btn" className="btn-amber border-0">{saving ? "Submitting…" : "Submit request"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function LeavePolicyDialog({ open, onOpenChange, onSaved }) {
  const [q, setQ] = useState({ casual: 12, sick: 6, earned: 15, unpaid: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get("/leave/quotas").then(({ data }) => {
      setQ({ casual: data.casual ?? 12, sick: data.sick ?? 6, earned: data.earned ?? 15, unpaid: data.unpaid ?? "" });
    }).catch(() => {});
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/leave/quotas", {
        casual: parseInt(q.casual, 10) || 0,
        sick: parseInt(q.sick, 10) || 0,
        earned: parseInt(q.earned, 10) || 0,
        unpaid: q.unpaid === "" ? null : (parseInt(q.unpaid, 10) || 0),
      });
      toast.success("Leave policy updated");
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not save");
    } finally { setSaving(false); }
  };

  const field = (key, label, hint) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" min="0" value={q[key]} onChange={(e) => setQ({ ...q, [key]: e.target.value })} data-testid={`quota-${key}`} placeholder={hint} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-md" data-testid="leave-policy-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Leave policy</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Annual allowance per leave type (applies to everyone).</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {field("casual", "Casual (days/yr)")}
          {field("sick", "Sick (days/yr)")}
          {field("earned", "Earned (days/yr)")}
          {field("unpaid", "Unpaid (days/yr)", "Blank = unlimited")}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving} data-testid="quota-save-btn" className="btn-amber border-0">{saving ? "Saving…" : "Save policy"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

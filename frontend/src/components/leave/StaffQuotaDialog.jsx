import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowCounterClockwise } from "@phosphor-icons/react";

const EMPTY = { casual: 12, sick: 6, earned: 15, unpaid: "" };

export default function StaffQuotaDialog({ open, onOpenChange, userId, userName, onSaved }) {
  const [q, setQ] = useState(EMPTY);
  const [hasOverride, setHasOverride] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    api.get(`/leave/quotas/user/${userId}`)
      .then(({ data }) => {
        const v = data.quota || {};
        setQ({ casual: v.casual ?? 12, sick: v.sick ?? 6, earned: v.earned ?? 15, unpaid: v.unpaid ?? "" });
        setHasOverride(!!data.has_override);
      })
      .catch((err) => toast.error(formatApiError(err?.response?.data?.detail) || "Could not load quota"))
      .finally(() => setLoading(false));
  }, [open, userId]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/leave/quotas/user/${userId}`, {
        casual: parseInt(q.casual, 10) || 0,
        sick: parseInt(q.sick, 10) || 0,
        earned: parseInt(q.earned, 10) || 0,
        unpaid: q.unpaid === "" ? null : (parseInt(q.unpaid, 10) || 0),
      });
      toast.success(`Quota saved for ${userName || "user"}`);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not save");
    } finally { setSaving(false); }
  };

  const resetToGlobal = async () => {
    setSaving(true);
    try {
      await api.delete(`/leave/quotas/user/${userId}`);
      toast.success("Reset to company policy");
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not reset");
    } finally { setSaving(false); }
  };

  const field = (key, label, hint) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" min="0" value={q[key]} onChange={(e) => setQ({ ...q, [key]: e.target.value })} data-testid={`staff-quota-${key}`} placeholder={hint} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-md" data-testid="staff-quota-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Leave quota · {userName}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {hasOverride ? "Custom quota in effect (overrides company policy)." : "Currently using the company-wide policy. Save to set a custom quota."}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {field("casual", "Casual (days/yr)")}
            {field("sick", "Sick (days/yr)")}
            {field("earned", "Earned (days/yr)")}
            {field("unpaid", "Unpaid (days/yr)", "Blank = unlimited")}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          {hasOverride ? (
            <Button type="button" variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10" onClick={resetToGlobal} disabled={saving} data-testid="staff-quota-reset">
              <ArrowCounterClockwise size={15} className="mr-1.5" /> Reset to policy
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" onClick={save} disabled={saving || loading} data-testid="staff-quota-save" className="btn-amber border-0">{saving ? "Saving…" : "Save quota"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

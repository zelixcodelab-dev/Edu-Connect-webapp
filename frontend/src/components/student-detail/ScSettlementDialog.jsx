import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { PAYMENT_MODES } from "@/lib/paymentModes";

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export default function ScSettlementDialog({ open, onOpenChange, s, accounts, onSaved }) {
  const [f, setF] = useState({ amount: "", account_id: "", date: today(), payment_mode: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const st = s.sc_settlement;
    setF(st
      ? { amount: String(st.amount), account_id: st.account_id, date: st.date, payment_mode: st.payment_mode || "" }
      : { amount: String(s.sc_earned_effective || ""), account_id: accounts[0]?.id || "", date: today(), payment_mode: "" });
  }, [open, s, accounts]);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const amount = parseFloat(f.amount);
    if (!amount || amount <= 0) { toast.error("Enter an amount"); return; }
    if (!f.account_id) { toast.error("Pick an account"); return; }
    setSaving(true);
    try {
      await api.put(`/students/${s.id}/sc-settlement`, { ...f, amount, payment_mode: f.payment_mode || null }, { skipCelebration: true });
      toast.success("SC marked settled");
      onOpenChange(false);
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-md" data-testid="sc-settle-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">{s.sc_settlement ? "Edit SC settlement" : "Mark SC Settled"}</DialogTitle>
          <DialogDescription>Record the service charge received from the college as a credit.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Amount</Label>
            <Input type="number" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} data-testid="sc-settle-amount" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Credit to account</Label>
            <Select value={f.account_id} onValueChange={(v) => set("account_id", v)}>
              <SelectTrigger data-testid="sc-settle-account"><SelectValue placeholder="Pick an account" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} data-testid="sc-settle-date" />
          </div>
          <div>
            <Label className="text-xs">Payment mode</Label>
            <Select value={f.payment_mode} onValueChange={(v) => set("payment_mode", v)}>
              <SelectTrigger data-testid="sc-settle-mode"><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="btn-amber border-0" onClick={save} disabled={saving} data-testid="sc-settle-save">
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function PrevScPaymentBlock({ form, setForm, accounts }) {
  const psp = form.previous_sc_payment || { has: false, amount: 0 };
  return (
    <div className="rounded-md border border-border p-4 space-y-3" data-testid="prev-sc-block">
      <label className="flex items-start gap-2 cursor-pointer">
        <Checkbox
          checked={!!psp.has}
          onCheckedChange={(v) => setForm({
            ...form,
            previous_sc_payment: {
              has: !!v,
              amount: psp.amount || "",
              mode: psp.mode || "bank_transfer",
              date: psp.date || form.issue_date,
              account_id: psp.account_id || (accounts[0]?.id || ""),
            },
          })}
          data-testid="prev-sc-has"
        />
        <div>
          <p className="text-sm font-medium">Previous payment towards SC</p>
          <p className="text-xs text-muted-foreground mt-0.5">A prior part-payment already received against this service charge. Logged as income and subtracted from the balance.</p>
        </div>
      </label>
      {psp.has && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-7">
          <div>
            <Label className="text-xs">Amount</Label>
            <Input
              type="number" step="0.01"
              value={psp.amount}
              onChange={(e) => setForm({ ...form, previous_sc_payment: { ...psp, amount: e.target.value } })}
              data-testid="prev-sc-amount"
            />
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <Select
              value={psp.mode || "bank_transfer"}
              onValueChange={(v) => setForm({ ...form, previous_sc_payment: { ...psp, mode: v } })}
            >
              <SelectTrigger className="h-9" data-testid="prev-sc-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Date of Payment</Label>
            <Input
              type="date"
              value={psp.date || ""}
              onChange={(e) => setForm({ ...form, previous_sc_payment: { ...psp, date: e.target.value } })}
              data-testid="prev-sc-date"
            />
          </div>
          <div className="sm:col-span-3">
            <Label className="text-xs">Credit to account</Label>
            <Select
              value={psp.account_id || (accounts[0]?.id || "")}
              onValueChange={(v) => setForm({ ...form, previous_sc_payment: { ...psp, account_id: v } })}
            >
              <SelectTrigger className="h-9" data-testid="prev-sc-account"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Car, Receipt } from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";
import ServiceMetaBlock from "@/components/invoice-form/ServiceMetaBlock";
import ParticularsSection from "@/components/invoice-form/ParticularsSection";
import PrevScPaymentBlock from "@/components/invoice-form/PrevScPaymentBlock";

const _uid = () => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `p-${Date.now()}-${Math.random()}`;
export const emptyParticular = () => ({ _key: _uid(), kind: "Car Rent", specify: "", amount: "" });
export const serviceParticular = () => ({ _key: _uid(), kind: "Service Charge", specify: "", amount: "" });
// re-export so existing import paths keep working
export { PARTICULAR_PRESETS } from "@/components/invoice-form/ParticularsSection";

export default function InvoiceForm({ form, setForm, clients, accounts, currency, editing, onSubmit, onCancel }) {
  const isService = form.invoice_type === "service_charge";
  const [openCredits, setOpenCredits] = useState([]);

  // Fetch open campus-visit credits for the selected client when in service mode.
  useEffect(() => {
    if (!isService) { setOpenCredits([]); return; }
    if (!form.client_id) { setOpenCredits([]); return; }
    let cancelled = false;
    api.get("/invoices/open-credits", { params: { client_id: form.client_id } })
      .then(({ data }) => { if (!cancelled) setOpenCredits(data); })
      .catch((err) => {
        if (!cancelled) {
          setOpenCredits([]);
          console.error("[invoice-form] open-credits fetch failed:", err?.message || err);
        }
      });
    return () => { cancelled = true; };
  }, [isService, form.client_id]);

  const updatePart = (idx, k, v) => {
    const items = form.particulars.slice();
    items[idx] = { ...items[idx], [k]: v };
    setForm({ ...form, particulars: items });
  };
  const addPart = () => setForm({ ...form, particulars: [...form.particulars, emptyParticular()] });
  const removePart = (idx) => setForm({ ...form, particulars: form.particulars.filter((_, i) => i !== idx) });

  const switchType = (t) => {
    if (t === form.invoice_type) return;
    setForm({
      ...form,
      invoice_type: t,
      particulars: t === "service_charge" ? [serviceParticular()] : [emptyParticular()],
      auto_log_expenses: t === "service_charge" ? false : true,
    });
  };

  const totalAmount = form.particulars.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const taxAmount = totalAmount * ((parseFloat(form.tax_rate) || 0) / 100);
  const credit = parseFloat(form.credit_amount) || 0;
  const psp = form.previous_sc_payment || { has: false, amount: 0 };
  const prevPay = isService && psp.has ? (parseFloat(psp.amount) || 0) : 0;
  const grandTotal = totalAmount + taxAmount - credit - prevPay;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Type selector */}
      <div className="grid grid-cols-2 gap-2" data-testid="invoice-type-toggle">
        <button
          type="button"
          onClick={() => switchType("campus_visit")}
          data-testid="type-campus"
          className={`p-3 rounded-md border text-left lift ${form.invoice_type === "campus_visit" ? "border-orange-500 bg-orange-500/10 ring-2 ring-orange-500/30" : "border-border bg-card hover:bg-muted/40"}`}
        >
          <div className="flex items-center gap-2">
            <Car size={18} weight="regular" className="text-foreground" />
            <div>
              <p className="text-sm font-medium">Campus Visit Invoice</p>
              <p className="text-xs text-muted-foreground">Travel particulars · auto-logs expenses</p>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => switchType("service_charge")}
          data-testid="type-service"
          className={`p-3 rounded-md border text-left lift ${form.invoice_type === "service_charge" ? "border-orange-500 bg-orange-500/10 ring-2 ring-orange-500/30" : "border-border bg-card hover:bg-muted/40"}`}
        >
          <div className="flex items-center gap-2">
            <Receipt size={18} weight="regular" className="text-foreground" />
            <div>
              <p className="text-sm font-medium">Service Charge Invoice</p>
              <p className="text-xs text-muted-foreground">Single fee · academic year</p>
            </div>
          </div>
        </button>
      </div>

      {/* Top meta — shared */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Generate invoice to (Client)</Label>
          <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
            <SelectTrigger data-testid="inv-client"><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Invoice #</Label><Input required value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} data-testid="inv-number" /></div>
        <div><Label>Date</Label><Input type="date" required value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value, due_date: e.target.value })} data-testid="inv-issue" /></div>
        {!isService && (
          <div><Label>Campus Visit No.</Label><Input value={form.campus_visit_no} onChange={(e) => setForm({ ...form, campus_visit_no: e.target.value })} placeholder="CV-2026-001" data-testid="inv-visit-no" /></div>
        )}
      </div>

      {/* Variant-specific meta */}
      {isService ? (
        <ServiceMetaBlock form={form} setForm={setForm} openCredits={openCredits} currency={currency} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Student Name</Label><Input value={form.student_name} onChange={(e) => setForm({ ...form, student_name: e.target.value })} placeholder="Full name" data-testid="inv-student" /></div>
          <div><Label>Course</Label><Input value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} placeholder="e.g. B.Tech CSE" data-testid="inv-course" /></div>
          <div className="sm:col-span-2">
            <Label>Visited Colleges</Label>
            <Textarea rows={2} value={form.visited_colleges} onChange={(e) => setForm({ ...form, visited_colleges: e.target.value })} placeholder="Comma-separated list of colleges visited" data-testid="inv-colleges" />
          </div>
        </div>
      )}

      <ParticularsSection
        form={form}
        isService={isService}
        updatePart={updatePart}
        addPart={addPart}
        removePart={removePart}
      />

      {/* Auto-log toggle (only for campus visit type) */}
      {!isService && (
        <div className="rounded-md border border-border bg-muted/40 p-4 space-y-3" data-testid="auto-log-block">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={!!form.auto_log_expenses}
              onCheckedChange={(v) => setForm({ ...form, auto_log_expenses: !!v })}
              data-testid="inv-auto-log"
              className="mt-1"
            />
            <div className="flex-1">
              <p className="text-sm font-medium">Also log particulars as expense transactions</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Each row is recorded as an expense in your ledger, mapped to its category. Updating the invoice re-syncs the transactions.
              </p>
            </div>
          </label>
          {form.auto_log_expenses && (
            <div className="pl-7">
              <Label className="text-xs">Expense account</Label>
              <Select value={form.expense_account_id || (accounts[0]?.id ?? "")} onValueChange={(v) => setForm({ ...form, expense_account_id: v })}>
                <SelectTrigger className="h-9 bg-card" data-testid="inv-expense-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Totals controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label>{isService ? "Expense Credit of Campus Visit" : "Credit toward expense"}</Label>
          <Input type="number" step="0.01" value={form.credit_amount} onChange={(e) => setForm({ ...form, credit_amount: e.target.value })} data-testid="inv-credit" />
          {isService && <p className="text-[11px] text-muted-foreground mt-1">Pending / clear from a previous campus visit</p>}
        </div>
        <div>
          <Label>Tax rate %</Label>
          <Input type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} data-testid="inv-tax" />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger data-testid="inv-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Payment terms, thank you note…" /></div>

      {isService && <PrevScPaymentBlock form={form} setForm={setForm} accounts={accounts} />}

      {/* Live totals */}
      <div className="border-t border-border pt-4 space-y-1.5 text-sm bg-muted/40 -mx-6 -mb-6 px-6 py-4 rounded-b-lg">
        <div className="flex justify-between"><span className="text-muted-foreground">{isService ? "Total Amount" : "Total Expense"}</span><span className="tabular-nums font-medium" data-testid="inv-subtotal">{formatMoney(totalAmount, currency)}</span></div>
        {parseFloat(form.tax_rate) > 0 && (
          <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{formatMoney(taxAmount, currency)}</span></div>
        )}
        {credit > 0 && (
          <div className="flex justify-between"><span className="text-muted-foreground">{isService ? "Expense Credit of Campus Visit" : "Credit toward expense"}</span><span className="tabular-nums text-rose-700 dark:text-rose-400">− {formatMoney(credit, currency)}</span></div>
        )}
        {prevPay > 0 && (
          <div className="flex justify-between" data-testid="totals-prev-sc"><span className="text-muted-foreground">Previous payment towards SC</span><span className="tabular-nums text-rose-700 dark:text-rose-400">− {formatMoney(prevPay, currency)}</span></div>
        )}
        <div className="flex justify-between border-t border-border mt-2 pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums" data-testid="inv-total">{formatMoney(grandTotal, currency)}</span></div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" className="btn-amber border-0" data-testid="inv-save">{editing ? "Save" : "Create"}</Button>
      </div>
    </form>
  );
}

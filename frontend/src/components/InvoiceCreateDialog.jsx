import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import InvoiceForm, { PARTICULAR_PRESETS, emptyParticular, serviceParticular } from "@/components/InvoiceForm";
import { toast } from "sonner";

const blankForm = () => ({
  client_id: "",
  invoice_number: "",
  issue_date: todayISO(),
  due_date: todayISO(),
  particulars: [emptyParticular()],
  tax_rate: 0,
  notes: "",
  status: "draft",
  campus_visit_no: "",
  student_name: "",
  course: "",
  visited_colleges: "",
  credit_amount: 0,
  auto_log_expenses: true,
  expense_account_id: "",
  invoice_type: "campus_visit",
  college: "",
  academic_year: "",
  linked_visit_invoice_id: null,
  previous_sc_payment: { has: false, amount: "", mode: "bank_transfer", date: "", account_id: "" },
});

function nextInvoiceNumber(list) {
  const year = new Date().getFullYear();
  const ns = list.map((i) => i.invoice_number).filter(Boolean);
  const max = ns.reduce((acc, n) => {
    const m = n.match(/INV-(\d{4})-(\d+)/);
    if (m && parseInt(m[1]) === year) return Math.max(acc, parseInt(m[2]));
    return acc;
  }, 0);
  return `INV-${year}-${String(max + 1).padStart(4, "0")}`;
}

function particularsToItems(particulars) {
  return particulars
    .map((p) => {
      const amt = parseFloat(p.amount) || 0;
      if (amt <= 0) return null;
      const description = p.kind === "Other" ? `Other: ${p.specify?.trim() || "Misc"}` : p.kind;
      return { description, quantity: 1, unit_price: amt };
    })
    .filter(Boolean);
}

// Self-contained invoice-create popup. Used where we want to generate an
// invoice without leaving the current page (e.g. the client detail page).
export default function InvoiceCreateDialog({ open, onOpenChange, presetClientId, preset, onCreated }) {
  const { user } = useAuth();
  const currency = user?.currency || "USD";
  const [clients, setClients] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(blankForm());

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [i, c, a] = await Promise.all([api.get("/invoices"), api.get("/clients"), api.get("/accounts")]);
      setClients(c.data); setAccounts(a.data);
      const base = {
        ...blankForm(),
        invoice_number: nextInvoiceNumber(i.data),
        client_id: presetClientId || c.data[0]?.id || "",
        expense_account_id: a.data[0]?.id || "",
      };
      const p = preset || {};
      if (p.invoice_type === "service_charge") {
        base.invoice_type = "service_charge";
        base.auto_log_expenses = false;
        base.particulars = [{ ...serviceParticular(), amount: p.sc_amount != null ? String(p.sc_amount) : "" }];
        base.student_name = p.student_name || "";
        base.college = p.college || "";
        base.course = p.course || "";
      }
      setForm(base);
    })();
  }, [open, presetClientId, preset]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.client_id) { toast.error("Select a client"); return; }
    const isService = form.invoice_type === "service_charge";
    let items;
    if (isService) {
      const amt = parseFloat(form.particulars[0]?.amount) || 0;
      if (amt <= 0) { toast.error("Enter the service charge amount"); return; }
      items = [{ description: "Service Charge", quantity: 1, unit_price: amt }];
    } else {
      items = particularsToItems(form.particulars);
      if (items.length === 0) { toast.error("Add at least one particular with amount"); return; }
    }
    const payload = {
      client_id: form.client_id,
      invoice_number: form.invoice_number,
      issue_date: form.issue_date,
      due_date: form.due_date,
      items,
      tax_rate: parseFloat(form.tax_rate) || 0,
      credit_amount: parseFloat(form.credit_amount) || 0,
      notes: form.notes,
      status: form.status,
      campus_visit_no: isService ? null : (form.campus_visit_no || null),
      student_name: form.student_name || null,
      course: form.course || null,
      visited_colleges: isService ? null : (form.visited_colleges || null),
      auto_log_expenses: !isService && !!form.auto_log_expenses,
      expense_account_id: form.expense_account_id || null,
      invoice_type: form.invoice_type,
      college: isService ? (form.college || null) : null,
      academic_year: isService ? (form.academic_year || null) : null,
      linked_visit_invoice_id: isService ? (form.linked_visit_invoice_id || null) : null,
      previous_sc_payment: isService && form.previous_sc_payment?.has
        ? {
            has: true,
            amount: parseFloat(form.previous_sc_payment.amount) || 0,
            mode: form.previous_sc_payment.mode || "bank_transfer",
            date: form.previous_sc_payment.date || form.issue_date,
            account_id: form.previous_sc_payment.account_id || null,
          }
        : null,
    };
    try {
      await api.post("/invoices", payload);
      toast.success("Invoice created");
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="client-invoice-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">New invoice</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Generate an invoice for this client — you'll stay on this page afterwards.
          </DialogDescription>
        </DialogHeader>
        <InvoiceForm
          form={form}
          setForm={setForm}
          clients={clients}
          accounts={accounts}
          currency={currency}
          editing={false}
          onSubmit={submit}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export { PARTICULAR_PRESETS };

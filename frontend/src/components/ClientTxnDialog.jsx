import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { todayISO } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MoneyOutFields from "@/components/MoneyOutFields";
import { toast } from "sonner";

// Quick Payout / Expense popup scoped to a single client (recipient is the
// client). On save it stays on the current page via onSaved().
export default function ClientTxnDialog({ open, onOpenChange, client, onSaved }) {
  const [kind, setKind] = useState("payout"); // "payout" | "expense"
  const [amount, setAmount] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [students, setStudents] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [studentName, setStudentName] = useState("");
  const [expenseOf, setExpenseOf] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind("payout"); setAmount(""); setDate(todayISO()); setDescription("");
    setStudentName(""); setExpenseOf(""); setPaymentMode("");
    (async () => {
      const [a, c, st] = await Promise.all([api.get("/accounts"), api.get("/categories"), api.get("/students")]);
      setAccounts(a.data); setCategories(c.data); setStudents(st.data);
      setAccountId(a.data[0]?.id || "");
    })();
  }, [open]);

  const [categoryId, setCategoryId] = useState("");
  useEffect(() => { setCategoryId(""); setExpenseOf(""); setStudentName(""); setPaymentMode(""); }, [kind]);

  const referredStudents = useMemo(() => {
    const t = (client?.name || "").trim().toLowerCase();
    if (!t) return [];
    return students.filter((s) => (s.reference || "").trim().toLowerCase() === t);
  }, [students, client]);

  const save = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter an amount"); return; }
    if (!accountId) { toast.error("Pick an account"); return; }
    setSaving(true);
    const wantsStudent = kind === "payout" || (kind === "expense" && expenseOf === "campus_visit");
    try {
      await api.post("/transactions", {
        type: "expense",
        amount: amt,
        account_id: accountId,
        category_id: kind === "expense" ? (categoryId || null) : null,
        date,
        description,
        is_sc_payout: kind === "payout",
        client_id: client.id,
        payment_mode: paymentMode || null,
        student_name: wantsStudent ? (studentName || null) : null,
        expense_of: kind === "expense" ? (expenseOf || null) : null,
      });
      toast.success(`${kind === "payout" ? "Payout" : "Expense"} saved`);
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-h-[92vh] overflow-y-auto" data-testid="client-txn-dialog">
        <DialogHeader><DialogTitle className="font-display">Add transaction — {client?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2" data-testid="client-txn-kind">
            {[{ v: "payout", l: "Payout" }, { v: "expense", l: "Expense" }].map((k) => (
              <button type="button" key={k.v} onClick={() => setKind(k.v)} data-testid={`client-txn-kind-${k.v}`}
                className={`h-10 rounded-md border text-sm font-medium transition-colors ${kind === k.v ? "border-orange-500 bg-amber-gradient text-white" : "border-border bg-card hover:bg-muted/40"}`}>
                {k.l}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="client-txn-amount" />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="client-txn-date" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger data-testid="client-txn-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <MoneyOutFields
            key={kind}
            kind={kind}
            recipientId={client?.id}
            onRecipientChange={() => {}}
            hideRecipient
            payoutClients={client ? [client] : []}
            referredStudents={referredStudents}
            studentName={studentName} onStudentNameChange={setStudentName}
            expenseOf={expenseOf} onExpenseOfChange={setExpenseOf}
            paymentMode={paymentMode} onPaymentModeChange={setPaymentMode}
            expenseCategories={categories.filter((c) => c.type === "expense")}
            categoryId={categoryId} onCategoryChange={setCategoryId}
            idPrefix="client-txn"
          />

          <div>
            <Label>Notes (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this for?" data-testid="client-txn-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="client-txn-cancel">Cancel</Button>
          <Button type="button" onClick={save} disabled={saving} className="btn-amber border-0" data-testid="client-txn-save">
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PAYMENT_MODES, EXPENSE_OF_OPTIONS, SC_PAYOUT_CLIENT_TYPE_LABELS,
} from "@/lib/paymentModes";

const NONE = "__none__";
const OTHER = "__other__";

// Shared fields for a money-out line (Payout or recipient-linked Expense).
// Used by Quick Entry and the Transactions "Add" dialog so both stay in sync.
export default function MoneyOutFields({
  kind,                 // "payout" | "expense"
  recipientId, onRecipientChange,
  payoutClients,
  referredStudents = [],
  studentName, onStudentNameChange,
  expenseOf, onExpenseOfChange,
  paymentMode, onPaymentModeChange,
  expenseCategories = [],
  categoryId, onCategoryChange,
  hideRecipient = false,
  idPrefix = "mo",
}) {
  const isCampusVisit = kind === "expense" && expenseOf === "campus_visit";
  const showStudents = kind === "payout" || isCampusVisit;
  const allowOther = kind === "expense"; // campus visit → include "Other"
  // "Expense of" only appears once a recipient (client) is chosen.
  const showExpenseOf = kind === "expense" && !!recipientId;

  // Track whether the free-text "Other" name row is open.
  const [otherOpen, setOtherOpen] = useState(false);
  useEffect(() => {
    if (studentName && !referredStudents.some((s) => s.name === studentName)) setOtherOpen(true);
  }, [studentName, referredStudents]);

  const selectValue = otherOpen ? OTHER : (studentName || NONE);
  const onStudentSelect = (v) => {
    if (v === OTHER) { setOtherOpen(true); onStudentNameChange(""); }
    else { setOtherOpen(false); onStudentNameChange(v === NONE ? "" : v); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!hideRecipient && (
          <div>
            <Label>Recipient <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Select value={recipientId || NONE} onValueChange={(v) => onRecipientChange(v === NONE ? "" : v)}>
              <SelectTrigger data-testid={`${idPrefix}-recipient`}><SelectValue placeholder="Select recipient" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {payoutClients.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">No Sub-Associate / Associate Consultant clients yet.</div>
                ) : payoutClients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} · {SC_PAYOUT_CLIENT_TYPE_LABELS[c.client_type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showExpenseOf && (
          <div>
            <Label>Expense of</Label>
            <Select value={expenseOf || ""} onValueChange={onExpenseOfChange}>
              <SelectTrigger data-testid={`${idPrefix}-expense-of`}><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {EXPENSE_OF_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {showStudents && recipientId && (
          <div>
            <Label>Student referred {kind === "payout" ? "(optional)" : ""}</Label>
            <Select value={selectValue} onValueChange={onStudentSelect}>
              <SelectTrigger data-testid={`${idPrefix}-student`}>
                <SelectValue placeholder="Select student" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {referredStudents.map((s) => (
                  <SelectItem key={s.id} value={s.name}>{s.name}{s.college ? ` · ${s.college}` : ""}</SelectItem>
                ))}
                {allowOther && <SelectItem value={OTHER}>Other…</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        )}

        {otherOpen && allowOther && showStudents && recipientId && (
          <div>
            <Label>Name</Label>
            <Input
              value={studentName || ""}
              onChange={(e) => onStudentNameChange(e.target.value)}
              placeholder="Type the student / person name"
              data-testid={`${idPrefix}-student-other`}
            />
          </div>
        )}

        {kind === "expense" && expenseOf !== "personal" && (
          <div>
            <Label>Category</Label>
            <Select value={categoryId || NONE} onValueChange={(v) => onCategoryChange(v === NONE ? "" : v)}>
              <SelectTrigger data-testid={`${idPrefix}-category`}><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {expenseCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <Label>Mode of payment</Label>
          <Select value={paymentMode || ""} onValueChange={onPaymentModeChange}>
            <SelectTrigger data-testid={`${idPrefix}-payment-mode`}><SelectValue placeholder="Select mode" /></SelectTrigger>
            <SelectContent>
              {PAYMENT_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

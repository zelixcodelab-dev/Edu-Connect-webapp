import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { GraduationCap, CheckCircle, CurrencyInr } from "@phosphor-icons/react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";

/**
 * One-click "Convert to enrolled student" dialog.
 *
 * Simplified flow: capture a payment + SC amount → flip status to enrolled.
 * Logs the payment via POST /students/{id}/payments AND PATCHes the student
 * (status, sc_out_fixed, enrollment_date) in one click. Payment is required.
 */

const MODES = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

const FEE_TYPES = [
  { value: "booking_admission", label: "Booking / Admission" },
  { value: "tution", label: "Tuition" },
  { value: "other", label: "Other" },
];

// Modes that need an internal account (everything except plain cash).
const NEEDS_ACCOUNT = new Set(["bank_transfer", "upi", "cheque", "card"]);

const today = () => new Date().toISOString().slice(0, 10);

export default function ConvertToEnrolledDialog({
  open, onOpenChange, student, currency, onConverted,
}) {
  const [sc, setSc] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [mode, setMode] = useState("cash");
  const [feeType, setFeeType] = useState("booking_admission");
  const [accountId, setAccountId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reset state on open so re-opens are clean
    setSc(String(student?.sc_out_fixed || ""));
    setEnrollmentDate(student?.enrollment_date || today());
    setAmount("");
    setPaymentDate(today());
    setMode("cash");
    setFeeType("booking_admission");
    setAccountId("");
    setRemarks("");
    api.get("/accounts").then((r) => {
      setAccounts(r.data || []);
    }).catch((err) => {
      console.error("[convert-dialog] accounts:", err);
    });
  }, [open, student]);

  const needsAccount = NEEDS_ACCOUNT.has(mode);
  const previewAmount = parseFloat(amount) || 0;
  const previewSc = parseFloat(sc) || 0;

  const validate = () => {
    const errs = [];
    if (!sc || parseFloat(sc) <= 0) errs.push("SC Earned must be greater than zero");
    if (!amount || parseFloat(amount) <= 0) errs.push("Payment amount is required");
    if (!paymentDate) errs.push("Payment date is required");
    if (needsAccount && !accountId) errs.push("Pick the account to credit");
    return errs;
  };

  const submit = async () => {
    const errs = validate();
    if (errs.length) {
      toast.error(errs.length === 1 ? errs[0] : `Fix ${errs.length} field(s)`, {
        description: errs.length > 1 ? errs.join(" · ") : undefined,
      });
      return;
    }
    setSaving(true);
    try {
      // 1) PATCH the student → flip status, set SC, keep everything else.
      const patchPayload = {
        name: student.name,
        course: student.course || "",
        college: student.college || "",
        reference: student.reference || "",
        notes: student.notes || "",
        status: "enrolled",
        sc_out_fixed: parseFloat(sc) || 0,
        enrollment_date: enrollmentDate,
        fees_plan: student.fees_plan || null,
      };
      await api.patch(`/students/${student.id}`, patchPayload);

      // 2) POST the payment. received_in shape mirrors the PaymentDialog.
      const receivedIn = mode === "cash"
        ? { type: "cash", name: null, account_id: accountId || null }
        : { type: "bank", name: null, account_id: accountId };
      const paymentPayload = {
        date: paymentDate,
        amount: parseFloat(amount) || 0,
        fee_type: feeType,
        received_in: receivedIn,
        has_adjustment: false,
        adjustments: [],
        schedule_id: null,
        remarks: (remarks || "").trim() || `Payment via ${mode.replace("_", " ")}`,
      };
      await api.post(`/students/${student.id}/payments`, paymentPayload);

      toast.success("Converted to enrolled · payment logged");
      onConverted?.();
      onOpenChange(false);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(
        typeof detail === "string" ? detail
        : Array.isArray(detail) ? detail.map((d) => d?.msg || JSON.stringify(d)).join(" · ")
        : "Conversion failed"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-card max-w-xl max-h-[92vh] overflow-y-auto"
        data-testid="convert-enrolled-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <GraduationCap size={18} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
            Convert {student?.name?.split(" ")[0] || "this student"} to enrolled
          </DialogTitle>
          <DialogDescription>
            Log the booking/admission payment + SC amount, and we'll flip the status to{" "}
            <span className="font-medium text-emerald-700 dark:text-emerald-400">Enrolled</span> in one click.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Service Charge (SC) earned <span className="text-rose-600">*</span></Label>
              <Input
                type="number" step="0.01" required value={sc}
                onChange={(e) => setSc(e.target.value)}
                placeholder="e.g. 75000"
                data-testid="cv-sc"
              />
            </div>
            <div>
              <Label>Enrollment date</Label>
              <Input
                type="date" value={enrollmentDate}
                onChange={(e) => setEnrollmentDate(e.target.value)}
                data-testid="cv-enrollment-date"
              />
            </div>
          </div>

          <Card className="p-4 bg-muted/30 border border-border space-y-3" data-testid="cv-payment-block">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-md bg-amber-gradient-soft border border-amber-500/30 flex items-center justify-center">
                <CurrencyInr size={14} className="text-amber-700 dark:text-amber-400" />
              </span>
              <p className="label-eyebrow">Log payment</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Amount <span className="text-rose-600">*</span></Label>
                <Input
                  type="number" step="0.01" required value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  data-testid="cv-amount"
                />
              </div>
              <div>
                <Label>Payment date <span className="text-rose-600">*</span></Label>
                <Input
                  type="date" required value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  data-testid="cv-pay-date"
                />
              </div>
              <div>
                <Label>Mode <span className="text-rose-600">*</span></Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger data-testid="cv-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fee type</Label>
                <Select value={feeType} onValueChange={setFeeType}>
                  <SelectTrigger data-testid="cv-fee-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FEE_TYPES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>
                  Credit to account {needsAccount && <span className="text-rose-600">*</span>}
                  {!needsAccount && <span className="text-muted-foreground text-[11px] ml-1">(optional for cash)</span>}
                </Label>
                <Select value={accountId || "_none"} onValueChange={(v) => setAccountId(v === "_none" ? "" : v)}>
                  <SelectTrigger data-testid="cv-account"><SelectValue placeholder="Pick an account" /></SelectTrigger>
                  <SelectContent>
                    {!needsAccount && <SelectItem value="_none">— None —</SelectItem>}
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} <span className="text-muted-foreground text-xs">({a.type})</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>Remarks (optional)</Label>
                <Textarea
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. UTR 1234567890 · received from parent"
                  data-testid="cv-remarks"
                />
              </div>
            </div>
          </Card>

          <div className="flex items-center justify-between rounded-md bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/70 dark:border-emerald-500/30 p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">After conversion</p>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-0.5">
                SC <strong>{formatMoney(previewSc, currency)}</strong> · Payment <strong>{formatMoney(previewAmount, currency)}</strong> logged
              </p>
            </div>
            <span className="px-2 py-1 rounded bg-emerald-600 text-white text-[10px] uppercase tracking-wider font-semibold">
              Enrolled
            </span>
          </div>

          <p className="text-[11px] text-muted-foreground">
            You can still add fee schedules and additional payments from the Student detail page after conversion.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            onClick={submit}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white border-0"
            data-testid="cv-submit"
          >
            <CheckCircle size={14} className="mr-1.5" />
            {saving ? "Converting…" : "Convert to enrolled"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

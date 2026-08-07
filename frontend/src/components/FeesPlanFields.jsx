import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";

export const INSTALLMENT_MODES = [
  { value: "yearly", label: "Yearly" },
  { value: "semester", label: "Semester" },
];

export const PACKAGE_STATUS = [
  { value: "admission_tuition", label: "Only Admission & Tuition Fees" },
  { value: "incl_food_accomm", label: "Including Food & Accommodation" },
];

export const emptyFeesPlan = () => ({
  installment_mode: "yearly",
  year_1: "",
  year_2: "",
  year_3: "",
  year_4: "",
  has_scholarship: false,
  scholarship_amount: "",
  package_status: "admission_tuition",
});

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function computeTotalFees(fp) {
  if (!fp) return 0;
  const sum = num(fp.year_1) + num(fp.year_2) + num(fp.year_3) + num(fp.year_4);
  const scholarship = fp.has_scholarship ? num(fp.scholarship_amount) : 0;
  return Math.max(0, sum - scholarship);
}

export function normalizeFeesPlanForApi(fp) {
  if (!fp) return null;
  return {
    installment_mode: fp.installment_mode || "yearly",
    year_1: num(fp.year_1),
    year_2: num(fp.year_2),
    year_3: fp.year_3 === "" || fp.year_3 === null ? null : num(fp.year_3),
    year_4: fp.year_4 === "" || fp.year_4 === null ? null : num(fp.year_4),
    has_scholarship: !!fp.has_scholarship,
    scholarship_amount: fp.has_scholarship ? num(fp.scholarship_amount) : 0,
    package_status: fp.package_status || "admission_tuition",
  };
}

export function feesPlanFromApi(fp) {
  if (!fp) return emptyFeesPlan();
  return {
    installment_mode: fp.installment_mode || "yearly",
    year_1: fp.year_1 ?? "",
    year_2: fp.year_2 ?? "",
    year_3: fp.year_3 ?? "",
    year_4: fp.year_4 ?? "",
    has_scholarship: !!fp.has_scholarship,
    scholarship_amount: fp.scholarship_amount ?? "",
    package_status: fp.package_status || "admission_tuition",
  };
}

/**
 * Shared editable fees-plan block.
 * Props: fp (state object), onChange (next: object) => void, currency
 */
export default function FeesPlanFields({ fp, onChange, currency = "USD" }) {
  const update = (patch) => onChange({ ...fp, ...patch });
  const total = computeTotalFees(fp);

  return (
    <div className="rounded-md border border-border p-4 space-y-4 bg-muted/40/60" data-testid="fees-plan-block">
      <div className="flex items-center justify-between gap-3">
        <p className="label-eyebrow">Fees fixed at admission</p>
        <div className="w-44">
          <Select value={fp.installment_mode} onValueChange={(v) => update({ installment_mode: v })}>
            <SelectTrigger className="h-9" data-testid="fp-installment-mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INSTALLMENT_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>1st Year *</Label>
          <Input
            type="number" step="0.01" required
            value={fp.year_1}
            onChange={(e) => update({ year_1: e.target.value })}
            placeholder="0.00"
            data-testid="fp-year-1"
          />
        </div>
        <div>
          <Label>2nd Year *</Label>
          <Input
            type="number" step="0.01" required
            value={fp.year_2}
            onChange={(e) => update({ year_2: e.target.value })}
            placeholder="0.00"
            data-testid="fp-year-2"
          />
        </div>
        <div>
          <Label>3rd Year</Label>
          <Input
            type="number" step="0.01"
            value={fp.year_3}
            onChange={(e) => update({ year_3: e.target.value })}
            placeholder="Optional"
            data-testid="fp-year-3"
          />
        </div>
        <div>
          <Label>4th Year</Label>
          <Input
            type="number" step="0.01"
            value={fp.year_4}
            onChange={(e) => update({ year_4: e.target.value })}
            placeholder="Optional"
            data-testid="fp-year-4"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={!!fp.has_scholarship}
            onCheckedChange={(v) => update({ has_scholarship: !!v, scholarship_amount: v ? fp.scholarship_amount : "" })}
            data-testid="fp-has-scholarship"
          />
          <span className="text-sm font-medium">Scholarship given</span>
        </label>
        {fp.has_scholarship && (
          <div>
            <Label className="text-xs">Scholarship amount</Label>
            <Input
              type="number" step="0.01"
              value={fp.scholarship_amount}
              onChange={(e) => update({ scholarship_amount: e.target.value })}
              placeholder="0.00"
              data-testid="fp-scholarship-amount"
            />
          </div>
        )}
      </div>

      <div>
        <Label>Package Status</Label>
        <Select value={fp.package_status} onValueChange={(v) => update({ package_status: v })}>
          <SelectTrigger data-testid="fp-package-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PACKAGE_STATUS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="label-eyebrow">Total Fees</span>
        <span className="font-display text-xl tabular-nums" data-testid="fp-total-fees">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}

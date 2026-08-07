import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInr, Warning } from "@phosphor-icons/react";

/**
 * Editor for the confidential per-course "SC received from college" rates.
 * Rendered inside the College create/edit dialog for super_admin only.
 *
 * Props:
 *   courses  : string[]    the current comma-parsed course list
 *   rates    : Record<string, number|"">  keyed by course name → INR amount
 *   onChange : (rates) => void
 */
export default function CollegeScRatesEditor({ courses, rates, onChange }) {
  const list = (courses || []).map((c) => (c || "").trim()).filter(Boolean);

  if (list.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground flex items-center gap-2"
        data-testid="sc-rates-empty"
      >
        <Warning size={14} />
        Add at least one course above to set its service-charge amount.
      </div>
    );
  }

  const set = (course, val) => {
    onChange({ ...(rates || {}), [course]: val });
  };

  return (
    <div className="space-y-2" data-testid="sc-rates-editor">
      {list.map((course) => {
        const raw = rates?.[course];
        const value = raw === undefined || raw === null ? "" : String(raw);
        return (
          <div
            key={course}
            className="grid grid-cols-[1fr_auto] items-center gap-2"
            data-testid={`sc-rate-row-${course.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <Label className="truncate text-xs" title={course}>
              {course}
            </Label>
            <div className="relative">
              <CurrencyInr
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                className="pl-6 w-40 h-8 text-sm"
                value={value}
                onChange={(e) => set(course, e.target.value)}
                placeholder="0"
                data-testid={`sc-rate-input-${course.toLowerCase().replace(/\s+/g, "-")}`}
              />
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground mt-1">
        These amounts are <strong>confidential</strong> — only Super Admin can see
        or edit them.
      </p>
    </div>
  );
}

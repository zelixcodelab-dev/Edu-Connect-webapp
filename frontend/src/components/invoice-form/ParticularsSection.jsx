import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "@phosphor-icons/react";

export const PARTICULAR_PRESETS = [
  "Car Rent",
  "Fuel Expense",
  "Cab Expense",
  "Toll",
  "Food",
  "Driver Salary",
  "Other",
];

export default function ParticularsSection({ form, isService, updatePart, addPart, removePart }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label>Particulars</Label>
        {!isService && (
          <Button type="button" size="sm" variant="outline" onClick={addPart} data-testid="inv-add-part">
            <Plus size={14} className="mr-1" /> Add row
          </Button>
        )}
      </div>
      {isService ? (
        <div className="grid grid-cols-12 gap-2 items-center">
          <Input
            className="col-span-5 bg-muted/40"
            value="Service Charge"
            readOnly
            data-testid="inv-service-label"
          />
          <Input
            className="col-span-7"
            type="number"
            step="0.01"
            placeholder="Service charge amount"
            value={form.particulars[0]?.amount || ""}
            onChange={(e) => updatePart(0, "amount", e.target.value)}
            data-testid="inv-service-amount"
          />
        </div>
      ) : (
        <div className="space-y-2">
          {form.particulars.map((p, idx) => (
            <div key={p._key || idx} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-5">
                <Select value={p.kind} onValueChange={(v) => updatePart(idx, "kind", v)}>
                  <SelectTrigger data-testid={`inv-part-kind-${idx}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PARTICULAR_PRESETS.map((k) => (
                      <SelectItem key={k} value={k}>{k}{k === "Other" ? " (Specify)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {p.kind === "Other" && (
                  <Input
                    className="mt-2"
                    value={p.specify}
                    onChange={(e) => updatePart(idx, "specify", e.target.value)}
                    placeholder="Specify…"
                    data-testid={`inv-part-spec-${idx}`}
                  />
                )}
              </div>
              <Input
                className="col-span-6"
                type="number"
                step="0.01"
                placeholder="Amount"
                value={p.amount}
                onChange={(e) => updatePart(idx, "amount", e.target.value)}
                data-testid={`inv-part-amt-${idx}`}
              />
              <button
                type="button"
                onClick={() => removePart(idx)}
                disabled={form.particulars.length === 1}
                className="col-span-1 text-muted-foreground/70 hover:text-rose-700 dark:text-rose-400 disabled:opacity-30 h-10 flex items-center justify-center"
                data-testid={`inv-part-remove-${idx}`}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Office/branch names for a new client. Empty first row = company name.
export function OfficeNamesInput({ value, onChange, companyName }) {
  const rows = value.length ? value : [""];
  const set = (i, v) => onChange(rows.map((r, j) => (j === i ? v : r)));
  return (
    <div className="space-y-2" data-testid="new-client-offices">
      <div>
        <Label>Offices / branches</Label>
        <p className="text-xs text-muted-foreground mt-0.5">The client only sees the offices listed here. Leave the first one empty to use the company name.</p>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input value={r} onChange={(e) => set(i, e.target.value)} placeholder={i === 0 ? (companyName || "Company name") : `Branch ${i + 1} name`}
            data-testid={`new-client-office-${i}`} />
          {rows.length > 1 && (
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove office"
              className="w-9 shrink-0 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground" data-testid={`new-client-office-remove-${i}`}>
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, ""])} className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:underline" data-testid="new-client-office-add">
        <Plus size={13} /> Add another office
      </button>
    </div>
  );
}

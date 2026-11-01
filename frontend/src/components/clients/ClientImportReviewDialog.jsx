import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { clientTypeLabel } from "@/pages/Clients";

const FIELD_LABELS = {
  name: "Name", client_type: "Type", email: "Email", phone: "Phone", company: "Company", office: "Office",
  home_office: "Home office", place: "Place", address: "Address", eligible_incentive: "Incentive",
  date_of_birth: "DOB", employee_id: "Employee ID", designation: "Designation", department: "Department",
  date_of_joining: "DOJ",
};

export default function ClientImportReviewDialog({ preview, busy, onConfirm, onCancel }) {
  const rows = preview?.rows || [];
  const errors = preview?.errors || [];
  return (
    <Dialog open={!!preview} onOpenChange={(v) => { if (!v && !busy) onCancel(); }}>
      <DialogContent className="bg-card max-w-lg overflow-y-auto" data-testid="client-import-review-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Review import</DialogTitle>
          <DialogDescription data-testid="client-import-summary">
            {preview?.to_create ?? 0} new · {preview?.to_update ?? 0} update{preview?.to_update === 1 ? "" : "s"} · {errors.length} skipped. Nothing is saved until you confirm.
          </DialogDescription>
        </DialogHeader>
        {rows.length > 0 && (
          <ul className="divide-y divide-border border border-border rounded-md max-h-64 overflow-y-auto" data-testid="client-import-valid-list">
            {rows.map((r, i) => (
              <li key={i} className="px-3 py-2 text-sm flex items-center justify-between gap-3" data-testid={`client-import-row-${i}`}>
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.name}</p>
                  {r.action === "update" && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      Updates {r.match_name}: {r.fields.length ? r.fields.map((f) => FIELD_LABELS[f] || f).join(", ") : "no changes"}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {clientTypeLabel(r.client_type)}{r.phone ? ` · ${r.phone}` : ""}
                  </span>
                  <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${r.action === "update" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`} data-testid={`client-import-action-${i}`}>
                    {r.action === "update" ? "Update" : "New"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {errors.length > 0 && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3" data-testid="client-import-errors">
            <p className="text-xs uppercase tracking-wider font-semibold text-rose-700 dark:text-rose-300 mb-1.5">Skipped rows</p>
            <ul className="space-y-1 text-xs text-muted-foreground max-h-40 overflow-y-auto">
              {errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy} data-testid="client-import-cancel">Cancel</Button>
          <Button className="btn-amber border-0" onClick={onConfirm} disabled={busy || rows.length === 0} data-testid="client-import-confirm">
            {busy ? "Importing…" : `Import ${rows.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

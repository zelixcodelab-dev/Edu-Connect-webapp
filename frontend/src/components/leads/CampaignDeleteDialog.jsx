import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Warning } from "@phosphor-icons/react";

/**
 * Confirm dialog for campaign deletion.
 *
 * Explicitly asks the operator whether the campaign's leads should be purged
 * along with the campaign row. Default is "yes" (checkbox pre-checked) since
 * that's the common intent — you delete a wrong upload, you want the leads
 * gone too. Uncheck to keep the leads in the pipeline (they lose their
 * campaign tag and become "Uncategorised").
 *
 * Works for both single-campaign and bulk deletes:
 *   - single: pass `campaign` (a single row), `leadCount` (its total)
 *   - bulk:   pass `campaigns` (list) + `leadCount` (aggregate)
 */
export default function CampaignDeleteDialog({
  open, onOpenChange,
  campaign,       // for single-delete
  campaigns,     // for bulk-delete (list)
  leadCount = 0,
  busy = false,
  onConfirm,     // (deleteLeads: boolean) => Promise|void
}) {
  const [deleteLeads, setDeleteLeads] = useState(true);
  const isBulk = Array.isArray(campaigns);
  const count = isBulk ? campaigns.length : 1;
  const title = isBulk
    ? `Delete ${count} campaign${count === 1 ? "" : "s"}?`
    : `Delete campaign${campaign?.name ? ` "${campaign.name}"` : ""}?`;
  const hint = leadCount > 0
    ? (isBulk
      ? `${count === 1 ? "This campaign" : "These campaigns"} contain ${leadCount.toLocaleString()} lead${leadCount === 1 ? "" : "s"}.`
      : `This campaign contains ${leadCount.toLocaleString()} lead${leadCount === 1 ? "" : "s"}.`)
    : "";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md" data-testid="campaign-delete-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Warning size={18} weight="fill" className="text-rose-500" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {hint} This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 mt-1 cursor-pointer hover:bg-muted/50 transition-colors">
          <Checkbox
            checked={deleteLeads}
            onCheckedChange={(v) => setDeleteLeads(!!v)}
            data-testid="campaign-delete-with-leads"
            className="mt-0.5"
          />
          <div className="flex-1 text-sm">
            <p className="font-medium text-foreground">Also delete the {leadCount > 0 ? `${leadCount.toLocaleString()} ` : ""}lead{leadCount === 1 ? "" : "s"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Uncheck to keep the leads in the pipeline as <span className="italic">Uncategorised</span>.
            </p>
          </div>
        </label>
        <DialogFooter className="gap-2 mt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            type="button"
            onClick={() => onConfirm?.(deleteLeads)}
            disabled={busy}
            className="bg-rose-600 hover:bg-rose-700 text-white border-0"
            data-testid="campaign-delete-confirm"
          >
            {busy ? "Deleting…" : (deleteLeads && leadCount > 0
              ? `Delete campaign + ${leadCount.toLocaleString()} lead${leadCount === 1 ? "" : "s"}`
              : `Delete campaign${isBulk ? "s" : ""}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

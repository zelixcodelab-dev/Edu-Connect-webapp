import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { LEAD_STATUS_META, LOST_SUBSTAGES } from "./constants";

/**
 * Prompts for a conversation note on any stage change. When the target stage is
 * "lost", also requires a sub-stage (Already Admitted / Adm. Next Year / ...).
 */
export default function StageChangeDialog({ open, onOpenChange, targetStatus, busy, onConfirm }) {
  const [note, setNote] = useState("");
  const [substage, setSubstage] = useState("");
  const isLost = targetStatus === "lost";
  const label = LEAD_STATUS_META[targetStatus]?.label || targetStatus;

  useEffect(() => { if (open) { setNote(""); setSubstage(""); } }, [open, targetStatus]);

  const confirm = () => {
    if (isLost && !substage) return;
    onConfirm({ status_note: note.trim(), lost_reason: isLost ? substage : undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-md" data-testid="stage-change-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Move to “{label}”</DialogTitle>
          <DialogDescription className="text-xs">
            {isLost ? "Pick why this lead was lost and add a short conversation note." : "Add a short conversation note for this stage (optional)."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLost && (
            <div className="space-y-1.5">
              <Label className="text-xs">Lost sub-stage <span className="text-rose-500">*</span></Label>
              <Select value={substage} onValueChange={setSubstage}>
                <SelectTrigger data-testid="lost-substage-select" className="bg-card"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {LOST_SUBSTAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Conversation note</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Outcome / short conversation summary…"
              rows={3}
              data-testid="stage-note-input"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={confirm} disabled={busy || (isLost && !substage)} data-testid="stage-confirm-btn" className="btn-amber border-0">
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

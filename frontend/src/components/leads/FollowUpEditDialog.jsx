import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Trash } from "@phosphor-icons/react";

/**
 * Edit or delete a saved follow-up on a lead.
 *
 * Only surfaces to callers who can actually edit the row:
 *   - the person who originally logged it, OR
 *   - any admin (super_admin / office_admin)
 *
 * The parent decides whether to render the trigger (see LeadJourney) — this
 * dialog just runs the write. It refreshes the parent lead via `onSaved`
 * with the freshest lead payload from the backend.
 *
 * Status transitions attached at follow-up creation time are intentionally
 * NOT editable here — they belong to ``status_history`` and are audit trail.
 */
function toLocalDatetimeInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // <input type="datetime-local"> wants YYYY-MM-DDTHH:MM in local tz.
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(localValue) {
  // datetime-local produces a value in the user's local timezone (no offset).
  // `new Date(v)` interprets it as local time; toISOString() re-normalises to UTC.
  if (!localValue) return null;
  const d = new Date(localValue);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function FollowUpEditDialog({ open, onOpenChange, leadId, followup, onSaved }) {
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!open || !followup) return;
    setWhen(toLocalDatetimeInput(followup.at));
    setNote(followup.note || "");
    setConfirmingDelete(false);
  }, [open, followup]);

  if (!followup) return null;

  const save = async () => {
    const iso = toIso(when);
    if (!iso) { toast.error("Pick a valid date & time"); return; }
    setBusy(true);
    try {
      const { data } = await api.patch(`/leads/${leadId}/followups/${followup.id}`, {
        at: iso,
        note,
      });
      toast.success("Follow-up updated");
      onSaved?.(data);
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update follow-up");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/leads/${leadId}/followups/${followup.id}`);
      toast.success("Follow-up deleted");
      onSaved?.(data);
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not delete follow-up");
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md" data-testid="followup-edit-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Edit follow-up</DialogTitle>
          <DialogDescription className="text-xs">
            Change the scheduled time or the note. Status transition history is preserved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fu-at">Scheduled at</Label>
            <Input
              id="fu-at"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              data-testid="followup-at-input"
              className="bg-card"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fu-note">Note</Label>
            <Textarea
              id="fu-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Customer requested 3pm instead"
              data-testid="followup-note-input"
            />
          </div>
          {followup.edited_by_name && (
            <p className="text-[11px] text-muted-foreground">
              Last edited by {followup.edited_by_name}
              {followup.edited_at ? ` · ${new Date(followup.edited_at).toLocaleString()}` : ""}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 h-9 px-3 rounded-md flex items-center gap-1.5 transition-colors disabled:opacity-50"
              data-testid="followup-delete-btn"
            >
              <Trash size={13} /> Delete follow-up
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-1">Sure?</span>
              <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={remove} disabled={busy} className="bg-rose-600 hover:bg-rose-700 text-white border-0"
                data-testid="followup-delete-confirm">
                {busy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || confirmingDelete} className="btn-amber border-0"
              data-testid="followup-save-btn">
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

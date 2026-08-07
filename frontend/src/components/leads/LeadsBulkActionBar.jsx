import React, { useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Trash, UserCheck, Kanban, Megaphone, X } from "@phosphor-icons/react";
import { LEAD_STATUSES, LEAD_STATUS_META } from "./constants";

/**
 * Floating bulk action bar for the Leads pipeline.
 *
 * Appears above the grid whenever `count > 0`. Exposes bulk delete / reassign
 * / status-change / campaign attach — respecting the caller's role
 * (staff → read-only, no bulk actions).
 *
 * All actions POST /api/leads/bulk-actions with the selected ids and rely on
 * the parent to refresh (`onDone`) after success.
 */
export default function LeadsBulkActionBar({
  count,
  selectedIds,
  isStaff = false,
  assignable = [],
  campaigns = [],
  onClear,
  onDone,
}) {
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [campOpen, setCampOpen] = useState(false);
  const [pickAssignee, setPickAssignee] = useState("");
  const [pickStatus, setPickStatus] = useState("");
  const [pickCampaign, setPickCampaign] = useState("");

  if (!count) return null;

  const call = async (payload, successMsg) => {
    setBusy(true);
    try {
      const { data } = await api.post("/leads/bulk-actions", payload);
      toast.success(successMsg.replace("{n}", data.count ?? count));
      onDone?.();
      onClear?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Bulk action failed");
    } finally {
      setBusy(false);
      setAssignOpen(false);
      setStatusOpen(false);
      setCampOpen(false);
    }
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete ${count} lead(s)? This cannot be undone.`)) return;
    call({ ids: selectedIds, action: "delete" }, "Deleted {n} lead(s)");
  };
  const handleAssign = () =>
    call(
      { ids: selectedIds, action: "assign", assigned_to_user_id: pickAssignee || null },
      pickAssignee ? "Reassigned {n} lead(s)" : "Unassigned {n} lead(s)",
    );
  const handleStatus = () =>
    call(
      { ids: selectedIds, action: "status", status: pickStatus },
      "Moved {n} lead(s)",
    );
  const handleCampaign = () =>
    call(
      { ids: selectedIds, action: "campaign", campaign_id: pickCampaign || null },
      pickCampaign ? "Attached {n} lead(s)" : "Detached {n} lead(s)",
    );

  return (
    <>
      <div
        data-testid="leads-bulk-bar"
        className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50/90 dark:bg-amber-500/10 backdrop-blur px-3 py-2 shadow-md animate-fade-in"
      >
        <span className="text-sm font-medium text-amber-900 dark:text-amber-200" data-testid="leads-bulk-count">
          {count} selected
        </span>
        <div className="flex-1" />
        {!isStaff && (
          <>
            <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)} disabled={busy}
              data-testid="bulk-assign-btn">
              <UserCheck size={14} className="mr-1.5" /> Assign
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStatusOpen(true)} disabled={busy}
              data-testid="bulk-status-btn">
              <Kanban size={14} className="mr-1.5" /> Status
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCampOpen(true)} disabled={busy}
              data-testid="bulk-campaign-btn">
              <Megaphone size={14} className="mr-1.5" /> Campaign
            </Button>
            <Button size="sm" variant="outline" onClick={handleDelete} disabled={busy}
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 border-rose-500/30"
              data-testid="bulk-delete-btn">
              <Trash size={14} className="mr-1.5" /> Delete
            </Button>
          </>
        )}
        <button type="button" onClick={onClear} data-testid="bulk-clear-btn"
          className="h-8 w-8 rounded-md flex items-center justify-center text-amber-900/70 hover:bg-amber-500/15 dark:text-amber-200/80">
          <X size={16} />
        </button>
      </div>

      {/* Assign dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md" data-testid="bulk-assign-dialog">
          <DialogHeader><DialogTitle>Assign {count} lead(s)</DialogTitle></DialogHeader>
          <div className="py-2">
            <p className="text-xs text-muted-foreground mb-2">Choose the new assignee, or leave empty to unassign.</p>
            <Select value={pickAssignee} onValueChange={setPickAssignee}>
              <SelectTrigger data-testid="bulk-assign-select"><SelectValue placeholder="— Unassigned —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassign__">— Unassigned —</SelectItem>
                {assignable.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const val = pickAssignee === "__unassign__" ? "" : pickAssignee;
                setPickAssignee(val);
                handleAssign();
              }}
              disabled={busy}
              className="btn-amber border-0"
              data-testid="bulk-assign-confirm"
            >Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status dialog */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="max-w-md" data-testid="bulk-status-dialog">
          <DialogHeader><DialogTitle>Move {count} lead(s) to…</DialogTitle></DialogHeader>
          <div className="py-2">
            <Select value={pickStatus} onValueChange={setPickStatus}>
              <SelectTrigger data-testid="bulk-status-select"><SelectValue placeholder="Pick a stage" /></SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{LEAD_STATUS_META[s]?.label || s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusOpen(false)}>Cancel</Button>
            <Button onClick={handleStatus} disabled={busy || !pickStatus} className="btn-amber border-0"
              data-testid="bulk-status-confirm">Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Campaign dialog */}
      <Dialog open={campOpen} onOpenChange={setCampOpen}>
        <DialogContent className="max-w-md" data-testid="bulk-campaign-dialog">
          <DialogHeader><DialogTitle>Attach {count} lead(s) to campaign</DialogTitle></DialogHeader>
          <div className="py-2">
            <p className="text-xs text-muted-foreground mb-2">Pick a campaign, or choose &quot;Uncategorised&quot; to detach.</p>
            <Select value={pickCampaign} onValueChange={setPickCampaign}>
              <SelectTrigger data-testid="bulk-campaign-select"><SelectValue placeholder="— Uncategorised —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__detach__">— Uncategorised —</SelectItem>
                {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const val = pickCampaign === "__detach__" ? "" : pickCampaign;
                setPickCampaign(val);
                handleCampaign();
              }}
              disabled={busy}
              className="btn-amber border-0"
              data-testid="bulk-campaign-confirm"
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ActionDialog({
  actioning,
  onClose,
  requesterAccounts,
  approveAccountId,
  setApproveAccountId,
  decisionNote,
  setDecisionNote,
  onConfirm,
}) {
  return (
    <Dialog open={!!actioning} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="action-dialog">
        <DialogHeader>
          <DialogTitle>
            {actioning?.mode === "approve" ? "Approve request" : "Reject request"}
          </DialogTitle>
          <DialogDescription>
            {actioning?.mode === "approve"
              ? "An expense transaction will be created on the requester's books in the chosen account."
              : "The requester will see this status. You can add a note."}
          </DialogDescription>
        </DialogHeader>
        {actioning?.mode === "approve" && (
          <div className="space-y-1.5">
            <Label>Account to debit</Label>
            <Select value={approveAccountId} onValueChange={setApproveAccountId}>
              <SelectTrigger className="bg-card" data-testid="approve-account-select">
                <SelectValue placeholder="Pick requester's account" />
              </SelectTrigger>
              <SelectContent>
                {(requesterAccounts.length ? requesterAccounts : []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
                {requesterAccounts.length === 0 && actioning.req?.account_id && (
                  <SelectItem value={actioning.req.account_id}>(Suggested account)</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Defaults to the requester's suggested account.</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Note (optional)</Label>
          <Textarea rows={2} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} data-testid="decision-note" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={onConfirm}
            data-testid="action-confirm"
            className={actioning?.mode === "approve" ? "btn-amber border-0" : "bg-rose-600 hover:bg-rose-700 text-white"}
          >
            {actioning?.mode === "approve" ? "Approve & create txn" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

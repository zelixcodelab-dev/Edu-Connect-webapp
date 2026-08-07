import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fromLocalInput } from "./constants";
import VisitFields from "./VisitFields";

const EMPTY_VISIT = { institution: "", departure_at: "", arrival_at: "", travel_mode: "", who_comes: "", drop_point: "" };

// Capture form shown when a lead is marked "Interested": parent/alternate
// numbers + optional campus-visit schedule (WhatsApps the student on submit).
export default function InterestedDialog({ open, onOpenChange, lead, onDone }) {
  const [parentNumber, setParentNumber] = useState("");
  const [altNumber, setAltNumber] = useState("");
  const [visitInterested, setVisitInterested] = useState(false);
  const [visit, setVisit] = useState(EMPTY_VISIT);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setParentNumber(lead?.parent_number || "");
      setAltNumber(lead?.alternate_number || "");
      setVisitInterested(false);
      setVisit(EMPTY_VISIT);
    }
  }, [open, lead]);

  const submit = async () => {
    if (visitInterested && (!visit.departure_at || !visit.arrival_at)) {
      toast.error("Departure and arrival date & time are required for the visit");
      return;
    }
    setBusy(true);
    try {
      const body = {
        parent_number: parentNumber.trim(),
        alternate_number: altNumber.trim(),
        campus_visit_interested: visitInterested,
        visit: visitInterested
          ? {
              institution: visit.institution,
              departure_at: fromLocalInput(visit.departure_at),
              arrival_at: fromLocalInput(visit.arrival_at),
              travel_mode: visit.travel_mode,
              who_comes: visit.who_comes,
              drop_point: visit.drop_point,
            }
          : null,
      };
      const { data } = await api.post(`/leads/${lead.id}/interested`, body);
      toast.success("Marked Interested");
      if (visitInterested) {
        if (data.whatsapp?.ok) toast.success("Campus-visit WhatsApp sent to the student");
        else toast.warning(`Visit saved, but WhatsApp failed: ${data.whatsapp?.detail || "unknown error"}`);
      }
      onDone?.(data.lead);
      onOpenChange(false);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  if (!lead) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-lg" data-testid="interested-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Mark Interested · {lead.name}</DialogTitle>
          <DialogDescription>Collect the student's contact details and optionally schedule a campus visit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-xs">Parent number</Label>
              <Input value={parentNumber} onChange={(e) => setParentNumber(e.target.value)} placeholder="10-digit mobile" data-testid="interested-parent-input" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Alternate number</Label>
              <Input value={altNumber} onChange={(e) => setAltNumber(e.target.value)} placeholder="Optional" data-testid="interested-alt-input" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none" data-testid="interested-visit-tick">
            <Checkbox checked={visitInterested} onCheckedChange={(v) => setVisitInterested(!!v)} />
            <span>Campus visit interested?</span>
          </label>
          {visitInterested && (
            <div className="rounded-lg border border-border p-3 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Schedule the visit</p>
              <VisitFields value={visit} onChange={setVisit} />
              <p className="text-[11px] text-muted-foreground">
                On submit the student gets a WhatsApp confirmation and admins are notified.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={busy} className="btn-amber border-0" data-testid="interested-submit-btn">
            {busy ? "Saving…" : "Save & mark Interested"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

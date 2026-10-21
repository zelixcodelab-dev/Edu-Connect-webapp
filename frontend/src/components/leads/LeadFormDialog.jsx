import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { LEAD_STATUSES, LEAD_STATUS_META, LEAD_SOURCES } from "./constants";

const empty = {
  name: "", phone: "", email: "", course: "", place: "",
  source: "walk_in", status: "new", assigned_to_user_id: "", campaign_id: "", notes: "", lost_reason: "",
};

const LOST_REASONS = ["Admission Taken", "No Response", "Joined Competitor", "Not Eligible", "Other"];

export default function LeadFormDialog({ open, onOpenChange, lead, assignable, user, onSaved }) {
  const isEdit = !!lead;
  const isStaff = user?.role === "staff";
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [campaigns, setCampaigns] = useState([]);

  useEffect(() => {
    if (open) {
      setForm(lead ? {
        name: lead.name || "", phone: lead.phone || "", email: lead.email || "",
        course: lead.course || "", place: lead.place || "", source: lead.source || "walk_in",
        status: lead.status || "new", assigned_to_user_id: lead.assigned_to_user_id || "",
        campaign_id: lead.campaign_id || "",
        notes: lead.notes || "", lost_reason: lead.lost_reason || "",
      } : empty);
      api.get("/leads/assigned-campaigns")
        .then((r) => setCampaigns(Array.isArray(r.data) ? r.data : []))
        .catch(() => setCampaigns([]));
    }
  }, [open, lead]);

  const handle = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Lead name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        course: form.course.trim(),
        place: form.place.trim(),
        source: form.source,
        status: form.status,
        notes: form.notes.trim(),
        lost_reason: form.status === "lost" ? (form.lost_reason || "") : "",
      };
      if (!isStaff) payload.assigned_to_user_id = form.assigned_to_user_id || null;
      if (isEdit) {
        await api.patch(`/leads/${lead.id}`, payload);
        if ((form.campaign_id || "") !== (lead.campaign_id || "")) {
          await api.post(`/leads/${lead.id}/campaign`, { campaign_id: form.campaign_id || null });
        }
        toast.success("Lead updated");
      } else {
        payload.campaign_id = form.campaign_id || null;
        await api.post("/leads", payload);
        toast.success("Lead added");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not save lead");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-lg" data-testid="lead-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">{isEdit ? "Edit lead" : "Add lead"}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isStaff ? "This lead will be assigned to you." : "Capture a prospective student and assign it to a team member."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="lead-name">Name *</Label>
            <Input id="lead-name" data-testid="lead-name-input" value={form.name} onChange={handle("name")} placeholder="Full name" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lead-phone">Phone</Label>
              <Input id="lead-phone" data-testid="lead-phone-input" value={form.phone} onChange={handle("phone")} placeholder="Mobile number" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-email">Email</Label>
              <Input id="lead-email" type="email" data-testid="lead-email-input" value={form.email} onChange={handle("email")} placeholder="email@example.com" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lead-course">Course interested</Label>
              <Input id="lead-course" data-testid="lead-course-input" value={form.course} onChange={handle("course")} placeholder="e.g. B.Tech CSE" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-place">Place / City</Label>
              <Input id="lead-place" data-testid="lead-place-input" value={form.place} onChange={handle("place")} placeholder="e.g. Bangalore" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={form.source} onValueChange={(v) => setForm((f) => ({ ...f, source: v }))}>
                <SelectTrigger data-testid="lead-source-select" className="bg-card"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger data-testid="lead-status-select" className="bg-card"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{LEAD_STATUS_META[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.status === "lost" && (
            <div className="space-y-1.5" data-testid="lead-lost-reason-row">
              <Label>Lost reason</Label>
              <Select value={form.lost_reason || ""} onValueChange={(v) => setForm((f) => ({ ...f, lost_reason: v }))}>
                <SelectTrigger data-testid="lead-lost-reason-select" className="bg-card"><SelectValue placeholder="Why was this lead lost?" /></SelectTrigger>
                <SelectContent>
                  {LOST_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Campaign</Label>
            <Select
              value={form.campaign_id || "none"}
              onValueChange={(v) => setForm((f) => ({ ...f, campaign_id: v === "none" ? "" : v }))}
            >
              <SelectTrigger data-testid="lead-campaign-select" className="bg-card">
                <SelectValue placeholder="No campaign" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" data-testid="lead-campaign-none">No campaign</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id} data-testid={`lead-campaign-opt-${c.id}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isStaff && campaigns.length === 0 && (
              <p className="text-[11px] text-muted-foreground" data-testid="lead-campaign-empty">
                No campaigns assigned to you yet.
              </p>
            )}
          </div>

          {!isStaff && (
            <div className="space-y-1.5">
              <Label>Assign to</Label>
              <Select value={form.assigned_to_user_id || "none"} onValueChange={(v) => setForm((f) => ({ ...f, assigned_to_user_id: v === "none" ? "" : v }))}>
                <SelectTrigger data-testid="lead-assignee-select" className="bg-card"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned / me</SelectItem>
                  {(assignable || []).map((u) => (
                    <SelectItem key={u.id} value={u.id} data-testid={`assignee-opt-${u.id}`}>
                      {u.name} · {u.role === "staff" ? "Staff" : "Office admin"}{u.office ? ` · ${u.office.replace("KM_", "")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="lead-notes">Notes</Label>
            <Textarea id="lead-notes" data-testid="lead-notes-input" value={form.notes} onChange={handle("notes")} placeholder="Anything useful…" rows={2} />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} data-testid="lead-save-btn" className="btn-amber border-0">
              {saving ? "Saving…" : (isEdit ? "Save changes" : "Add lead")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

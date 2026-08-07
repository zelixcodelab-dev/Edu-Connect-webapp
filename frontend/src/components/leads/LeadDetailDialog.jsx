import React, { useCallback, useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Phone, EnvelopeSimple, GraduationCap, MapPin, ClockCountdown, PencilSimple, Trash, CalendarPlus, MegaphoneSimple, Bus, UsersThree, WhatsappLogo } from "@phosphor-icons/react";
import { LEAD_STATUSES, LEAD_STATUS_META, sourceLabel, fmtDateTime, toLocalInput, fromLocalInput, VISIT_STATUSES, VISIT_STATUS_META } from "./constants";
import { canEdit } from "@/lib/perm";
import InterestedDialog from "./InterestedDialog";
import ConvertDialog from "./ConvertDialog";
import LeadJourney from "./LeadJourney";
import LeadAttachments from "./LeadAttachments";
import UserAvatar from "@/components/UserAvatar";

function InfoRow({ icon: Icon, children }) {
  if (!children) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-foreground">
      <Icon size={15} className="text-muted-foreground shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  );
}

export default function LeadDetailDialog({ open, onOpenChange, lead, user, onChanged, onEdit, campaigns }) {
  const [local, setLocal] = useState(lead);
  const [fuAt, setFuAt] = useState("");
  const [fuNote, setFuNote] = useState("");
  const [fuStatus, setFuStatus] = useState("");
  // "Change time" override: when true, user is picking a custom time even
  // though an auto-slot is available. Reset on lead change / after save.
  const [fuOverride, setFuOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [slot, setSlot] = useState(null);
  const [interestedOpen, setInterestedOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [admins, setAdmins] = useState([]);
  const [resending, setResending] = useState(false);
  const editable = canEdit(user, "leads");
  const isAdmin = user?.role === "super_admin" || user?.role === "office_admin";

  useEffect(() => { setLocal(lead); setFuAt(""); setFuNote(""); setFuStatus(""); setFuOverride(false); }, [lead]);

  const loadSlot = useCallback(async () => {
    if (!lead?.id) return;
    try {
      const { data } = await api.get("/leads/next-followup-slot", { params: { exclude_lead_id: lead.id } });
      setSlot(data);
      setFuAt(data.is_first ? toLocalInput(data.slot) : "");
    } catch {
      setSlot(null);
    }
  }, [lead?.id]);

  useEffect(() => {
    if (open && editable && local?.status === "follow_up") loadSlot();
  }, [open, editable, local?.status, loadSlot]);

  // Board drag/click to Interested/Converted routes through the capture forms.
  useEffect(() => {
    if (!open || !lead?.__autoAction) return;
    if (lead.__autoAction === "interested") setInterestedOpen(true);
    else if (lead.__autoAction === "converted") setConvertOpen(true);
  }, [open, lead]);

  const hasVisit = !!local?.visit;
  useEffect(() => {
    if (open && hasVisit && isAdmin) {
      api.get("/leads/attending-admins").then(({ data }) => setAdmins(data)).catch(() => {});
    }
  }, [open, hasVisit, isAdmin]);

  if (!local) return null;
  const meta = LEAD_STATUS_META[local.status] || LEAD_STATUS_META.new;

  const refresh = (updated) => { setLocal(updated); onChanged?.(); };

  const changeStatus = async (status) => {
    // Interested & Converted have dedicated capture forms
    if (status === "interested") { setInterestedOpen(true); return; }
    if (status === "converted" && !local.converted_student_id) { setConvertOpen(true); return; }
    setBusy(true);
    try {
      const { data } = await api.patch(`/leads/${local.id}`, { status });
      refresh(data);
      toast.success(`Marked ${LEAD_STATUS_META[status].label}`);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Update failed");
    } finally { setBusy(false); }
  };

  const patchVisit = async (body) => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/leads/${local.id}/visit`, body);
      refresh(data);
      toast.success("Visit updated");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Visit update failed");
    } finally { setBusy(false); }
  };

  const addFollowup = async () => {
    // If auto-slot is available and user hasn't overridden it, use the slot.
    // Otherwise use whatever they typed in the datetime input.
    const useAutoSlot = slot && !slot.is_first && !fuOverride;
    const at = useAutoSlot ? slot.slot : fromLocalInput(fuAt);
    if (!at) { toast.error("Pick a follow-up date & time"); return; }
    setBusy(true);
    try {
      const body = { at, note: fuNote.trim() };
      if (fuStatus) body.status = fuStatus;
      const { data } = await api.post(`/leads/${local.id}/followups`, body);
      refresh(data);
      setFuNote(""); setFuStatus(""); setFuOverride(false);
      toast.success("Follow-up logged");
      loadSlot();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not add follow-up");
    } finally { setBusy(false); }
  };

  const changeCampaign = async (val) => {
    const campaign_id = val === "none" ? null : val;
    if (campaign_id === (local.campaign_id || null)) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/leads/${local.id}/campaign`, { campaign_id });
      refresh(data);
      toast.success(campaign_id ? "Assigned to campaign" : "Removed from campaign");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not update campaign");
    } finally { setBusy(false); }
  };

  const doDelete = async () => {    setBusy(true);
    try {
      await api.delete(`/leads/${local.id}`);
      toast.success("Lead deleted");
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Delete failed");
    } finally { setBusy(false); setConfirmDelete(false); }
  };

  const resendApplicationLink = async () => {
    if (resending) return;
    setResending(true);
    try {
      const { data } = await api.post(`/leads/${local.id}/resend-application-link`);
      refresh(data.lead);
      if (data.ok) toast.success("Application link resent on WhatsApp");
      else toast.warning(`WhatsApp send failed: ${data.whatsapp?.detail || "unknown"}`);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not resend link");
    } finally {
      setResending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-xl" data-testid="lead-detail-dialog">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <DialogTitle className="font-display text-xl" data-testid="lead-detail-name">{local.name}</DialogTitle>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.cls}`} data-testid="lead-detail-status">{meta.label}</span>
          </div>
          <DialogDescription className="sr-only">Lead details, status transitions and journey timeline for {local.name}.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <InfoRow icon={Phone}>{local.phone}</InfoRow>
            <InfoRow icon={EnvelopeSimple}>{local.email}</InfoRow>
            <InfoRow icon={GraduationCap}>{local.course}</InfoRow>
            <InfoRow icon={MapPin}>{local.place}</InfoRow>
            {local.parent_number ? <InfoRow icon={Phone}>{`Parent: ${local.parent_number}`}</InfoRow> : null}
            {local.alternate_number ? <InfoRow icon={Phone}>{`Alternate: ${local.alternate_number}`}</InfoRow> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="px-2 py-0.5 rounded-full bg-muted">{sourceLabel(local.source)}</span>
            {local.assigned_to_name && (
              <span className="pl-0.5 pr-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1.5">
                <UserAvatar name={local.assigned_to_name} photoUrl={local.assigned_to_photo_url} size="xs" />
                {local.assigned_to_name}
              </span>
            )}
            {local.next_follow_up && (
              <span className={`px-2 py-0.5 rounded-full flex items-center gap-1 ${local.is_missed ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-blue-500/10 text-blue-700 dark:text-blue-300"}`}>
                <ClockCountdown size={12} /> {fmtDateTime(local.next_follow_up)}{local.is_missed ? " · Missed" : ""}
              </span>
            )}
          </div>
          {local.notes && <p className="text-sm text-muted-foreground bg-muted/40 rounded-lg p-2.5">{local.notes}</p>}
          {local.converted_student_id && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5" data-testid="lead-converted-note">
              <GraduationCap size={14} /> Converted to a student record.
              {local.conversion_details && (local.conversion_details.course || local.conversion_details.college) && (
                <span className="text-muted-foreground">
                  {[local.conversion_details.course, local.conversion_details.college, local.conversion_details.city].filter(Boolean).join(" · ")}
                </span>
              )}
            </p>
          )}

          {/* Campus visit */}
          {local.visit && (
            <div className="rounded-lg border border-border p-3 space-y-2.5" data-testid="lead-visit-panel">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Bus size={14} /> Campus visit</p>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${(VISIT_STATUS_META[local.visit.status] || VISIT_STATUS_META.scheduled).cls}`} data-testid="visit-status-badge">
                  {(VISIT_STATUS_META[local.visit.status] || VISIT_STATUS_META.scheduled).label}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
                {local.visit.institution && <p className="text-muted-foreground sm:col-span-2">Institution: <span className="text-foreground">{local.visit.institution}</span></p>}
                <p className="text-muted-foreground">Departure: <span className="text-foreground">{fmtDateTime(local.visit.departure_at)}</span></p>
                <p className="text-muted-foreground">Arrival: <span className="text-foreground">{fmtDateTime(local.visit.arrival_at)}</span></p>
                {local.visit.travel_mode && <p className="text-muted-foreground">Travel: <span className="text-foreground">{local.visit.travel_mode}</span></p>}
                {local.visit.who_comes && <p className="text-muted-foreground">Who comes: <span className="text-foreground">{local.visit.who_comes}</span></p>}
                {local.visit.drop_point && <p className="text-muted-foreground sm:col-span-2">Pick-up/Drop: <span className="text-foreground">{local.visit.drop_point}</span></p>}
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1" data-testid="visit-wa-status">
                <WhatsappLogo size={13} className={local.visit.whatsapp_sent ? "text-emerald-600" : "text-rose-500"} />
                {local.visit.whatsapp_sent ? "WhatsApp confirmation sent to student" : "WhatsApp not sent"}
              </p>
              {isAdmin && editable ? (
                <>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1"><UsersThree size={13} /> Attending</p>
                    <Select
                      value={local.visit.attending_admin_id || "none"}
                      onValueChange={(v) => patchVisit({ attending_admin_id: v === "none" ? "" : v })}
                      disabled={busy}
                    >
                      <SelectTrigger data-testid="visit-attending-select" className="bg-card h-9"><SelectValue placeholder="Assign who attends" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {admins.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name} · {a.role === "super_admin" ? "Super admin" : `Office (${a.office || "—"})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {VISIT_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={busy || s === local.visit.status}
                        onClick={() => patchVisit({ status: s })}
                        data-testid={`visit-status-chip-${s}`}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${s === local.visit.status ? VISIT_STATUS_META[s].cls : "border-border text-muted-foreground hover:bg-muted"}`}
                      >
                        {VISIT_STATUS_META[s].label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                local.visit.attending_admin_name && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><UsersThree size={13} /> Attending: {local.visit.attending_admin_name}</p>
                )
              )}
            </div>
          )}

          {/* Quick status */}
          {editable && (
            <div className="flex flex-wrap gap-1.5">
              {LEAD_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy || s === local.status}
                  onClick={() => changeStatus(s)}
                  data-testid={`lead-status-chip-${s}`}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${s === local.status ? LEAD_STATUS_META[s].cls : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  {LEAD_STATUS_META[s].label}
                </button>
              ))}
            </div>
          )}

          {/* Assign to campaign — admins only, shown in the All-leads view */}
          {editable && isAdmin && Array.isArray(campaigns) && (
            <div className="rounded-lg border border-border p-3 space-y-2" data-testid="lead-campaign-assign">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><MegaphoneSimple size={14} /> Campaign</p>
              <Select value={local.campaign_id || "none"} onValueChange={changeCampaign} disabled={busy}>
                <SelectTrigger data-testid="lead-campaign-select" className="bg-card"><SelectValue placeholder="No campaign" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No campaign · Uncategorised</SelectItem>
                  {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Log follow-up — only shown once the lead is in the Follow-up stage */}
          {editable && local.status === "follow_up" && (
            <div className="rounded-lg border border-border p-3 space-y-2.5" data-testid="followup-form">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><CalendarPlus size={14} /> Log a follow-up</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {slot && !slot.is_first && !fuOverride ? (
                  <div className="flex flex-col justify-center rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 relative" data-testid="followup-auto-slot">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><ClockCountdown size={11} /> Auto-assigned slot</span>
                    <span className="text-sm font-medium text-foreground" data-testid="followup-auto-slot-value">{fmtDateTime(slot.slot)}</span>
                    <button
                      type="button"
                      onClick={() => { setFuOverride(true); setFuAt(toLocalInput(slot.slot)); }}
                      className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded-md text-blue-700 dark:text-blue-300 hover:bg-blue-500/15 flex items-center gap-1 transition-colors"
                      data-testid="followup-override-btn"
                      aria-label="Change time"
                    >
                      <PencilSimple size={11} /> Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input type="datetime-local" value={fuAt} onChange={(e) => setFuAt(e.target.value)} data-testid="followup-at-input" />
                    {slot && !slot.is_first && fuOverride && (
                      <button
                        type="button"
                        onClick={() => { setFuOverride(false); setFuAt(""); }}
                        className="absolute -top-1 right-0 text-[10px] px-1.5 py-0.5 rounded-md text-muted-foreground hover:text-blue-600 hover:bg-blue-500/10 transition-colors"
                        data-testid="followup-use-slot-btn"
                      >
                        Use auto-slot
                      </button>
                    )}
                  </div>
                )}
                <Select value={fuStatus || "keep"} onValueChange={(v) => setFuStatus(v === "keep" ? "" : v)}>
                  <SelectTrigger data-testid="followup-status-select" className="bg-card"><SelectValue placeholder="Keep status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Keep current status</SelectItem>
                    {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{LEAD_STATUS_META[s].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {slot && (
                <p className="text-[11px] text-muted-foreground" data-testid="followup-slot-hint">
                  {slot.is_first
                    ? "First follow-up — pick any time. The next ones auto-fill your next free 5-min slot (10:00–19:00)."
                    : (fuOverride
                        ? "You're picking a custom time. Save when ready, or use the auto-slot again above."
                        : "Auto-assigned to your next free 5-min slot. Tap “Change” if the customer requested another time.")}
                </p>
              )}
              <Textarea value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="Outcome / note" rows={2} data-testid="followup-note-input" />
              <Button type="button" size="sm" onClick={addFollowup} disabled={busy} data-testid="followup-save-btn" className="btn-amber border-0">Save follow-up</Button>
            </div>
          )}

          {/* Journey timeline (status transitions, follow-ups, visit, created) */}
          <LeadJourney
            lead={local}
            canResend={editable && isAdmin && !!local.converted_student_id && !!local.phone}
            onResendLink={resendApplicationLink}
            resending={resending}
            editable={editable}
            viewerUserId={user?.id}
            viewerIsAdmin={isAdmin}
            onLeadChanged={(fresh) => refresh(fresh)}
          />

          {/* Attachments — admin-only edit; view for everyone */}
          <LeadAttachments
            lead={local}
            canManage={editable && isAdmin}
            onChanged={(fresh) => refresh(fresh)}
          />

          {editable && (
            <div className="flex items-center justify-between pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => { onOpenChange(false); onEdit?.(local); }} data-testid="lead-edit-btn">
                <PencilSimple size={14} className="mr-1.5" /> Edit details
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} data-testid="lead-delete-btn" className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10">
                <Trash size={14} className="mr-1.5" /> Delete
              </Button>
            </div>
          )}
        </div>
      </DialogContent>

      <InterestedDialog
        open={interestedOpen}
        onOpenChange={setInterestedOpen}
        lead={local}
        onDone={(fresh) => refresh(fresh)}
      />
      <ConvertDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        lead={local}
        onDone={(patch) => refresh({ ...local, ...patch })}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="lead-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes {local.name} and its journey history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-rose-600 hover:bg-rose-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

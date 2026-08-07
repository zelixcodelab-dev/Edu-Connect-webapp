import React, { useEffect, useMemo, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { WhatsappLogo } from "@phosphor-icons/react";
import { fromLocalInput } from "./constants";
import { buildApplyUrl } from "@/lib/applyUrl";
import VisitFields from "./VisitFields";

const EMPTY_VISIT = { institution: "", departure_at: "", arrival_at: "", travel_mode: "", who_comes: "", drop_point: "" };

// Capture form shown when a lead is marked "Converted": pick City / Course /
// College, WhatsApp the referral application link, optional campus visit.
export default function ConvertDialog({ open, onOpenChange, lead, onDone }) {
  const [colleges, setColleges] = useState([]);
  const [city, setCity] = useState("");
  const [course, setCourse] = useState("");
  const [college, setCollege] = useState("");
  const [sendLink, setSendLink] = useState(true);
  const [visitInterested, setVisitInterested] = useState(false);
  const [visit, setVisit] = useState(EMPTY_VISIT);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCity("");
    setCourse(lead?.course || "");
    setCollege("");
    setSendLink(true);
    setVisitInterested(false);
    setVisit(EMPTY_VISIT);
    api.get("/colleges").then(({ data }) => setColleges(data || [])).catch(() => setColleges([]));
  }, [open, lead]);

  const cities = useMemo(
    () => [...new Set(colleges.map((c) => (c.place || "").trim()).filter(Boolean))].sort(),
    [colleges]
  );
  const cityColleges = useMemo(
    () => (city ? colleges.filter((c) => (c.place || "").trim() === city) : colleges),
    [colleges, city]
  );
  const courses = useMemo(() => {
    const set = new Set();
    cityColleges.forEach((c) => (c.courses || []).forEach((k) => set.add(k)));
    if (lead?.course) set.add(lead.course);
    return [...set].sort();
  }, [cityColleges, lead]);
  const collegeOptions = useMemo(
    () => cityColleges.filter((c) => !course || !(c.courses || []).length || (c.courses || []).includes(course)),
    [cityColleges, course]
  );

  const refId = lead?.assigned_to_user_id;
  const linkPreview = refId ? buildApplyUrl(refId) : null;

  const submit = async () => {
    if (visitInterested && (!visit.departure_at || !visit.arrival_at)) {
      toast.error("Departure and arrival date & time are required for the visit");
      return;
    }
    setBusy(true);
    try {
      const body = {
        city,
        course,
        college,
        send_link: sendLink,
        campus_visit_interested: visitInterested,
        visit: visitInterested
          ? {
              institution: visit.institution || college,
              departure_at: fromLocalInput(visit.departure_at),
              arrival_at: fromLocalInput(visit.arrival_at),
              travel_mode: visit.travel_mode,
              who_comes: visit.who_comes,
              drop_point: visit.drop_point,
            }
          : null,
      };
      const { data } = await api.post(`/leads/${lead.id}/convert`, body);
      toast.success("Lead converted — student created & credited to the assignee");
      if (sendLink) {
        if (data.whatsapp?.ok) toast.success("Application link sent on WhatsApp");
        else toast.warning(`WhatsApp link not sent: ${data.whatsapp?.detail || "unknown error"}`);
      }
      if (visitInterested) {
        if (data.visit_whatsapp?.ok) toast.success("Campus-visit WhatsApp sent to the student");
        else toast.warning(`Visit saved, but WhatsApp failed: ${data.visit_whatsapp?.detail || "unknown error"}`);
      }
      onDone?.({
        status: "converted",
        converted_student_id: data.student_id,
        conversion_details: { city, course, college },
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Convert failed");
    } finally {
      setBusy(false);
    }
  };

  if (!lead) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-lg" data-testid="convert-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Convert · {lead.name}</DialogTitle>
          <DialogDescription>Pick the city, course &amp; college, then WhatsApp the application link to the student.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="space-y-1">
              <Label className="text-xs">City</Label>
              <Select value={city} onValueChange={(v) => { setCity(v); setCollege(""); }}>
                <SelectTrigger data-testid="convert-city-select" className="bg-card"><SelectValue placeholder="Select city" /></SelectTrigger>
                <SelectContent>
                  {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Course</Label>
              <Select value={course} onValueChange={(v) => { setCourse(v); setCollege(""); }}>
                <SelectTrigger data-testid="convert-course-select" className="bg-card"><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">College</Label>
              <Select value={college} onValueChange={setCollege}>
                <SelectTrigger data-testid="convert-college-select" className="bg-card"><SelectValue placeholder="Select college" /></SelectTrigger>
                <SelectContent>
                  {collegeOptions.map((c) => <SelectItem key={c.id || c.name} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none" data-testid="convert-send-link-tick">
            <Checkbox checked={sendLink} onCheckedChange={(v) => setSendLink(!!v)} />
            <span className="flex items-center gap-1.5"><WhatsappLogo size={16} className="text-emerald-600" /> Send application link on WhatsApp</span>
          </label>
          {sendLink && (
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-lg p-2 break-all" data-testid="convert-link-preview">
              {lead.phone
                ? `Link ${linkPreview ? `(${linkPreview})` : "(referral link)"} → ${lead.phone}`
                : "⚠ This lead has no phone number — the link can't be sent."}
            </p>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none" data-testid="convert-visit-tick">
            <Checkbox checked={visitInterested} onCheckedChange={(v) => setVisitInterested(!!v)} />
            <span>Campus visit interested?</span>
          </label>
          {visitInterested && (
            <div className="rounded-lg border border-border p-3 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Schedule the visit</p>
              <VisitFields value={visit} onChange={setVisit} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={busy} className="btn-amber border-0" data-testid="convert-submit-btn">
            {busy ? "Converting…" : "Convert lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

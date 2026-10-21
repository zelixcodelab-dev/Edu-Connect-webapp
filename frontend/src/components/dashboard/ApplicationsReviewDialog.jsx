import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle, XCircle, FilePdf, ArrowSquareOut, Phone, EnvelopeSimple, MapPin, CaretDown } from "@phosphor-icons/react";
import api from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { downloadApplicationPdf } from "@/lib/applicationPdf";

const fmt = (s) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const label = (k) => k.replace(/_/g, " ");

function Section({ title, data }) {
  const rows = Object.entries(data || {}).filter(([, v]) => v !== null && v !== "" && typeof v !== "object");
  if (!rows.length) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-1.5">{title}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}><dt className="text-muted-foreground capitalize">{label(k)}</dt><dd className="font-medium break-words">{String(v)}</dd></React.Fragment>
        ))}
      </dl>
    </div>
  );
}

function AppCard({ s, onDone }) {
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const a = s.application || {};
  const b = a.basic_info || {};
  const c = a.communication || {};

  const review = async (decision) => {
    setBusy(true);
    try {
      await api.post(`/dashboard/applications/${s.id}/review`, { decision, reason: decision === "rejected" ? reason : "" });
      toast.success(decision === "approved" ? `${s.name} marked as reviewed` : `${s.name} rejected`);
      onDone(s.id);
    } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); } finally { setBusy(false); }
  };
  const pdf = async () => {
    try { await downloadApplicationPdf({ student: s }); } catch (e) { toast.error(e?.message || "PDF failed"); }
  };

  return (
    <div className="rounded-2xl bg-card p-4 space-y-3" data-testid={`app-review-${s.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display font-semibold truncate" data-testid={`app-review-name-${s.id}`}>{s.name}</p>
          <p className="text-xs text-muted-foreground truncate">{s.course || "—"}{s.college ? ` · ${s.college}` : ""}</p>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">{fmt(s.application_submitted_at || s.created_at)}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {b.mobile_number && <span className="flex items-center gap-1"><Phone size={13} />{b.mobile_number}</span>}
        {b.email && <span className="flex items-center gap-1"><EnvelopeSimple size={13} />{b.email}</span>}
        {c.city && <span className="flex items-center gap-1"><MapPin size={13} />{c.city}</span>}
        {(s.referrer_name || s.reference) && <span>Referred by <span className="text-foreground font-medium">{s.referrer_name || s.reference}</span></span>}
      </div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium flex items-center gap-1 hover:underline" data-testid={`app-review-toggle-${s.id}`}>
        <CaretDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} /> {open ? "Hide" : "View"} full application
      </button>
      {open && (
        <div className="rounded-xl bg-background p-3 space-y-3 animate-fade-in" data-testid={`app-review-details-${s.id}`}>
          <Section title="Basic info" data={a.basic_info} />
          <Section title="Course" data={a.course} />
          <Section title="Communication" data={a.communication} />
          <Section title="Academic" data={a.academic} />
          <Section title="Reference" data={a.reference} />
        </div>
      )}
      {rejecting && (
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, saved to notes)" data-testid={`app-review-reason-${s.id}`} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!rejecting ? (
          <>
            <Button size="sm" onClick={() => review("approved")} disabled={busy} className="btn-amber border-0 rounded-xl" data-testid={`app-review-approve-${s.id}`}><CheckCircle size={15} className="mr-1" /> Approve</Button>
            <Button size="sm" variant="outline" onClick={() => setRejecting(true)} disabled={busy} className="rounded-xl" data-testid={`app-review-reject-${s.id}`}><XCircle size={15} className="mr-1" /> Reject</Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => review("rejected")} disabled={busy} className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white" data-testid={`app-review-confirm-reject-${s.id}`}>Confirm reject</Button>
            <Button size="sm" variant="ghost" onClick={() => { setRejecting(false); setReason(""); }} className="rounded-xl" data-testid={`app-review-cancel-reject-${s.id}`}>Cancel</Button>
          </>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={pdf} className="rounded-xl" data-testid={`app-review-pdf-${s.id}`}><FilePdf size={15} className="mr-1" /> PDF</Button>
        <Button size="sm" variant="ghost" asChild className="rounded-xl"><Link to={`/students/${s.id}`} data-testid={`app-review-open-${s.id}`}><ArrowSquareOut size={15} className="mr-1" /> Open</Link></Button>
      </div>
    </div>
  );
}

export default function ApplicationsReviewDialog({ open, onOpenChange, onChanged }) {
  const [items, setItems] = useState(null);
  const load = useCallback(async () => {
    try { const r = await api.get("/dashboard/pending-applications"); setItems(r.data.items); } catch { setItems([]); }
  }, []);
  useEffect(() => { if (open) { setItems(null); load(); } }, [open, load]);
  const done = (id) => { setItems((xs) => xs.filter((x) => x.id !== id)); onChanged?.(); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-3xl max-h-[88vh] flex flex-col" data-testid="applications-review-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">New applications</DialogTitle>
          <DialogDescription>Pending admission-form submissions, newest first. Approve marks one as reviewed; reject cancels it.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 -mr-1">
          {items === null ? [0, 1].map((i) => <div key={i} className="h-28 rounded-2xl bg-card animate-pulse" />)
            : items.length === 0 ? <p className="text-sm text-muted-foreground text-center py-10" data-testid="applications-review-empty">You're all caught up. No pending applications.</p>
              : items.map((s) => <AppCard key={s.id} s={s} onDone={done} />)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

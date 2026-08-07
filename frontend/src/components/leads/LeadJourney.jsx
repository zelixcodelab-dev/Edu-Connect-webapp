import React, { useMemo, useState } from "react";
import {
  Sparkle, ArrowRight, ChatCircleDots, Bus, GraduationCap, PhoneCall,
  WhatsappLogo, CheckCircle, XCircle, ArrowClockwise, PencilSimple,
} from "@phosphor-icons/react";
import { fmtDateTime, statusLabel, LEAD_STATUS_META } from "./constants";
import FollowUpEditDialog from "./FollowUpEditDialog";

/**
 * Merges the lead's status transitions, follow-ups, visit schedule and
 * conversion event into a single chronologically sorted journey timeline.
 *
 * Backend fields consumed:
 *   - lead.created_at
 *   - lead.status_history[]  ({id, at, from, to, by_name, note, metadata?})
 *   - lead.follow_ups[]      ({id, at, note, created_by_name, created_at})
 *   - lead.visit             ({created_at, institution, ...})
 */
function buildEvents(lead) {
  if (!lead) return [];
  const events = [];

  events.push({
    kind: "created",
    at: lead.created_at,
    who: lead.created_by_name || null,
  });

  (lead.status_history || []).forEach((h) => {
    events.push({
      kind: "status",
      at: h.at,
      from: h.from,
      to: h.to,
      who: h.by_name,
      note: h.note,
      metadata: h.metadata,
      id: h.id,
    });
  });

  (lead.follow_ups || []).forEach((f) => {
    events.push({
      kind: "followup",
      at: f.created_at || f.at,
      scheduledAt: f.at,
      note: f.note,
      who: f.created_by_name,
      id: f.id,
      createdByUserId: f.created_by_user_id,
      raw: f, // full row so the edit dialog can pre-fill without another fetch
    });
  });

  if (lead.visit && lead.visit.created_at) {
    events.push({
      kind: "visit",
      at: lead.visit.created_at,
      institution: lead.visit.institution,
      departureAt: lead.visit.departure_at,
      who: lead.visit.created_by_name,
    });
  }

  return events
    .filter((e) => e.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function EventDot({ kind }) {
  const map = {
    created: { icon: Sparkle, cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/30" },
    status: { icon: ArrowRight, cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30" },
    followup: { icon: PhoneCall, cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-blue-500/30" },
    visit: { icon: Bus, cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-violet-500/30" },
    conversion: { icon: GraduationCap, cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30" },
  };
  const { icon: Icon, cls } = map[kind] || map.status;
  return (
    <span className={`w-7 h-7 rounded-full flex items-center justify-center ring-2 shrink-0 ${cls}`}>
      <Icon size={14} weight="duotone" />
    </span>
  );
}

function StatusPill({ status }) {
  const meta = LEAD_STATUS_META[status];
  if (!status) return <span className="text-xs text-muted-foreground italic">—</span>;
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
        meta ? meta.cls : "bg-muted text-muted-foreground border-border"
      }`}
    >
      {meta ? meta.label : statusLabel(status)}
    </span>
  );
}

/** WhatsApp send-result chip surfaced on status_history metadata.whatsapp. */
function WhatsappChip({ wa, testid }) {
  if (!wa) return null;
  const ok = !!wa.ok;
  const short = wa.message_id ? String(wa.message_id).slice(0, 10) : "";
  const detail = ok
    ? (short ? `Sent · ${short}` : "Sent")
    : (wa.detail || "Failed");
  return (
    <span
      data-testid={testid}
      title={ok ? wa.message_id : (wa.detail || "")}
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
        ok
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
          : "bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/30"
      }`}
    >
      <WhatsappLogo size={11} weight="fill" />
      {ok ? <CheckCircle size={10} weight="fill" /> : <XCircle size={10} weight="fill" />}
      WA · {detail}
    </span>
  );
}

function EventRow({ ev, canResend, onResendLink, resending, canEditFollowup, onEditFollowup }) {
  const timestamp = fmtDateTime(ev.at);
  const who = ev.who ? ` · ${ev.who}` : "";
  const wa = ev.metadata?.whatsapp;
  // Only show Resend on a converted-related event when WA failed AND the caller
  // has permission. The Resend button targets the LATEST such row implicitly —
  // parent controls whether to render it via canResend.
  const showResendBtn =
    canResend &&
    ev.kind === "status" &&
    (ev.to === "converted" || (ev.from === "converted" && ev.to === "converted")) &&
    wa && !wa.ok;

  const contentByKind = {
    created: (
      <>
        <p className="text-sm text-foreground font-medium">Lead created</p>
        <p className="text-[11px] text-muted-foreground">{timestamp}{who}</p>
      </>
    ),
    status: (
      <>
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
          <StatusPill status={ev.from} />
          <ArrowRight size={12} className="text-muted-foreground" />
          <StatusPill status={ev.to} />
          {ev.note && <span className="text-xs text-muted-foreground italic">· {ev.note}</span>}
        </div>
        {wa && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <WhatsappChip wa={wa} testid={`journey-wa-${ev.id || "status"}`} />
            {showResendBtn && (
              <button
                type="button"
                disabled={resending}
                onClick={onResendLink}
                data-testid="journey-resend-link-btn"
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-orange-500/40 text-orange-700 dark:text-orange-300 hover:bg-orange-500/10 disabled:opacity-50"
              >
                <ArrowClockwise size={11} weight="bold" /> {resending ? "Sending…" : "Resend link"}
              </button>
            )}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">{timestamp}{who}</p>
      </>
    ),
    followup: (
      <>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-foreground">
            Follow-up scheduled for <span className="font-medium">{fmtDateTime(ev.scheduledAt)}</span>
          </p>
          {canEditFollowup && (
            <button
              type="button"
              onClick={onEditFollowup}
              className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10 transition-colors flex items-center gap-1"
              data-testid={`followup-edit-${ev.id}`}
              aria-label="Edit follow-up"
            >
              <PencilSimple size={11} /> Edit
            </button>
          )}
        </div>
        {ev.note && <p className="text-sm text-muted-foreground mt-0.5">{ev.note}</p>}
        <p className="text-[11px] text-muted-foreground">{timestamp}{who}</p>
      </>
    ),
    visit: (
      <>
        <p className="text-sm text-foreground">
          Campus visit scheduled{ev.institution ? ` at ${ev.institution}` : ""}
        </p>
        {ev.departureAt && (
          <p className="text-[11px] text-muted-foreground">Departure: {fmtDateTime(ev.departureAt)}</p>
        )}
        <p className="text-[11px] text-muted-foreground">{timestamp}{who}</p>
      </>
    ),
  };

  return (
    <div
      className="flex items-start gap-3"
      data-testid={`journey-event-${ev.kind}${ev.id ? `-${ev.id}` : ""}`}
    >
      <EventDot kind={ev.kind} />
      <div className="flex-1 min-w-0 pt-0.5">
        {contentByKind[ev.kind] || (
          <>
            <p className="text-sm text-foreground">{ev.kind}</p>
            <p className="text-[11px] text-muted-foreground">{timestamp}{who}</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Journey timeline shown inside the Lead Detail dialog. Renders each event
 * with an icon dot on a vertical connector, oldest → newest.
 *
 * Props:
 *   - lead: the lead doc
 *   - canResend (bool): whether the Resend button should surface on failed WA
 *   - onResendLink (fn): callback invoked when the Resend button is clicked
 *   - resending (bool): reflects in-flight request state
 *   - viewerUserId (str): current user's id — needed to decide who can edit a follow-up
 *   - viewerIsAdmin (bool): super_admin/office_admin can edit any follow-up
 *   - editable (bool): master switch — if false, no edit chips render
 *   - onLeadChanged (fn): called with the fresh lead after any follow-up edit/delete
 */
export default function LeadJourney({
  lead,
  canResend = false,
  onResendLink,
  resending = false,
  viewerUserId,
  viewerIsAdmin = false,
  editable = false,
  onLeadChanged,
}) {
  const events = useMemo(() => buildEvents(lead), [lead]);
  const [editing, setEditing] = useState(null); // full followup row when open
  if (!lead || events.length === 0) return null;

  // The Resend chip should only render on the MOST RECENT converted event with
  // a failed WA — attempts before that are historical.
  let latestConvertedFail = null;
  for (const e of events) {
    if (e.kind === "status" && (e.to === "converted" || e.from === "converted") && e.metadata?.whatsapp && !e.metadata.whatsapp.ok) {
      latestConvertedFail = e.id;
    }
  }

  const canEditFollowup = (ev) => {
    if (!editable || ev.kind !== "followup") return false;
    if (viewerIsAdmin) return true;
    return !!viewerUserId && ev.createdByUserId === viewerUserId;
  };

  return (
    <div className="rounded-lg border border-border p-3.5" data-testid="lead-journey">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ChatCircleDots size={14} /> Journey
        </p>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="relative space-y-3.5 pl-1">
        {events.length > 1 && (
          <div className="absolute left-[14px] top-2 bottom-2 w-px bg-border" aria-hidden="true" />
        )}
        {events.map((ev, i) => (
          <EventRow
            key={ev.id || `${ev.kind}-${i}`}
            ev={ev}
            canResend={canResend && ev.id === latestConvertedFail}
            onResendLink={onResendLink}
            resending={resending}
            canEditFollowup={canEditFollowup(ev)}
            onEditFollowup={() => setEditing(ev.raw)}
          />
        ))}
      </div>
      <FollowUpEditDialog
        open={!!editing}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        leadId={lead.id}
        followup={editing}
        onSaved={(fresh) => { onLeadChanged?.(fresh); setEditing(null); }}
      />
    </div>
  );
}

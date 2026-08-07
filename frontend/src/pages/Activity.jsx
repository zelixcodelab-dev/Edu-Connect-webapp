import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  ClockCounterClockwise, ArrowClockwise, MagnifyingGlass, User, Target,
  Megaphone, ChatCircleDots, Trash, UploadSimple, PencilSimple, CheckCircle,
} from "@phosphor-icons/react";

/** Icon + palette for each supported event type. */
const EVENT_META = {
  "lead.deleted":            { icon: Trash,           tone: "rose",    label: "Lead deleted" },
  "lead.bulk_delete":        { icon: Trash,           tone: "rose",    label: "Bulk lead delete" },
  "lead.bulk_upload":        { icon: UploadSimple,    tone: "amber",   label: "Leads uploaded" },
  "lead.bulk_assign":        { icon: User,            tone: "sky",     label: "Bulk assign" },
  "lead.bulk_campaign":      { icon: Megaphone,       tone: "violet",  label: "Bulk campaign tag" },
  "lead.followup.deleted":   { icon: Trash,           tone: "rose",    label: "Follow-up deleted" },
  "lead.followup.edited":    { icon: PencilSimple,    tone: "amber",   label: "Follow-up edited" },
  "campaign.deleted":        { icon: Trash,           tone: "rose",    label: "Campaign deleted" },
  "campaign.bulk_delete":    { icon: Trash,           tone: "rose",    label: "Bulk campaign delete" },
  "user.deleted":            { icon: User,            tone: "rose",    label: "User deactivated" },
  "user.reactivated":        { icon: User,            tone: "emerald", label: "User reactivated" },
};

const TONES = {
  rose:    "bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300",
  amber:   "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
  sky:     "bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300",
  violet:  "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300",
  emerald: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const FILTERS = [
  ["all",       "All"],
  ["lead",      "Leads"],
  ["campaign",  "Campaigns"],
  ["followup",  "Follow-ups"],
  ["user",      "Users"],
];

function fmtRelative(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Activity() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [reversibleOnly, setReversibleOnly] = useState(false);
  const [restoring, setRestoring] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (filter === "followup") {
        // Follow-up events keep subject_type='lead' but the event type is
        // scoped — filter client-side after fetch (simpler than 2 API calls).
      } else if (filter !== "all") {
        params.set("subject_type", filter);
      }
      if (q.trim()) params.set("q", q.trim());
      if (reversibleOnly) params.set("reversible", "true");
      const { data } = await api.get(`/activity-log?${params.toString()}`);
      const raw = data.items || [];
      // Client-side follow-up-only filter (see comment above).
      const visible = filter === "followup"
        ? raw.filter((r) => (r.type || "").startsWith("lead.followup."))
        : raw;
      setItems(visible);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not load activity");
    } finally {
      setLoading(false);
    }
  }, [filter, q, reversibleOnly]);

  useEffect(() => { load(); }, [load]);

  const restore = async (ev) => {
    if (!window.confirm(`Restore this event? "${ev.note || ev.type}"`)) return;
    setRestoring(ev.id);
    try {
      const { data } = await api.post(`/activity-log/${ev.id}/restore`);
      toast.success("Restored");
      // Reflect state locally without another fetch.
      setItems((prev) => prev.map((r) => r.id === ev.id
        ? { ...r, restored: true, restored_at: new Date().toISOString() }
        : r));
      // Best-effort deep-link so the operator sees the restored row.
      const result = data.result || {};
      if (result.lead_id) nav(`/leads?lead=${result.lead_id}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Restore failed");
    } finally { setRestoring(null); }
  };

  const grouped = useMemo(() => {
    const buckets = new Map(); // dateKey → items[]
    items.forEach((r) => {
      const key = (r.at || "").slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    });
    return Array.from(buckets.entries());
  }, [items]);

  return (
    <div className="space-y-5" data-testid="activity-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <ClockCounterClockwise size={26} weight="duotone" className="text-amber-500" />
            Activity
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recent CRM actions from the last 30 days. Reversible entries can be restored in one click.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search actor, subject, note…"
              className="w-56 pl-8 bg-card"
              data-testid="activity-search"
            />
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="activity-refresh">
            <ArrowClockwise size={13} className="mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([v, l]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            data-testid={`activity-filter-${v}`}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === v
                ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >{l}</button>
        ))}
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer">
          <input
            type="checkbox"
            checked={reversibleOnly}
            onChange={(e) => setReversibleOnly(e.target.checked)}
            data-testid="activity-only-reversible"
            className="rounded border-border"
          />
          Show restorable only
        </label>
      </div>

      {loading ? (
        <Card className="py-16 text-center text-sm text-muted-foreground" data-testid="activity-loading">Loading activity…</Card>
      ) : items.length === 0 ? (
        <Card className="py-16 text-center" data-testid="activity-empty">
          <ClockCounterClockwise size={40} className="mx-auto text-muted-foreground mb-3" weight="duotone" />
          <p className="text-foreground font-medium">No activity yet</p>
          <p className="text-sm text-muted-foreground mt-1">Actions will appear here as team members work in the CRM.</p>
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map(([day, rows]) => (
            <section key={day || "unknown"} className="space-y-2">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground px-1">
                {day ? new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "Unknown date"}
              </p>
              <Card className="divide-y divide-border overflow-hidden">
                {rows.map((ev) => {
                  const meta = EVENT_META[ev.type] || { icon: ChatCircleDots, tone: "sky", label: ev.type };
                  const Icon = meta.icon;
                  const restored = !!ev.restored;
                  // Bulk events that end up affecting just one row read
                  // more naturally as the singular equivalent — the label
                  // itself will already be the specific name (see backend).
                  const isBulkOfOne = (t) => (
                    (t === "campaign.bulk_delete" || t === "lead.bulk_delete") &&
                    !/^\d+\s+(campaigns?|leads?)$/i.test(ev.subject_label || "")
                  );
                  const displayLabel = isBulkOfOne(ev.type)
                    ? (ev.type === "campaign.bulk_delete" ? "Campaign deleted" : "Lead deleted")
                    : meta.label;
                  return (
                    <div
                      key={ev.id}
                      className="flex items-start gap-3 p-3 sm:p-4"
                      data-testid={`activity-row-${ev.id}`}
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${TONES[meta.tone]}`}>
                        <Icon size={17} weight="duotone" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">
                          <span className="font-medium">{ev.actor_name || "System"}</span>
                          <span className="text-muted-foreground"> · {displayLabel}</span>
                          {ev.subject_label && (
                            <>
                              {" — "}
                              <span className="text-foreground">{ev.subject_label}</span>
                            </>
                          )}
                        </p>
                        {ev.note && <p className="text-xs text-muted-foreground mt-0.5">{ev.note}</p>}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {fmtRelative(ev.at)}
                          {ev.actor_office ? ` · ${ev.actor_office.replace("KM_", "KM ")}` : ""}
                          {restored && (
                            <>
                              {" · "}
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium inline-flex items-center gap-0.5">
                                <CheckCircle size={10} weight="fill" /> Restored{ev.restored_by_name ? ` by ${ev.restored_by_name}` : ""}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      {ev.reversible && !restored && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => restore(ev)}
                          disabled={restoring === ev.id}
                          data-testid={`activity-restore-${ev.id}`}
                        >
                          <ArrowClockwise size={13} className="mr-1" />
                          {restoring === ev.id ? "Restoring…" : "Restore"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

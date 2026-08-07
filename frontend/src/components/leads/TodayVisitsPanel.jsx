import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Bus, Calendar, ArrowsClockwise, ChatCircleText, MapPin, ArrowRight, User, Clock } from "@phosphor-icons/react";
import { VISIT_STATUS_META, fmtDateTime } from "./constants";

/**
 * Live "Today's Campus Visits" board — surfaces every scoped lead whose
 * campus visit is departing or arriving today, alongside its current stage
 * chip. Clicking a card deep-links to the lead detail dialog via
 * `?lead=<id>` so admins & staff can act immediately.
 *
 * Backed by `GET /api/leads/visits/today` (scope handled server-side).
 */
export default function TodayVisitsPanel({ user, officeOverride = "all" }) {
  const nav = useNavigate();
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");

  const fetchVisits = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (officeOverride && officeOverride !== "all") params.office = officeOverride;
      const { data } = await api.get("/leads/visits/today", { params });
      setVisits(data.visits || []);
      setDate(data.date || "");
    } catch (_) {
      setVisits([]);
    } finally {
      setLoading(false);
    }
  }, [officeOverride]);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);
  // Auto-refresh every 60s so the "Live" label stays honest — but pause
  // while the tab is hidden to avoid needless background traffic.
  useEffect(() => {
    let t = null;
    const start = () => {
      if (!t) t = setInterval(fetchVisits, 60_000);
    };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchVisits]);

  const openLead = (id) => nav(`/leads?lead=${encodeURIComponent(id)}`);

  return (
    <Card className="border border-border bg-card rounded-xl shadow-none" data-testid="today-visits-panel">
      <div className="p-5 flex items-center justify-between gap-3 border-b border-border/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-violet-100/60 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
            <Bus size={18} weight="duotone" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="label-eyebrow">Live now</p>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            </div>
            <h3 className="font-display text-lg leading-none mt-1 truncate" data-testid="today-visits-title">
              Today&apos;s Campus Visits
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1" data-testid="today-visits-date">
            <Calendar size={13} /> {date || "—"}
          </span>
          <button
            type="button"
            onClick={fetchVisits}
            disabled={loading}
            data-testid="today-visits-refresh"
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Refresh"
          >
            <ArrowsClockwise size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <div className="p-4">
        {loading && visits.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="today-visits-loading">
            Loading today&apos;s schedule…
          </p>
        ) : visits.length === 0 ? (
          <div className="text-center py-8" data-testid="today-visits-empty">
            <Bus size={28} weight="duotone" className="mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-sm text-foreground font-medium">No visits scheduled for today</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Schedule campus visits from the CRM to see them appear here in real time.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="today-visits-grid">
            {visits.map((v) => {
              const meta = VISIT_STATUS_META[v.visit?.status] || VISIT_STATUS_META.scheduled;
              const isPreview = v.phase === "preview";
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => openLead(v.id)}
                  data-testid={`today-visit-${v.id}`}
                  data-phase={v.phase || "live"}
                  className={`text-left rounded-xl border p-3.5 hover:shadow-md transition-all group ${
                    isPreview
                      ? "border-amber-500/40 bg-amber-500/[0.03] hover:border-amber-500/60"
                      : "border-border bg-card hover:border-orange-500/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{v.name}</p>
                      {v.course && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{v.course}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {isPreview && (
                        <span
                          data-testid={`today-visit-tomorrow-${v.id}`}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40 flex items-center gap-1"
                        >
                          <Clock size={10} weight="fill" /> Tomorrow Visit
                        </span>
                      )}
                      <span
                        data-testid={`today-visit-stage-${v.id}`}
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2.5 space-y-1 text-xs text-muted-foreground">
                    {v.visit?.institution && (
                      <p className="flex items-center gap-1.5"><MapPin size={12} /> {v.visit.institution}</p>
                    )}
                    {(v.visit?.departure_at || v.visit?.arrival_at) && (
                      <p className="flex items-center gap-1.5">
                        <ArrowRight size={12} className="text-emerald-500" />
                        {v.visit?.departure_at ? `Dep ${fmtDateTime(v.visit.departure_at)}` : "—"}
                        {v.visit?.arrival_at ? ` · Arr ${fmtDateTime(v.visit.arrival_at)}` : ""}
                      </p>
                    )}
                    {v.visit?.attending_admin_name && (
                      <p className="flex items-center gap-1.5"><User size={12} /> {v.visit.attending_admin_name}</p>
                    )}
                    {v.phone && (
                      <p className="flex items-center gap-1.5"><ChatCircleText size={12} /> {v.phone}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

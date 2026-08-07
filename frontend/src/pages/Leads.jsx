import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import api from "@/lib/api";
import CrmAnalytics from "@/components/office-dashboard/CrmAnalytics";
import CampaignsPanel from "@/components/leads/CampaignsPanel";
import LeadsPipeline from "@/components/leads/LeadsPipeline";
import TodayVisitsPanel from "@/components/leads/TodayVisitsPanel";
import LeadDetailDialog from "@/components/leads/LeadDetailDialog";
import StaffPerformancePanel from "@/components/leads/StaffPerformancePanel";

export default function Leads() {
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const isSuper = user?.role === "super_admin";
  const [params, setParams] = useSearchParams();
  const [crmTab, setCrmTab] = useState("overview"); // overview | campaigns (admins)

  // Super Admin only: narrow every CRM widget to a single office. Persisted
  // in localStorage so a page reload keeps the picked office. "all" (default)
  // shows the un-scoped view (super_admin sees all offices).
  const [officeOverride, setOfficeOverride] = useState(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem("crm.office_override") || "all";
  });
  const updateOffice = useCallback((v) => {
    setOfficeOverride(v);
    try {
      localStorage.setItem("crm.office_override", v);
    } catch { /* localStorage may be blocked in private-window/tests — no-op */ }
  }, []);
  // Everyone below super_admin should never send an override — the backend
  // ignores it anyway, but this keeps API traffic clean.
  const activeOffice = isSuper ? officeOverride : "all";

  // ---- Deep-link `?lead=<id>` (notifications, Today's Visits cards) --------
  // Fetches the lead and pops the detail dialog IN-PLACE on whichever tab the
  // caller is currently viewing — no auto-switch. When the dialog closes we
  // strip the param so the URL stays clean.
  const [deepLead, setDeepLead] = useState(null);
  const [pipelineRefreshKey, setPipelineRefreshKey] = useState(0);
  const leadParam = params.get("lead");

  useEffect(() => {
    if (!leadParam) return;
    let cancelled = false;
    // Try search-by-query first (fast), then fall back to full list scan.
    api.get(`/leads`, { params: { q: leadParam } })
      .then(({ data }) => {
        if (cancelled) return;
        const hit = (data || []).find((l) => l.id === leadParam);
        if (hit) setDeepLead(hit);
        else {
          api.get(`/leads`).then(({ data: all }) => {
            if (cancelled) return;
            const h = (all || []).find((l) => l.id === leadParam);
            if (h) setDeepLead(h);
          }).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [leadParam]);

  const closeDeepLink = useCallback(() => {
    setDeepLead(null);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("lead");
      return next;
    }, { replace: true });
  }, [setParams]);

  const bumpPipeline = useCallback(() => setPipelineRefreshKey((k) => k + 1), []);

  return (
    <div className="space-y-6" data-testid="leads-page">
      {/* Header — with Super Admin office switcher */}
      <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
        <div>
          <p className="label-eyebrow">CRM</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">{isStaff ? "My Leads" : "CRM"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isStaff ? "Your assigned prospects and follow-ups." : "Lead performance at a glance, then dive into a campaign to work its pipeline."}
          </p>
        </div>
        {isSuper && (
          <div
            className="flex items-center gap-1 rounded-lg bg-muted p-0.5 self-start sm:self-auto shrink-0"
            data-testid="crm-office-switcher"
          >
            {[["all", "All offices"], ["KM_BLR", "KM BLR"], ["KM_TCR", "KM TCR"], ["KM_KMLY", "KM KMLY"]].map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => updateOffice(v)}
                data-testid={`crm-office-${v}`}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  officeOverride === v
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isStaff ? (
        <>
          <TodayVisitsPanel user={user} />
          <LeadsPipeline user={user} refreshKey={pipelineRefreshKey} />
        </>
      ) : (
        <>
          {/* CRM tabs */}
          <div className="flex items-center gap-1 border-b border-border" data-testid="crm-tabs">
            {[["overview", "Overview"], ["campaigns", "Campaigns"], ["all", "All leads"]].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setCrmTab(k)}
                data-testid={`crm-tab-${k}`}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  crmTab === k ? "border-orange-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {crmTab === "overview" ? (
            <div className="space-y-5" data-testid="crm-overview">
              <StaffPerformancePanel officeOverride={activeOffice} />
              <TodayVisitsPanel user={user} officeOverride={activeOffice} />
              <CrmAnalytics office={activeOffice === "all" ? null : activeOffice} />
            </div>
          ) : crmTab === "campaigns" ? (
            <CampaignsPanel user={user} />
          ) : (
            <div data-testid="crm-all-leads">
              <LeadsPipeline user={user} allLeadsMode refreshKey={pipelineRefreshKey} officeOverride={activeOffice} />
            </div>
          )}
        </>
      )}

      {/* Shared detail dialog for deep-linked leads (notifications + Today's Visits).
          Opens ON TOP of the current tab — no auto-switch. */}
      <LeadDetailDialog
        open={!!deepLead}
        onOpenChange={(v) => { if (!v) closeDeepLink(); }}
        lead={deepLead}
        user={user}
        onChanged={() => { bumpPipeline(); }}
      />
    </div>
  );
}

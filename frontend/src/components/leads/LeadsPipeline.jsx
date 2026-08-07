import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { canEdit } from "@/lib/perm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, UploadSimple, MagnifyingGlass, Target, ClockCountdown, CheckCircle, Phone, GraduationCap,
  ListBullets, Kanban, ArrowRight,
} from "@phosphor-icons/react";
import { LEAD_STATUSES, LEAD_STATUS_META, sourceLabel, fmtDateTime } from "./constants";
import LeadFormDialog from "./LeadFormDialog";
import LeadDetailDialog from "./LeadDetailDialog";
import LeadsBulkUploadDialog from "./LeadsBulkUploadDialog";
import LeadsBoard from "./LeadsBoard";
import LeadsBulkActionBar from "./LeadsBulkActionBar";
import UserAvatar from "@/components/UserAvatar";

function StatTile({ icon: Icon, label, value, tone, testid, onClick, ariaLabel }) {
  const tones = {
    amber: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
    sky: "bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300",
    rose: "bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300",
    emerald: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  };
  const inner = (
    <>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tones[tone]}`}><Icon size={20} weight="duotone" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-2xl font-display font-semibold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
      {onClick && (
        <span aria-hidden="true"
          className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-all text-muted-foreground shrink-0"
        >
          <ArrowRight size={14} weight="bold" />
        </span>
      )}
    </>
  );
  if (!onClick) {
    return (
      <Card className="p-4 flex items-center gap-3" data-testid={testid}>{inner}</Card>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-label={ariaLabel || label}
      className="group text-left w-full rounded-xl border border-border bg-card p-4 flex items-center gap-3 cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:ring-2 hover:ring-orange-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      {inner}
    </button>
  );
}

// Reusable lead pipeline (stats + filters + board/list + dialogs).
// `campaignId` scopes everything to one campaign; `showActions` toggles the
// Add lead / Upload CSV toolbar; `onChanged` fires after any mutation.
export default function LeadsPipeline({ user, campaignId = null, showActions = true, onChanged, allLeadsMode = false, refreshKey = 0, officeOverride = "all" }) {
  const [params, setParams] = useSearchParams();
  const isStaff = user?.role === "staff";
  const editable = canEdit(user, "leads");

  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState({ total: 0, by_status: {}, missed: 0 });
  const [assignable, setAssignable] = useState([]);
  const [loading, setLoading] = useState(true);

  const initialFilter = params.get("filter") || "all";
  const [statusFilter, setStatusFilter] = useState(initialFilter);
  const [sourceFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState("list");

  // Whenever the URL ``?filter=<status>`` changes (e.g. staff clicks a dashboard
  // card that navigates here), sync the pipeline's status filter. Strip the
  // param after applying so filter chips remain the source of truth.
  useEffect(() => {
    const p = params.get("filter");
    if (!p) return;
    setStatusFilter(p);
    setView("list");
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("filter");
      return next;
    }, { replace: true });
  }, [params, setParams]);

  const [formOpen, setFormOpen] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [detailLead, setDetailLead] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  // Multi-select state for bulk actions. Cleared when leads reload or filters change.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const qp = {};
      if (campaignId) qp.campaign_id = campaignId;
      if (allLeadsMode && uncategorizedOnly) qp.uncategorized = true;
      if (view !== "board") {
        if (statusFilter === "missed") qp.view = "missed";
        else if (statusFilter !== "all") qp.status = statusFilter;
      }
      if (sourceFilter !== "all") qp.source = sourceFilter;
      if (assigneeFilter !== "all") qp.assigned_to = assigneeFilter;
      if (q.trim()) qp.q = q.trim();
      if (officeOverride && officeOverride !== "all") qp.office = officeOverride;
      const { data } = await api.get("/leads", { params: qp });
      setLeads(data);
    } catch (err) {
      toast.error("Could not load leads");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, assigneeFilter, q, view, campaignId, allLeadsMode, uncategorizedOnly, officeOverride]);

  const fetchStats = useCallback(async () => {
    try {
      const params = {};
      if (campaignId) params.campaign_id = campaignId;
      if (allLeadsMode && uncategorizedOnly) params.uncategorized = true;
      if (officeOverride && officeOverride !== "all") params.office = officeOverride;
      const { data } = await api.get("/leads/stats", { params });
      setStats(data);
    } catch (err) {
      /* non-blocking */
    }
  }, [campaignId, allLeadsMode, uncategorizedOnly, officeOverride]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Reset the selection whenever the underlying lead list refreshes so
  // stale ids don't linger (deleted leads etc.).
  useEffect(() => { setSelectedIds(new Set()); }, [statusFilter, sourceFilter, assigneeFilter, q, view, campaignId, uncategorizedOnly]);

  // Parent (Leads.jsx) bumps refreshKey after the shared deep-link dialog
  // mutates a lead — refetch so the pipeline reflects the change even when
  // it was edited from a different tab (Overview).
  useEffect(() => {
    if (refreshKey === 0) return;
    fetchLeads();
    fetchStats();
  }, [refreshKey, fetchLeads, fetchStats]);

  useEffect(() => {
    if (isStaff) return;
    api.get("/users/assignable").then(({ data }) => setAssignable(data)).catch(() => {});
  }, [isStaff]);

  useEffect(() => {
    if (isStaff) return;
    api.get("/campaigns").then(({ data }) => setCampaigns(data)).catch(() => {});
  }, [isStaff, allLeadsMode]);

  useEffect(() => {
    if (showActions && !campaignId && params.get("new") === "1" && editable) {
      setEditLead(null);
      setFormOpen(true);
      params.delete("new");
      setParams(params, { replace: true });
    }
  }, [params, editable, setParams, showActions, campaignId]);

  const afterChange = () => { fetchLeads(); fetchStats(); onChanged?.(); };

  const visibleIds = useMemo(() => leads.map((l) => l.id), [leads]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () => {
    if (allSelected) clearSelection();
    else setSelectedIds(new Set(visibleIds));
  };

  const handleBoardStatus = async (lead, status) => {
    // Interested & Converted require their capture forms — open the detail
    // dialog which auto-launches the right one.
    if (status === "interested" || (status === "converted" && !lead.converted_student_id)) {
      setDetailLead({ ...lead, __autoAction: status });
      return;
    }
    try {
      await api.patch(`/leads/${lead.id}`, { status });
      toast.success(`Moved to ${LEAD_STATUS_META[status].label}`);
      afterChange();
    } catch (err) {
      toast.error("Could not move lead");
    }
  };

  const filterChips = useMemo(() => ([
    { key: "all", label: "All", count: stats.total },
    ...LEAD_STATUSES.map((s) => ({ key: s, label: LEAD_STATUS_META[s].label, count: stats.by_status?.[s] || 0 })),
    { key: "missed", label: "Missed", count: stats.missed, danger: true },
  ]), [stats]);

  const campaignMap = useMemo(
    () => Object.fromEntries((campaigns || []).map((c) => [c.id, c.name])),
    [campaigns]
  );

  return (
    <div className="space-y-5" data-testid="leads-pipeline">
      {showActions && editable && (
        <div className="flex items-center justify-end gap-2">
          {!isStaff && (
            <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="leads-upload-btn">
              <UploadSimple size={16} className="mr-1.5" /> Upload CSV
            </Button>
          )}
          <Button onClick={() => { setEditLead(null); setFormOpen(true); }} data-testid="add-lead-btn" className="btn-amber border-0">
            <Plus size={16} className="mr-1.5" /> Add lead
          </Button>
        </div>
      )}

      {!campaignId && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="leads-stats">
          <StatTile icon={Target} label="Total leads" value={stats.total} tone="amber"
            testid="stat-total-leads" onClick={() => { setStatusFilter("all"); setView("list"); }} />
          <StatTile icon={ClockCountdown} label="Follow-up" value={stats.by_status?.follow_up || 0} tone="sky"
            testid="stat-followup-leads" onClick={() => { setStatusFilter("follow_up"); setView("list"); }} />
          <StatTile icon={ClockCountdown} label="Missed" value={stats.missed} tone="rose"
            testid="stat-missed-leads" onClick={() => { setStatusFilter("missed"); setView("list"); }} />
          <StatTile icon={CheckCircle} label="Converted" value={stats.by_status?.converted || 0} tone="emerald"
            testid="stat-converted-leads" onClick={() => { setStatusFilter("converted"); setView("list"); }} />
        </div>
      )}

      <div className="space-y-3">
        {view === "list" && (
          <div className="flex flex-wrap gap-1.5" data-testid="leads-status-chips">
            {filterChips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setStatusFilter(c.key)}
                data-testid={`leads-filter-${c.key}`}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  statusFilter === c.key
                    ? (c.danger ? "bg-rose-500/15 text-rose-600 border-rose-500/40" : "bg-amber-gradient text-white border-transparent")
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {c.label} <span className="opacity-70">· {c.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, course…" data-testid="leads-search" className="pl-9 h-10" />
          </div>
          {!isStaff && (
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="w-44 h-10 bg-card" data-testid="leads-assignee-filter"><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                {assignable.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {allLeadsMode && (
            <button type="button" onClick={() => setUncategorizedOnly((v) => !v)} data-testid="leads-uncategorized-toggle"
              className={`h-10 px-3 rounded-lg border text-sm transition-colors ${uncategorizedOnly ? "bg-amber-gradient text-white border-transparent" : "border-border text-muted-foreground hover:bg-muted"}`}>
              Uncategorised only
            </button>
          )}
          <div className="flex items-center rounded-lg border border-border overflow-hidden ml-auto" data-testid="leads-view-toggle">
            <button type="button" onClick={() => setView("list")} data-testid="leads-view-list"
              className={`h-10 px-3 flex items-center gap-1.5 text-sm transition-colors ${view === "list" ? "bg-amber-gradient text-white" : "text-muted-foreground hover:bg-muted"}`}>
              <ListBullets size={16} /> List
            </button>
            <button type="button" onClick={() => setView("board")} data-testid="leads-view-board"
              className={`h-10 px-3 flex items-center gap-1.5 text-sm transition-colors ${view === "board" ? "bg-amber-gradient text-white" : "text-muted-foreground hover:bg-muted"}`}>
              <Kanban size={16} /> Board
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm" data-testid="leads-loading">Loading leads…</div>
      ) : view === "board" ? (
        <LeadsBoard leads={leads} editable={editable} onCardClick={setDetailLead} onStatusChange={handleBoardStatus} />
      ) : leads.length === 0 ? (
        <Card className="py-16 text-center" data-testid="leads-empty">
          <Target size={40} className="mx-auto text-muted-foreground mb-3" weight="duotone" />
          <p className="text-foreground font-medium">No leads here yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            {campaignId ? "Add or upload leads to this campaign above." : (editable ? "Add a lead or upload a CSV to get started." : "Leads assigned to you will show up here.")}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {editable && (
            <>
              <LeadsBulkActionBar
                count={selectedIds.size}
                selectedIds={Array.from(selectedIds)}
                isStaff={isStaff}
                assignable={assignable}
                campaigns={campaigns}
                onClear={clearSelection}
                onDone={afterChange}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer" data-testid="leads-select-all-row">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  data-testid="leads-select-all"
                  aria-label="Select all leads on this page"
                />
                {allSelected ? `All ${visibleIds.length} on this page selected` : `Select all ${visibleIds.length} on this page`}
              </label>
            </>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="leads-grid">
            {leads.map((l) => {
              const meta = LEAD_STATUS_META[l.status] || LEAD_STATUS_META.new;
              const isChecked = selectedIds.has(l.id);
              return (
                <div
                  key={l.id}
                  data-testid={`lead-card-${l.id}`}
                  className={`relative rounded-xl border bg-card p-4 hover:border-orange-500/40 hover:shadow-md transition-all ${
                    isChecked ? "border-amber-500/60 ring-1 ring-amber-500/40" : "border-border"
                  }`}
                >
                  {editable && (
                    <div
                      className="absolute top-3 left-3 z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleSelected(l.id)}
                        data-testid={`lead-checkbox-${l.id}`}
                        aria-label={`Select lead ${l.name}`}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setDetailLead(l)}
                    className={`w-full text-left ${editable ? "pl-6" : ""}`}
                    data-testid={`lead-card-open-${l.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground truncate">{l.name}</p>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {l.course && <p className="flex items-center gap-1.5"><GraduationCap size={13} /> {l.course}{l.place ? ` · ${l.place}` : ""}</p>}
                      {l.phone && <p className="flex items-center gap-1.5"><Phone size={13} /> {l.phone}</p>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{sourceLabel(l.source)}</span>
                      {l.assigned_to_name && (
                        <span className="pl-0.5 pr-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1.5">
                          <UserAvatar name={l.assigned_to_name} photoUrl={l.assigned_to_photo_url} size="xs" />
                          {l.assigned_to_name}
                        </span>
                      )}
                      {allLeadsMode && (
                        <span className={`px-2 py-0.5 rounded-full ${l.campaign_id ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" : "bg-muted text-muted-foreground"}`} data-testid={`lead-campaign-badge-${l.id}`}>
                          {l.campaign_id ? (campaignMap[l.campaign_id] || "Campaign") : "Uncategorised"}
                        </span>
                      )}
                      {l.next_follow_up && (
                        <span className={`px-2 py-0.5 rounded-full flex items-center gap-1 ${l.is_missed ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-blue-500/10 text-blue-700 dark:text-blue-300"}`} data-testid={l.is_missed ? `lead-missed-${l.id}` : undefined}>
                          <ClockCountdown size={11} /> {fmtDateTime(l.next_follow_up)}{l.is_missed ? " · Missed" : ""}
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <LeadFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        lead={editLead}
        assignable={assignable}
        user={user}
        onSaved={afterChange}
      />
      <LeadDetailDialog
        open={!!detailLead}
        onOpenChange={(v) => { if (!v) setDetailLead(null); }}
        lead={detailLead}
        user={user}
        onChanged={afterChange}
        onEdit={(l) => { setEditLead(l); setFormOpen(true); }}
        campaigns={allLeadsMode ? campaigns : undefined}
      />
      <LeadsBulkUploadDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onUploaded={afterChange}
        assignable={assignable}
        user={user}
      />
    </div>
  );
}

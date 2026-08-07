import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Plus, Megaphone, ArrowLeft, UploadSimple, ShareNetwork, Trash, Target, UserCheck, UsersThree, CheckCircle, X, PencilSimple,
} from "@phosphor-icons/react";
import CampaignFormDialog from "./CampaignFormDialog";
import CampaignAddLeadsDialog from "./CampaignAddLeadsDialog";
import CampaignDistributeDialog from "./CampaignDistributeDialog";
import CampaignDeleteDialog from "./CampaignDeleteDialog";
import LeadsBulkUploadDialog from "./LeadsBulkUploadDialog";
import LeadsPipeline from "./LeadsPipeline";

const OFFICE_LABEL = { KM_BLR: "KM BLR", KM_TCR: "KM TCR", KM_KMLY: "KM KMLY" };

function MiniStat({ icon: Icon, label, value, tone, testid }) {
  const tones = {
    amber: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
    sky: "bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300",
    slate: "bg-slate-100 dark:bg-slate-500/15 text-slate-700 dark:text-slate-300",
    emerald: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  };
  return (
    <Card className="p-3 flex items-center gap-2.5" data-testid={testid}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tones[tone]}`}><Icon size={18} weight="duotone" /></div>
      <div><p className="text-xl font-display font-semibold leading-none" data-testid={`${testid}-value`}>{value}</p><p className="text-[11px] text-muted-foreground mt-0.5">{label}</p></div>
    </Card>
  );
}

export default function CampaignsPanel({ user }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState(null);   // set → open in edit mode
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [distOpen, setDistOpen] = useState(false);
  const [pipelineKey, setPipelineKey] = useState(0);
  // Delete confirm dialog state — covers both single-detail-delete and
  // bulk-selection-delete flows. `deleteContext` holds the payload metadata.
  const [deleteContext, setDeleteContext] = useState(null); // { campaign?, campaigns?, leadCount }
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Bulk selection state (list view only). Cleared when the list reloads
  // or the user drills into a campaign.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get("/campaigns"); setList(data); }
    catch { toast.error("Could not load campaigns"); }
    finally { setLoading(false); }
  }, []);

  const loadDetail = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/campaigns/${id}`);
      setDetail(data);
    } catch { toast.error("Could not load campaign"); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);
  // Reset bulk selection whenever we leave the list view or the list refreshes.
  useEffect(() => { setSelectedIds(new Set()); }, [selectedId, list.length]);

  const open = (id) => setSelectedId(id);
  const back = () => { setSelectedId(null); setDetail(null); loadList(); };
  const refreshDetail = () => loadDetail(selectedId);
  const refreshAll = () => { loadDetail(selectedId); setPipelineKey((k) => k + 1); };

  const bulkDelete = () => {
    const selected = list.filter((c) => selectedIds.has(c.id));
    if (!selected.length) return;
    const leadCount = selected.reduce((sum, c) => sum + (c.stats?.total || 0), 0);
    setDeleteContext({ campaigns: selected, leadCount });
  };

  const confirmDelete = async (deleteLeads) => {
    if (!deleteContext) return;
    setDeleteBusy(true);
    try {
      if (deleteContext.campaigns) {
        // Bulk path
        const ids = deleteContext.campaigns.map((c) => c.id);
        const { data } = await api.post("/campaigns/bulk-delete", { ids, delete_leads: deleteLeads });
        toast.success(
          data.removed_leads
            ? `Deleted ${data.count} campaign(s) + ${data.removed_leads.toLocaleString()} lead(s)`
            : `Deleted ${data.count} campaign(s)`,
        );
        clearSelection();
        loadList();
      } else if (deleteContext.campaign) {
        // Single path (from detail view)
        const { data } = await api.delete(`/campaigns/${deleteContext.campaign.id}`, {
          params: { delete_leads: deleteLeads ? "true" : "false" },
        });
        toast.success(
          data?.removed_leads
            ? `Campaign + ${data.removed_leads.toLocaleString()} lead(s) deleted`
            : "Campaign deleted",
        );
        back();
      }
      setDeleteContext(null);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  const visibleIds = useMemo(() => list.map((c) => c.id), [list]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () => {
    if (allSelected) clearSelection();
    else setSelectedIds(new Set(visibleIds));
  };

  const removeCampaign = () => {
    if (!detail?.campaign) return;
    setDeleteContext({ campaign: detail.campaign, leadCount: detail.stats?.total || 0 });
  };

  const editCurrent = () => {
    if (detail?.campaign) setEditCampaign(detail.campaign);
  };

  // ---- Detail view ----
  if (selectedId && detail) {
    const c = detail.campaign;
    const s = detail.stats;
    return (
      <div className="space-y-5 animate-fade-in" data-testid="campaign-detail">
        <button type="button" onClick={back} data-testid="campaign-back-btn" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={15} /> All campaigns
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-xl sm:text-2xl font-semibold tracking-tight" data-testid="campaign-detail-name">{c.name}</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{OFFICE_LABEL[c.office] || c.office}</span>
              {c.tag_type && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">{c.tag_type}: {c.tag_value}</span>}
            </div>
            {c.description && <p className="text-sm text-muted-foreground mt-1">{c.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} data-testid="campaign-add-leads-btn"><Plus size={15} className="mr-1" /> Add leads</Button>
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)} data-testid="campaign-upload-btn"><UploadSimple size={15} className="mr-1" /> Upload CSV</Button>
            <Button size="sm" onClick={() => setDistOpen(true)} data-testid="campaign-distribute-btn" className="btn-amber border-0"><ShareNetwork size={15} className="mr-1" /> Distribute</Button>
            <button type="button" onClick={editCurrent} data-testid="campaign-edit-btn" className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10 transition-colors" aria-label="Edit campaign"><PencilSimple size={16} /></button>
            <button type="button" onClick={removeCampaign} data-testid="campaign-delete-btn" className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors" aria-label="Delete campaign"><Trash size={16} /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MiniStat icon={Target} label="Total leads" value={s.total} tone="amber" testid="campaign-stat-total" />
          <MiniStat icon={UserCheck} label="Assigned" value={s.assigned} tone="sky" testid="campaign-stat-assigned" />
          <MiniStat icon={UsersThree} label="Unassigned" value={s.unassigned} tone="slate" testid="campaign-stat-unassigned" />
          <MiniStat icon={CheckCircle} label="Converted" value={s.converted} tone="emerald" testid="campaign-stat-converted" />
        </div>

        {detail.distribution?.length > 0 && (
          <div data-testid="campaign-distribution">
            <p className="text-xs font-medium text-muted-foreground mb-2">Distribution</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.distribution.map((d) => (
                <span key={d.id} className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">{d.name}: {d.count}</span>
              ))}
            </div>
          </div>
        )}

        <div className="pt-1">
          <p className="text-xs font-medium text-muted-foreground mb-3">Campaign pipeline</p>
          <LeadsPipeline key={pipelineKey} user={user} campaignId={selectedId} showActions={false} onChanged={refreshDetail} />
        </div>

        <CampaignAddLeadsDialog open={addOpen} onOpenChange={setAddOpen} campaignId={selectedId} onAdded={refreshAll} />
        <LeadsBulkUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={refreshAll} user={user} campaignId={selectedId} />
        <CampaignDistributeDialog open={distOpen} onOpenChange={setDistOpen} campaignId={selectedId} employees={detail.employees} stats={s} onDistributed={refreshAll} />
        <CampaignFormDialog
          open={!!editCampaign}
          campaign={editCampaign}
          onOpenChange={(v) => { if (!v) setEditCampaign(null); }}
          user={user}
          onSaved={() => { setEditCampaign(null); refreshDetail(); loadList(); }}
        />
        <CampaignDeleteDialog
          open={!!deleteContext}
          onOpenChange={(v) => { if (!v && !deleteBusy) setDeleteContext(null); }}
          campaign={deleteContext?.campaign}
          leadCount={deleteContext?.leadCount || 0}
          busy={deleteBusy}
          onConfirm={confirmDelete}
        />
      </div>
    );
  }

  // ---- List view ----
  return (
    <div className="space-y-5 animate-fade-in" data-testid="campaigns-panel">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Group leads into campaigns and distribute them to your team.</p>
        <Button onClick={() => setCreateOpen(true)} data-testid="campaign-create-btn" className="btn-amber border-0"><Plus size={16} className="mr-1.5" /> Create campaign</Button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading campaigns…</div>
      ) : list.length === 0 ? (
        <Card className="py-16 text-center" data-testid="campaigns-empty">
          <Megaphone size={40} className="mx-auto text-muted-foreground mb-3" weight="duotone" />
          <p className="text-foreground font-medium">No campaigns yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create a campaign to batch-import and distribute leads.</p>
        </Card>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div
              data-testid="campaigns-bulk-bar"
              className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50/90 dark:bg-amber-500/10 backdrop-blur px-3 py-2 shadow-md animate-fade-in"
            >
              <span className="text-sm font-medium text-amber-900 dark:text-amber-200" data-testid="campaigns-bulk-count">
                {selectedIds.size} selected
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={bulkDelete} disabled={bulkBusy}
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 border-rose-500/30"
                data-testid="campaigns-bulk-delete-btn">
                <Trash size={14} className="mr-1.5" /> Delete
              </Button>
              <button type="button" onClick={clearSelection} data-testid="campaigns-bulk-clear-btn"
                className="h-8 w-8 rounded-md flex items-center justify-center text-amber-900/70 hover:bg-amber-500/15 dark:text-amber-200/80">
                <X size={16} />
              </button>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer" data-testid="campaigns-select-all-row">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleSelectAll}
              data-testid="campaigns-select-all"
              aria-label="Select all campaigns on this page"
            />
            {allSelected ? `All ${visibleIds.length} campaigns selected` : `Select all ${visibleIds.length} campaigns`}
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="campaigns-grid">
            {list.map((c) => {
              const isChecked = selectedIds.has(c.id);
              return (
                <div
                  key={c.id}
                  data-testid={`campaign-card-${c.id}`}
                  className={`relative rounded-xl border bg-card p-4 hover:border-orange-500/40 hover:shadow-md transition-all ${
                    isChecked ? "border-amber-500/60 ring-1 ring-amber-500/40" : "border-border"
                  }`}
                >
                  <div className="absolute top-3 left-3 z-10" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleSelected(c.id)}
                      data-testid={`campaign-checkbox-${c.id}`}
                      aria-label={`Select campaign ${c.name}`}
                    />
                  </div>
                  {/* Quick actions — surface Edit + Delete without opening the campaign */}
                  <div className="absolute top-3 right-3 z-10 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setEditCampaign(c)}
                      className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
                      data-testid={`campaign-edit-inline-${c.id}`}
                      aria-label={`Edit ${c.name}`}
                    >
                      <PencilSimple size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteContext({ campaign: c, leadCount: c.stats?.total || 0 })}
                      className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                      data-testid={`campaign-delete-inline-${c.id}`}
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                  <button type="button" onClick={() => open(c.id)}
                    className="w-full text-left pl-6 pr-14"
                    data-testid={`campaign-card-open-${c.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground truncate">{c.name}</p>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">{OFFICE_LABEL[c.office] || c.office}</span>
                    </div>
                    {c.tag_type && <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">{c.tag_type}: {c.tag_value}</span>}
                    {c.description && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{c.description}</p>}
                    <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span><strong className="text-foreground">{c.stats.total}</strong> leads</span>
                      <span><strong className="text-foreground">{c.stats.assigned}</strong> assigned</span>
                      <span><strong className="text-foreground">{c.stats.unassigned}</strong> unassigned</span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <CampaignFormDialog open={createOpen} onOpenChange={setCreateOpen} user={user} onSaved={(c) => { loadList(); open(c.id); }} />
      <CampaignFormDialog
        open={!!editCampaign}
        campaign={editCampaign}
        onOpenChange={(v) => { if (!v) setEditCampaign(null); }}
        user={user}
        onSaved={() => { setEditCampaign(null); loadList(); }}
      />
      <CampaignDeleteDialog
        open={!!deleteContext}
        onOpenChange={(v) => { if (!v && !deleteBusy) setDeleteContext(null); }}
        campaign={deleteContext?.campaign}
        campaigns={deleteContext?.campaigns}
        leadCount={deleteContext?.leadCount || 0}
        busy={deleteBusy}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

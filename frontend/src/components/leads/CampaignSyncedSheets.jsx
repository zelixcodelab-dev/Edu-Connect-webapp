import React, { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowClockwise, Trash, ClockCounterClockwise, GoogleLogo, CaretDown, CaretUp, WarningCircle } from "@phosphor-icons/react";

function fmt(dt) {
  if (!dt) return "—";
  try { return new Date(dt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return String(dt); }
}

function SyncRow({ sync, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [runs, setRuns] = useState(null);

  const runNow = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/google/syncs/${sync.id}/run`);
      if (data.error) toast.error(`Sync failed: ${data.error}`);
      else toast.success(`Synced · ${data.created_count} new lead(s)` + (data.duplicate_count ? `, ${data.duplicate_count} skipped` : ""));
      onChanged();
      if (showHistory) loadRuns();
    } catch { toast.error("Sync failed"); }
    finally { setBusy(false); }
  };

  const toggle = async (enabled) => {
    setBusy(true);
    try { await api.patch(`/google/syncs/${sync.id}`, { enabled }); onChanged(); }
    catch { toast.error("Could not update"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Stop syncing “${sync.spreadsheet_name}”? Already-imported leads stay.`)) return;
    setBusy(true);
    try { await api.delete(`/google/syncs/${sync.id}`); toast.success("Auto-sync removed"); onChanged(); }
    catch { toast.error("Could not remove"); }
    finally { setBusy(false); }
  };

  const loadRuns = useCallback(async () => {
    try { const { data } = await api.get(`/google/syncs/${sync.id}/runs`); setRuns(data.runs || []); }
    catch { setRuns([]); }
  }, [sync.id]);

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && runs === null) loadRuns();
  };

  const s = sync.last_run_summary;
  return (
    <div className="border border-border rounded-md p-3 space-y-2" data-testid={`sync-row-${sync.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{sync.spreadsheet_name}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            Tab: {sync.worksheet} · every {sync.interval_hours}h · {sync.google_email || "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Last sync: {fmt(sync.last_synced_at)}
            {s ? ` · +${s.created_count} new` + (s.duplicate_count ? `, ${s.duplicate_count} skipped` : "") : ""}
          </p>
          {sync.paused_reason && (
            <p className="text-[11px] text-amber-600 mt-0.5 inline-flex items-center gap-1"><WarningCircle size={12} /> {sync.paused_reason}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Switch checked={sync.enabled} onCheckedChange={toggle} disabled={busy} data-testid={`sync-toggle-${sync.id}`} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={runNow} disabled={busy} data-testid={`sync-run-${sync.id}`} className="h-7 text-xs">
          <ArrowClockwise size={13} className="mr-1" /> Sync now
        </Button>
        <Button size="sm" variant="outline" onClick={toggleHistory} className="h-7 text-xs" data-testid={`sync-history-${sync.id}`}>
          <ClockCounterClockwise size={13} className="mr-1" /> History {showHistory ? <CaretUp size={11} className="ml-1" /> : <CaretDown size={11} className="ml-1" />}
        </Button>
        <Button size="sm" variant="outline" onClick={remove} disabled={busy} className="h-7 text-xs text-rose-600 hover:bg-rose-500/10" data-testid={`sync-remove-${sync.id}`}>
          <Trash size={13} className="mr-1" /> Remove
        </Button>
      </div>
      {showHistory && (
        <div className="mt-1 border-t border-border pt-2" data-testid={`sync-history-list-${sync.id}`}>
          {runs === null ? <p className="text-[11px] text-muted-foreground">Loading…</p>
            : runs.length === 0 ? <p className="text-[11px] text-muted-foreground">No runs yet.</p>
            : (
              <ul className="space-y-1 max-h-40 overflow-auto">
                {runs.map((r) => (
                  <li key={r.id} className="text-[11px] flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{fmt(r.ran_at)} · {r.trigger}</span>
                    <span className={r.error ? "text-rose-600" : "text-foreground"}>
                      {r.error ? r.error : `+${r.summary?.created_count ?? 0} new` + (r.summary?.duplicate_count ? `, ${r.summary.duplicate_count} skipped` : "")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}

export default function CampaignSyncedSheets({ campaignId, refreshKey = 0 }) {
  const [syncs, setSyncs] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!campaignId) return;
    try {
      const { data } = await api.get("/google/syncs", { params: { campaign_id: campaignId } });
      setSyncs(data.syncs || []);
    } catch { setSyncs([]); }
    finally { setLoaded(true); }
  }, [campaignId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!loaded || syncs.length === 0) return null; // only render when there's something to show

  return (
    <Card className="p-4" data-testid="campaign-synced-sheets">
      <div className="flex items-center gap-2 mb-3">
        <GoogleLogo size={16} weight="bold" className="text-foreground" />
        <h3 className="text-sm font-display font-semibold">Synced sheets</h3>
        <span className="text-[11px] text-muted-foreground">({syncs.length})</span>
      </div>
      <div className="space-y-2">
        {syncs.map((s) => <SyncRow key={s.id} sync={s} onChanged={load} />)}
      </div>
    </Card>
  );
}

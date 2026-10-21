import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Trash2, Plus, RotateCcw, CheckCircle2, SkipForward, Clock } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { StatCard, LoadingState } from "@/components/platform/PlatformKit";

const STATUS = {
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  skipped: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  not_started: "bg-muted text-muted-foreground",
};

export function TourInsights({ stats, users }) {
  return (
    <div className="space-y-4" data-testid="tour-insights">
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={CheckCircle2} label="Finished" value={stats.completed} tint="bg-emerald-500/10 text-emerald-600" />
        <StatCard icon={SkipForward} label="Skipped" value={stats.skipped} tint="bg-amber-500/10 text-amber-600" />
        <StatCard icon={Clock} label="Not started" value={stats.not_started} tint="bg-sky-500/10 text-sky-600" />
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm" data-testid={`tour-user-${u.id}`}>
            <div className="min-w-0"><p className="font-medium truncate">{u.name}</p><p className="text-xs text-muted-foreground truncate">{u.email} · {(u.role || "").replace("_", " ")}</p></div>
            <span className={`text-xs px-2 py-0.5 rounded-full capitalize shrink-0 ${STATUS[u.tour_status]}`}>{u.tour_status.replace("_", " ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepRow({ s, i, last, update, move, remove }) {
  return (
    <div className={`rounded-xl border p-4 space-y-2 transition-opacity ${s.enabled ? "border-border bg-card" : "border-dashed border-border bg-muted/30 opacity-70"}`} data-testid={`tour-step-${s.id}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}</span>
        <Input value={s.title} onChange={(e) => update(i, { title: e.target.value })} className="h-9 font-medium" data-testid={`tour-step-title-${s.id}`} />
        <Switch checked={s.enabled} onCheckedChange={(v) => update(i, { enabled: v })} data-testid={`tour-step-enabled-${s.id}`} />
        <Button size="sm" variant="ghost" className="h-8 px-2" disabled={i === 0} onClick={() => move(i, -1)} data-testid={`tour-step-up-${s.id}`}><ArrowUp size={14} /></Button>
        <Button size="sm" variant="ghost" className="h-8 px-2" disabled={last} onClick={() => move(i, 1)} data-testid={`tour-step-down-${s.id}`}><ArrowDown size={14} /></Button>
        {s.custom && <Button size="sm" variant="ghost" className="h-8 px-2 text-rose-600" onClick={() => remove(i)} data-testid={`tour-step-remove-${s.id}`}><Trash2 size={14} /></Button>}
      </div>
      <Textarea value={s.body} onChange={(e) => update(i, { body: e.target.value })} rows={2} className="text-sm" data-testid={`tour-step-body-${s.id}`} />
      {s.custom && <p className="text-[11px] text-muted-foreground">Custom message, shown centred on screen.</p>}
    </div>
  );
}

export default function TourEditor({ clientId }) {
  const [data, setData] = useState(null);
  const [steps, setSteps] = useState([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get(`/platform/tenants/${clientId}/tour`);
    setData(r.data);
    setSteps(r.data.steps);
  }, [clientId]);
  useEffect(() => { load().catch(() => setFailed(true)); }, [load]);

  const update = (i, patch) => setSteps((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i, d) => setSteps((p) => { const n = [...p]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const remove = (i) => setSteps((p) => p.filter((_, j) => j !== i));
  const add = () => setSteps((p) => {
    const n = [...p];
    n.splice(Math.max(0, n.length - 1), 0, { id: `custom-${Date.now().toString(36)}`, title: "New message", body: "", enabled: true, custom: true });
    return n;
  });

  const run = async (fn, ok) => {
    setSaving(true);
    try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); } finally { setSaving(false); }
  };
  const save = () => {
    if (steps.some((s) => !s.title.trim())) { toast.error("Every step needs a title"); return; }
    run(() => api.put(`/platform/tenants/${clientId}/tour`, { steps: steps.map(({ id, title, body, enabled }) => ({ id, title, body, enabled })) }), "Tour saved");
  };
  const reset = () => window.confirm("Reset this company's tour to the default steps?") && run(() => api.delete(`/platform/tenants/${clientId}/tour`), "Tour reset to default");
  const replay = () => window.confirm("Show the tour again to every user in this company on their next visit?") && run(() => api.post(`/platform/tenants/${clientId}/tour/reset-users`), "Tour will replay for all users");

  if (failed && !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm flex items-center justify-between" data-testid="tour-load-error">
        <span className="text-muted-foreground">Couldn't load this company's tour.</span>
        <Button size="sm" variant="outline" onClick={() => { setFailed(false); load().catch(() => setFailed(true)); }} data-testid="tour-retry">Retry</Button>
      </div>
    );
  }
  if (!data) return <LoadingState />;

  return (
    <div className="grid lg:grid-cols-[1fr,360px] gap-6" data-testid="tour-editor">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-display font-semibold">Tour steps</p>
            <p className="text-xs text-muted-foreground">{data.customized ? "Custom wording for this company." : "Using the default tour."} Steps for features a user can't access are skipped automatically.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={add} data-testid="tour-add-step"><Plus size={14} className="mr-1" /> Add message</Button>
            <Button size="sm" variant="ghost" onClick={reset} disabled={saving || !data.customized} data-testid="tour-reset-default"><RotateCcw size={14} className="mr-1" /> Reset to default</Button>
            <Button size="sm" onClick={save} disabled={saving} className="btn-amber border-0" data-testid="tour-save">{saving ? "Saving…" : "Save tour"}</Button>
          </div>
        </div>
        {steps.map((s, i) => (
          <StepRow key={s.id} s={s} i={i} last={i === steps.length - 1} update={update} move={move} remove={remove} />
        ))}
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-display font-semibold">Tour insights</p>
          <Button size="sm" variant="ghost" onClick={replay} disabled={saving} data-testid="tour-replay-all"><RotateCcw size={14} className="mr-1" /> Replay for all</Button>
        </div>
        <TourInsights stats={data.stats} users={data.users} />
      </div>
    </div>
  );
}

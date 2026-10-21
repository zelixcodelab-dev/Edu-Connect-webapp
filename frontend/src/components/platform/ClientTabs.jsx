import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AppWindow, Database, HardDrive, Layers, Users, ShieldAlert, LogIn, LogOut, Unlock, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { StatCard, StatusBadge, EmptyState, LoadingState } from "@/components/platform/PlatformKit";

const fmt = (s) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const errMsg = (e, d) => e?.response?.data?.detail || d;

function useLoad(url) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try { const r = await api.get(url); setData(r.data); } catch { setFailed(true); }
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { data, setData, failed, load };
}

function LoadGate({ state, children }) {
  if (state.failed && !state.data) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm flex items-center justify-between" data-testid="tab-load-error">
        <span className="text-muted-foreground">Couldn't load this section.</span>
        <Button size="sm" variant="outline" onClick={state.load}><RefreshCw size={14} className="mr-1" /> Retry</Button>
      </div>
    );
  }
  if (!state.data) return <LoadingState />;
  return children(state.data);
}

export function ClientApplications({ clientId }) {
  const nav = useNavigate();
  const st = useLoad(`/platform/tenants/${clientId}/applications`);
  const toggle = async (a, assigned) => {
    try {
      await api.put(`/platform/tenants/${clientId}/applications/${a.id}`, { assigned });
      st.setData((d) => ({ apps: d.apps.map((x) => (x.id === a.id ? { ...x, assigned } : x)) }));
      toast.success(assigned ? `${a.name} assigned` : `${a.name} removed`);
    } catch (e) { toast.error(errMsg(e, "Update failed")); }
  };
  return (
    <LoadGate state={st}>{(d) => (d.apps.length === 0
      ? <EmptyState icon={AppWindow} title="No applications" desc="Add apps in My Apps first." action={<Button variant="ghost" onClick={() => nav("/platform/my-apps")}>Open My Apps</Button>} />
      : (
        <div className="space-y-2" data-testid="client-applications">
          {d.apps.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4" data-testid={`client-app-${a.id}`}>
              <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {a.logo_url ? <img src={a.logo_url} alt={a.name} className="w-full h-full object-contain p-1" /> : <AppWindow size={18} className="text-muted-foreground" />}
              </div>
              <button type="button" onClick={() => nav(`/platform/my-apps/${a.id}`)} className="flex-1 min-w-0 text-left">
                <p className="font-medium truncate hover:underline">{a.name}</p>
                <p className="text-xs text-muted-foreground">v{a.version} · {a.category} · <span className="capitalize">{a.environment}</span></p>
              </button>
              <StatusBadge status={a.status} />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="hidden sm:inline">{a.assigned ? "Assigned" : "Not assigned"}</span>
                <Switch checked={a.assigned} onCheckedChange={(v) => toggle(a, v)} data-testid={`client-app-toggle-${a.id}`} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </LoadGate>
  );
}

export function ClientDatabase({ clientId }) {
  const nav = useNavigate();
  const st = useLoad(`/platform/tenants/${clientId}/database`);
  return (
    <LoadGate state={st}>{(d) => (
      <div className="space-y-5" data-testid="client-database">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Database} label="Data size" value={`${d.size_mb} MB`} tint="bg-sky-500/10 text-sky-600" />
          <StatCard icon={HardDrive} label="Storage" value={`${d.storage_mb} MB`} tint="bg-violet-500/10 text-violet-600" />
          <StatCard icon={Layers} label="Collections" value={d.collections.length} tint="bg-emerald-500/10 text-emerald-600" />
          <StatCard icon={Layers} label="Documents" value={d.objects} tint="bg-amber-500/10 text-amber-600" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground"><span className="font-mono text-foreground">{d.name}</span> · <StatusBadge status={d.status} /> · Last backup: {fmt(d.last_backup)}</p>
          <Button size="sm" variant="outline" onClick={() => nav("/platform/database")} data-testid="client-db-browse">Browse documents</Button>
        </div>
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {d.collections.map((c) => (
            <div key={c.name} className="flex items-center justify-between px-4 py-2.5 text-sm" data-testid={`client-db-col-${c.name}`}>
              <span className="font-mono">{c.name}</span><span className="text-muted-foreground tabular-nums">{c.count.toLocaleString()} docs</span>
            </div>
          ))}
        </div>
      </div>
    )}</LoadGate>
  );
}

const SUB_STATUSES = [["trial", "Trial"], ["active", "Active"], ["past_due", "Past due"], ["cancelled", "Cancelled"]];

function SubscriptionForm({ clientId, data, onSaved }) {
  const s = data.subscription;
  const [form, setForm] = useState({
    plan_id: s.plan_id || data.plans.find((p) => p.name.toLowerCase() === (s.plan_name || "").toLowerCase())?.id || data.plans[0]?.id || "",
    status: s.status || "trial",
    trial_ends_at: (s.trial_ends_at || "").slice(0, 10),
    seat_limit: s.seat_limit || "",
    notes: s.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const plan = data.plans.find((p) => p.id === form.plan_id);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));
  const pickPlan = (e) => {
    const p = data.plans.find((x) => x.id === e.target.value);
    setForm((f) => ({ ...f, plan_id: e.target.value, seat_limit: p?.limits?.users || f.seat_limit }));
  };
  const save = async () => {
    if (!form.plan_id) { toast.error("Create a plan in Settings → Plans first"); return; }
    setSaving(true);
    try {
      const r = await api.put(`/platform/tenants/${clientId}/subscription`, {
        plan_id: form.plan_id, status: form.status, notes: form.notes,
        trial_ends_at: form.trial_ends_at || null, seat_limit: form.seat_limit ? Number(form.seat_limit) : null,
      });
      onSaved(r.data); toast.success("Subscription updated");
    } catch (e) { toast.error(errMsg(e, "Save failed")); } finally { setSaving(false); }
  };
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4" data-testid="subscription-form">
      <p className="font-display font-semibold">Change plan</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5"><Label>Plan</Label>
          <select value={form.plan_id} onChange={pickPlan} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="sub-plan">
            {data.plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.price ? `$${p.price}/mo` : "Free"}</option>)}
          </select>
        </div>
        <div className="space-y-1.5"><Label>Status</Label>
          <select value={form.status} onChange={set("status")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="sub-status">
            {SUB_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="space-y-1.5"><Label>Trial ends</Label><Input type="date" value={form.trial_ends_at} onChange={set("trial_ends_at")} data-testid="sub-trial-ends" /></div>
        <div className="space-y-1.5"><Label>Seat limit (users)</Label><Input type="number" min={1} value={form.seat_limit} onChange={set("seat_limit")} placeholder={String(plan?.limits?.users || "Unlimited")} data-testid="sub-seat-limit" /></div>
      </div>
      <div className="space-y-1.5"><Label>Internal notes</Label><Textarea rows={2} value={form.notes} onChange={set("notes")} data-testid="sub-notes" /></div>
      {plan?.features?.length > 0 && <p className="text-xs text-muted-foreground">Includes: {plan.features.join(" · ")}</p>}
      <Button onClick={save} disabled={saving} className="btn-amber border-0" data-testid="sub-save">{saving ? "Saving…" : "Save subscription"}</Button>
    </div>
  );
}

export function ClientSubscription({ clientId }) {
  const st = useLoad(`/platform/tenants/${clientId}/subscription`);
  return (
    <LoadGate state={st}>{(d) => {
      const s = d.subscription;
      const pct = s.seat_limit ? Math.min(100, Math.round((s.seats_used / s.seat_limit) * 100)) : 0;
      return (
        <div className="grid lg:grid-cols-[320px,1fr] gap-6" data-testid="client-subscription">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-display text-xl font-bold" data-testid="sub-current-plan">{s.plan_name}</p>
              <StatusBadge status={(s.status || "").replace("_", " ")} />
            </div>
            <div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Seats</span><span className="font-medium tabular-nums" data-testid="sub-seats">{s.seats_used} / {s.seat_limit || "∞"}</span></div>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden"><div className={`h-full transition-[width] duration-500 ${pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${s.seat_limit ? pct : 0}%` }} /></div>
              {s.seat_limit && s.seats_used >= s.seat_limit && <p className="text-xs text-rose-600 mt-1.5">Seat limit reached. New users are blocked.</p>}
            </div>
            <div className="text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Trial ends</span><span>{s.trial_ends_at ? new Date(s.trial_ends_at).toLocaleDateString() : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span>{s.price ? `$${s.price}/mo` : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Updated</span><span>{fmt(s.updated_at)}</span></div>
            </div>
          </div>
          <SubscriptionForm key={s.updated_at || "new"} clientId={clientId} data={d} onSaved={st.setData} />
        </div>
      );
    }}</LoadGate>
  );
}

export function ClientSecurity({ clientId }) {
  const st = useLoad(`/platform/tenants/${clientId}/security`);
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    if (!window.confirm("Sign out every user of this company? They'll need to log in again.")) return;
    setBusy(true);
    try { await api.post(`/platform/tenants/${clientId}/security/revoke-sessions`); toast.success("All sessions ended"); await st.load(); }
    catch (e) { toast.error(errMsg(e, "Failed")); } finally { setBusy(false); }
  };
  const unlock = async (email) => {
    try { await api.post(`/platform/tenants/${clientId}/security/unlock`, { email }); toast.success(`${email} unlocked`); await st.load(); }
    catch (e) { toast.error(errMsg(e, "Unlock failed")); }
  };
  return (
    <LoadGate state={st}>{(d) => (
      <div className="space-y-6" data-testid="client-security">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={LogIn} label="Sign-ins (24h)" value={d.success_24h} tint="bg-emerald-500/10 text-emerald-600" />
          <StatCard icon={ShieldAlert} label="Failed (24h)" value={d.failed_24h} tint="bg-rose-500/10 text-rose-600" />
          <StatCard icon={Unlock} label="Lockouts / strikes" value={d.lockouts.length} tint="bg-amber-500/10 text-amber-600" />
          <StatCard icon={Users} label="Audited actions" value={d.audit.length} tint="bg-sky-500/10 text-sky-600" />
        </div>
        <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="font-medium">Force sign-out</p>
            <p className="text-xs text-muted-foreground">Ends every active session for this company. Last used: {fmt(d.sessions_revoked_at)}</p>
          </div>
          <Button variant="outline" className="text-rose-600 border-rose-500/40 hover:bg-rose-500/5" onClick={revoke} disabled={busy} data-testid="security-revoke-sessions"><LogOut size={15} className="mr-1.5" /> Sign out all users</Button>
        </div>
        {d.lockouts.length > 0 && (
          <div className="space-y-2">
            <p className="font-display font-semibold">Failed-login strikes &amp; lockouts</p>
            {d.lockouts.map((l) => (
              <div key={l.email} className="rounded-lg border border-border bg-card p-3 flex items-center justify-between text-sm" data-testid={`lockout-${l.email}`}>
                <div><span className="font-medium">{l.email}</span> <span className="text-muted-foreground">· {l.fails} failed{l.locked_until && new Date(l.locked_until) > new Date() ? ` · locked until ${fmt(l.locked_until)}` : ""}</span></div>
                <Button size="sm" variant="ghost" onClick={() => unlock(l.email)} data-testid={`unlock-${l.email}`}><Unlock size={14} className="mr-1" /> Unlock</Button>
              </div>
            ))}
          </div>
        )}
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            <p className="font-display font-semibold">Login history</p>
            {d.events.length === 0 ? <p className="text-sm text-muted-foreground">No sign-ins recorded yet.</p> : (
              <div className="rounded-xl border border-border bg-card divide-y divide-border max-h-[420px] overflow-y-auto" data-testid="login-history">
                {d.events.map((e, i) => (
                  <div key={i} className="px-4 py-2.5 text-sm flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate">{e.email}</p><p className="text-xs text-muted-foreground truncate">{e.ip || "—"} · {fmt(e.at)}</p></div>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${e.success ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/10 text-rose-700 dark:text-rose-400"}`}>{e.success ? "Success" : "Failed"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="font-display font-semibold">Recent audited actions</p>
            {d.audit.length === 0 ? <p className="text-sm text-muted-foreground">No audited actions yet.</p> : (
              <div className="rounded-xl border border-border bg-card divide-y divide-border max-h-[420px] overflow-y-auto">
                {d.audit.map((a) => (
                  <div key={a.id} className="px-4 py-2.5 text-sm flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate"><span className="font-medium">{a.user_name}</span> · {a.action}</p><p className="text-xs text-muted-foreground truncate">{a.resource}</p></div>
                    <span className="text-xs text-muted-foreground shrink-0">{fmt(a.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )}</LoadGate>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Rocket, GitBranch, KeyRound, Server, Database, ScrollText, Plus, Trash2, Copy, Cpu, MemoryStick, HardDrive, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatCard, StatusBadge, EmptyState, LoadingState } from "@/components/platform/PlatformKit";

const fmt = (s) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const errMsg = (e, d) => e?.response?.data?.detail || d;
const DEPLOY_TONE = { success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", failed: "bg-rose-500/10 text-rose-700 dark:text-rose-400", in_progress: "bg-sky-500/10 text-sky-700 dark:text-sky-400", rolled_back: "bg-amber-500/10 text-amber-700 dark:text-amber-400" };
const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

function useList(url) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try { const r = await api.get(url); setData(r.data); } catch (e) { toast.error(errMsg(e, "Failed to load")); setData((d) => d || {}); }
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return [data, load];
}

export function AppDeployments({ app, onChange }) {
  const [data, load] = useList(`/platform/apps/${app.id}/deployments`);
  const [form, setForm] = useState({ version: "", environment: app.environment, status: "success", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    if (!form.version.trim()) { toast.error("Version is required"); return; }
    setSaving(true);
    try { await api.post(`/platform/apps/${app.id}/deployments`, form); toast.success("Deployment recorded"); setForm((p) => ({ ...p, version: "", notes: "" })); await load(); onChange?.(); }
    catch (e) { toast.error(errMsg(e, "Failed")); } finally { setSaving(false); }
  };
  if (!data) return <LoadingState />;
  const list = data.deployments || [];
  return (
    <div className="grid lg:grid-cols-[340px,1fr] gap-6" data-testid="app-deployments">
      <div className="rounded-xl border border-border bg-card p-5 space-y-3 h-fit">
        <p className="font-display font-semibold">Record a deployment</p>
        <div className="space-y-1.5"><Label>Version</Label><Input value={form.version} onChange={set("version")} placeholder={`e.g. ${app.version}`} data-testid="deploy-version" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Environment</Label><select value={form.environment} onChange={set("environment")} className={selectCls} data-testid="deploy-env">{(data.environments || []).map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
          <div className="space-y-1.5"><Label>Result</Label><select value={form.status} onChange={set("status")} className={selectCls} data-testid="deploy-status">{(data.statuses || []).map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select></div>
        </div>
        <div className="space-y-1.5"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={set("notes")} data-testid="deploy-notes" /></div>
        <p className="text-[11px] text-muted-foreground">A successful deploy to <span className="capitalize">{app.environment}</span> updates the app's current version.</p>
        <Button onClick={submit} disabled={saving} className="btn-amber border-0 w-full" data-testid="deploy-submit">{saving ? "Saving…" : "Record deployment"}</Button>
      </div>
      {list.length === 0 ? <EmptyState icon={Rocket} title="No deployments yet" desc="Record each release you ship to keep a deployment history." /> : (
        <div className="space-y-2">
          {list.map((d) => (
            <div key={d.id} className="rounded-xl border border-border bg-card p-4 flex items-start justify-between gap-3" data-testid={`deployment-${d.id}`}>
              <div className="min-w-0">
                <p className="font-medium">v{d.version} <span className="text-xs text-muted-foreground capitalize">→ {d.environment}</span></p>
                {d.notes && <p className="text-sm text-muted-foreground mt-0.5">{d.notes}</p>}
                <p className="text-xs text-muted-foreground mt-1">{d.by} · {fmt(d.created_at)}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize shrink-0 ${DEPLOY_TONE[d.status]}`}>{d.status.replace("_", " ")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppVersions({ app }) {
  const [data, load] = useList(`/platform/apps/${app.id}/versions`);
  const [form, setForm] = useState({ version: "", title: "", notes: "", released_at: "" });
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const add = async () => {
    if (!form.version.trim()) { toast.error("Version is required"); return; }
    try { await api.post(`/platform/apps/${app.id}/versions`, { ...form, released_at: form.released_at ? new Date(`${form.released_at}T12:00:00`).toISOString() : null }); toast.success("Release added"); setForm({ version: "", title: "", notes: "", released_at: "" }); load(); }
    catch (e) { toast.error(errMsg(e, "Failed")); }
  };
  const del = async (v) => {
    if (!window.confirm(`Delete release v${v.version}?`)) return;
    try { await api.delete(`/platform/apps/${app.id}/versions/${v.id}`); load(); } catch (e) { toast.error(errMsg(e, "Failed")); }
  };
  if (!data) return <LoadingState />;
  const list = data.versions || [];
  return (
    <div className="grid lg:grid-cols-[340px,1fr] gap-6" data-testid="app-versions">
      <div className="rounded-xl border border-border bg-card p-5 space-y-3 h-fit">
        <p className="font-display font-semibold">New release</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Version</Label><Input value={form.version} onChange={set("version")} placeholder="1.2.0" data-testid="version-number" /></div>
          <div className="space-y-1.5"><Label>Released</Label><Input type="date" value={form.released_at} onChange={set("released_at")} data-testid="version-date" /></div>
        </div>
        <div className="space-y-1.5"><Label>Title</Label><Input value={form.title} onChange={set("title")} placeholder="Attendance & payroll" data-testid="version-title" /></div>
        <div className="space-y-1.5"><Label>Changelog</Label><Textarea rows={4} value={form.notes} onChange={set("notes")} placeholder={"- New feature\n- Bug fix"} data-testid="version-notes" /></div>
        <Button onClick={add} className="btn-amber border-0 w-full" data-testid="version-submit">Add release</Button>
      </div>
      {list.length === 0 ? <EmptyState icon={GitBranch} title="No releases yet" desc={`Current version is v${app.version}. Add releases to build a changelog.`} /> : (
        <ol className="relative border-l border-border ml-2 space-y-5">
          {list.map((v) => (
            <li key={v.id} className="pl-5 relative" data-testid={`version-${v.version}`}>
              <span className={`absolute -left-[7px] top-1.5 w-3 h-3 rounded-full ${v.version === app.version ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">v{v.version}{v.title ? ` · ${v.title}` : ""} {v.version === app.version && <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">current</span>}</p>
                  <p className="text-xs text-muted-foreground">{fmt(v.released_at)}</p>
                  {v.notes && <pre className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap font-sans">{v.notes}</pre>}
                </div>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-rose-600" onClick={() => del(v)} data-testid={`version-delete-${v.version}`}><Trash2 size={14} /></Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AppApiKeys({ app }) {
  const [data, load] = useList(`/platform/apps/${app.id}/keys`);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState(null);
  const create = async () => {
    if (!name.trim()) { toast.error("Give the key a name"); return; }
    try { const r = await api.post(`/platform/apps/${app.id}/keys`, { name }); setFresh(r.data.key); setName(""); load(); }
    catch (e) { toast.error(errMsg(e, "Failed")); }
  };
  const revoke = async (k) => {
    if (!window.confirm(`Revoke "${k.name}"? Integrations using it will stop working.`)) return;
    try { await api.delete(`/platform/apps/${app.id}/keys/${k.id}`); toast.success("Key revoked"); load(); } catch (e) { toast.error(errMsg(e, "Failed")); }
  };
  const base = `${process.env.REACT_APP_BACKEND_URL}/api/platform/app-api/whoami`;
  if (!data) return <LoadingState />;
  const keys = data.keys || [];
  return (
    <div className="space-y-5 max-w-3xl" data-testid="app-api-keys">
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="font-display font-semibold">Issue a key</p>
        <div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website form" data-testid="key-name" /><Button onClick={create} className="btn-amber border-0" data-testid="key-create"><Plus size={14} className="mr-1" /> Create</Button></div>
        {fresh && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5" data-testid="key-fresh">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Copy this key now. It won't be shown again.</p>
            <div className="flex items-center gap-2"><code className="flex-1 text-xs break-all font-mono">{fresh}</code>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(fresh); toast.success("Copied"); }} data-testid="key-copy"><Copy size={13} /></Button></div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Test a key: <code className="font-mono">GET {base}</code> with header <code className="font-mono">X-App-Key</code>.</p>
      </div>
      {keys.length === 0 ? <EmptyState icon={KeyRound} title="No API keys" desc="Issue a key for each integration so you can revoke them independently." /> : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {keys.map((k) => (
            <div key={k.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm" data-testid={`key-${k.id}`}>
              <div className="min-w-0"><p className="font-medium">{k.name} <code className="ml-1 text-xs text-muted-foreground font-mono">{k.prefix}…</code></p>
                <p className="text-xs text-muted-foreground">Created {fmt(k.created_at)} · Last used {fmt(k.last_used_at)}</p></div>
              {k.revoked ? <StatusBadge status="revoked" /> : <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => revoke(k)} data-testid={`key-revoke-${k.id}`}>Revoke</Button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppServer({ app, onChange }) {
  const nav = useNavigate();
  const [data, load] = useList(`/platform/apps/${app.id}/server`);
  const [metrics, setMetrics] = useState(null);
  const link = async (server_id) => {
    try { await api.patch(`/platform/apps/${app.id}`, { server_id }); toast.success(server_id ? "Server linked" : "Server unlinked"); setMetrics(null); load(); onChange?.(); }
    catch (e) { toast.error(errMsg(e, "Failed")); }
  };
  const fetchMetrics = async (s) => {
    setMetrics({ loading: true });
    try { const r = await api.get(`/platform/servers/${s.id}/metrics`); setMetrics(r.data); } catch (e) { setMetrics({ error: errMsg(e, "Agent unreachable") }); }
  };
  if (!data) return <LoadingState />;
  const s = data.server;
  return (
    <div className="space-y-5 max-w-3xl" data-testid="app-server">
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <Label>Linked server</Label>
        <div className="flex gap-2">
          <select value={app.server_id || ""} onChange={(e) => link(e.target.value)} className={selectCls} data-testid="app-server-select">
            <option value="">Not linked</option>
            {(data.servers || []).map((x) => <option key={x.id} value={x.id}>{x.name}{x.hostname ? ` · ${x.hostname}` : ""}</option>)}
          </select>
          <Button variant="outline" onClick={() => nav("/platform/vps-server")}>Manage servers</Button>
        </div>
      </div>
      {!s ? <EmptyState icon={Server} title="No server linked" desc="Link this app to a server from the VPS module to see its runtime details here." /> : (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4" data-testid="app-server-card">
          <div className="flex items-center justify-between gap-3">
            <div><p className="font-display font-semibold">{s.name}</p><p className="text-xs text-muted-foreground">{s.hostname || "—"} · {s.provider || "—"} · <span className="capitalize">{s.environment}</span></p></div>
            <StatusBadge status={s.status || "unknown"} />
          </div>
          {s.has_agent ? (
            <>
              <Button size="sm" variant="outline" onClick={() => fetchMetrics(s)} data-testid="app-server-metrics"><RefreshCw size={14} className="mr-1" /> Live metrics</Button>
              {metrics?.loading && <LoadingState />}
              {metrics?.error && <p className="text-sm text-rose-600">{metrics.error}</p>}
              {metrics && !metrics.loading && !metrics.error && (
                <div className="grid grid-cols-3 gap-3">
                  <StatCard icon={Cpu} label="CPU" value={`${metrics.cpu_percent ?? "—"}%`} tint="bg-sky-500/10 text-sky-600" />
                  <StatCard icon={MemoryStick} label="RAM" value={`${metrics.ram_percent ?? "—"}%`} tint="bg-violet-500/10 text-violet-600" />
                  <StatCard icon={HardDrive} label="Disk" value={`${metrics.disk_percent ?? "—"}%`} tint="bg-amber-500/10 text-amber-600" />
                </div>
              )}
            </>
          ) : <p className="text-sm text-muted-foreground">Connect the server agent in the VPS module to see live CPU, RAM and disk.</p>}
        </div>
      )}
    </div>
  );
}

export function AppDatabases({ app }) {
  const nav = useNavigate();
  const [data] = useList(`/platform/apps/${app.id}/databases`);
  if (!data) return <LoadingState />;
  const list = data.databases || [];
  if (list.length === 0) return <EmptyState icon={Database} title="No databases" desc="Assign clients to this app to see their databases." />;
  return (
    <div className="space-y-2" data-testid="app-databases">
      {list.map((d) => (
        <button key={d.name} type="button" onClick={() => nav(`/platform/clients/${d.client_id}`)} className="w-full text-left rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3 hover:border-primary/40 transition-colors" data-testid={`app-db-${d.client_id}`}>
          <div className="min-w-0"><p className="font-medium">{d.client}</p><p className="text-xs text-muted-foreground font-mono truncate">{d.name}</p></div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0"><span>{d.collections} collections</span><span>{d.size_mb} MB</span><StatusBadge status={d.status} /></div>
        </button>
      ))}
    </div>
  );
}

export function AppLogs({ app }) {
  const [data, load] = useList(`/platform/apps/${app.id}/logs`);
  if (!data) return <LoadingState />;
  const list = data.entries || [];
  return (
    <div className="space-y-3" data-testid="app-logs">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">Every change, deployment, release and key event for this app.</p><Button size="sm" variant="ghost" onClick={load} data-testid="app-logs-refresh"><RefreshCw size={14} className="mr-1" /> Refresh</Button></div>
      {list.length === 0 ? <EmptyState icon={ScrollText} title="No events yet" desc="Events appear as you edit, deploy or release this app." /> : (
        <div className="rounded-xl border border-border bg-zinc-950 text-zinc-100 font-mono text-xs p-4 max-h-[520px] overflow-y-auto space-y-1">
          {list.map((e) => (
            <div key={e.id} className="flex gap-3"><span className="text-zinc-500 shrink-0">{fmt(e.timestamp)}</span><span className="text-emerald-400 shrink-0">{e.action}</span><span className="truncate">{e.resource} <span className="text-zinc-500">· {e.user_email}</span></span></div>
          ))}
        </div>
      )}
    </div>
  );
}

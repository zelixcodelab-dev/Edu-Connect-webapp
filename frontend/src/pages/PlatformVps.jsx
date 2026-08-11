import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Server, Power, RotateCw, Square, Play, Plus, Trash2, Info, Boxes, FileText, RefreshCw, Wifi, WifiOff, Loader2 } from "lucide-react";
import api from "@/lib/api";
import PlatformShell from "@/components/platform/PlatformShell";
import { StatCard, StatusBadge, EmptyState, LoadingState } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

const empty = { name: "", environment: "production", hostname: "", provider: "Custom", status: "online", notes: "", agent_url: "", agent_key: "" };
const TAIL_OPTIONS = [100, 200, 500, 1000];

function containerStateColor(state) {
  const s = (state || "").toLowerCase();
  if (s === "running") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
  if (s === "restarting") return "bg-amber-500/10 text-amber-600 border-amber-500/30";
  if (s === "exited" || s === "stopped" || s === "dead") return "bg-slate-500/10 text-slate-500 border-slate-500/30";
  return "bg-rose-500/10 text-rose-600 border-rose-500/30";
}

function containerStateLabel(state) {
  const s = (state || "").toLowerCase();
  if (s === "running") return "Running";
  if (s === "restarting") return "Restarting";
  if (s === "exited" || s === "stopped" || s === "dead") return "Stopped";
  return "Error";
}

export default function PlatformVps() {
  const [servers, setServers] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [metrics, setMetrics] = useState(null);

  // Docker container panel state
  const [ctnServer, setCtnServer] = useState(null);
  const [containers, setContainers] = useState([]);
  const [ctnLoading, setCtnLoading] = useState(false);
  const [ctnError, setCtnError] = useState(null);
  const [busyName, setBusyName] = useState(null);
  // Logs state
  const [logsFor, setLogsFor] = useState(null);
  const [logsText, setLogsText] = useState("");
  const [logsTail, setLogsTail] = useState(200);
  const [logsLoading, setLogsLoading] = useState(false);

  const viewMetrics = async (s) => {
    setMetrics({ loading: true, name: s.name });
    try { const { data } = await api.get(`/platform/servers/${s.id}/metrics`); setMetrics({ ...data, name: s.name }); }
    catch (e) { setMetrics(null); toast.error(e?.response?.data?.detail || "Agent unreachable"); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get("/platform/servers"); setServers(data.servers || []); setCounts(data.counts || {}); }
    catch { toast.error("Failed to load servers"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      if (editId) await api.patch(`/platform/servers/${editId}`, form); else await api.post("/platform/servers", form);
      toast.success(editId ? "Server updated" : "Server added"); setOpen(false); await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); } finally { setSaving(false); }
  };

  const act = async (s, action) => {
    if (!window.confirm(`${action.toUpperCase()} server "${s.name}"?\n\n⚠ This is a privileged infrastructure action and will be audited.`)) return;
    try { const { data } = await api.post(`/platform/servers/${s.id}/action`, { action }); toast.success(data.note || "Done"); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const remove = async (s) => { if (!window.confirm(`Delete server "${s.name}"?`)) return; try { await api.delete(`/platform/servers/${s.id}`); toast.success("Deleted"); await load(); } catch (e) { toast.error("Failed"); } };

  // ─────────── Docker containers ───────────
  const fetchContainers = useCallback(async (server) => {
    if (!server) return;
    setCtnLoading(true); setCtnError(null);
    try {
      const { data } = await api.get(`/platform/servers/${server.id}/containers`);
      setContainers(data.containers || []);
    } catch (e) {
      setContainers([]);
      setCtnError(e?.response?.data?.detail || "Agent unreachable");
    } finally { setCtnLoading(false); }
  }, []);

  const openContainers = (s) => { setCtnServer(s); setContainers([]); setCtnError(null); fetchContainers(s); };

  const containerAction = async (c, action) => {
    if (!window.confirm(`${action.toUpperCase()} container "${c.name}"?\n\n⚠ This is a privileged infrastructure action and will be audited.`)) return;
    setBusyName(c.name);
    try {
      await api.post(`/platform/servers/${ctnServer.id}/containers/${encodeURIComponent(c.name)}/${action}`);
      toast.success(`${action} · ${c.name}`);
      await fetchContainers(ctnServer);
    } catch (e) {
      toast.error(e?.response?.data?.detail || `Failed to ${action} ${c.name}`);
    } finally { setBusyName(null); }
  };

  const fetchLogs = useCallback(async (name, tail) => {
    if (!ctnServer || !name) return;
    setLogsLoading(true);
    try {
      const { data } = await api.get(`/platform/servers/${ctnServer.id}/containers/${encodeURIComponent(name)}/logs`, { params: { tail } });
      setLogsText(data.logs || "(no output)");
    } catch (e) {
      setLogsText(`⚠ ${e?.response?.data?.detail || "Failed to fetch logs"}`);
    } finally { setLogsLoading(false); }
  }, [ctnServer]);

  const openLogs = (c) => { setLogsFor(c.name); setLogsText(""); fetchLogs(c.name, logsTail); };

  const changeTail = (t) => { setLogsTail(t); fetchLogs(logsFor, t); };

  return (
    <PlatformShell module={MODULE_BY_KEY["vps-server"]} title="VPS Server">
      <div className="space-y-8">
        <div className="grid grid-cols-3 gap-4 max-w-xl">
          <StatCard icon={Server} label="Servers" value={counts.total || 0} tint="bg-sky-500/10 text-sky-600" />
          <StatCard icon={Power} label="Online" value={counts.online || 0} tint="bg-emerald-500/10 text-emerald-600" />
          <StatCard icon={Square} label="Offline" value={counts.offline || 0} tint="bg-rose-500/10 text-rose-600" />
        </div>

        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 flex items-start gap-3 text-sm" data-testid="agent-notice">
          <Info size={18} className="text-sky-600 mt-0.5 shrink-0" />
          <p className="text-muted-foreground">Register your servers here to track and control them. Live CPU/RAM metrics, Docker containers and terminal require a connected server agent — control actions are recorded and audited until then.</p>
        </div>

        <div className="flex items-center justify-between">
          <div><h2 className="font-display text-xl font-semibold">Servers</h2><p className="text-sm text-muted-foreground">Your infrastructure inventory.</p></div>
          <Button onClick={() => { setForm(empty); setEditId(null); setOpen(true); }} data-testid="new-server-btn" className="bg-primary hover:bg-primary/90 text-primary-foreground border-0"><Plus size={16} className="mr-1.5" /> Add server</Button>
        </div>

        {loading ? <LoadingState /> : servers.length === 0 ? (
          <EmptyState icon={Server} title="No servers yet" desc="Add your first server to start tracking infrastructure." />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto" data-testid="server-table">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Server</TableHead><TableHead className="hidden md:table-cell">Environment</TableHead>
                <TableHead className="hidden lg:table-cell">Provider</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Control</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {servers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground font-mono">{s.hostname || "—"}</p></TableCell>
                    <TableCell className="hidden md:table-cell text-sm capitalize text-muted-foreground">{s.environment}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm">{s.provider}</TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        {s.has_agent && <Button size="sm" variant="ghost" className="h-8 px-2 text-sky-600" title="Live metrics" data-testid="server-metrics" onClick={() => viewMetrics(s)}><Info size={14} /></Button>}
                        {s.has_agent && <Button size="sm" variant="ghost" className="h-8 px-2 text-indigo-600" title="Docker containers" data-testid="server-containers" onClick={() => openContainers(s)}><Boxes size={14} /></Button>}
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-emerald-600" title="Start" onClick={() => act(s, "start")}><Play size={14} /></Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-amber-600" title="Restart" data-testid="server-restart" onClick={() => act(s, "restart")}><RotateCw size={14} /></Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-rose-600" title="Stop" onClick={() => act(s, "stop")}><Square size={14} /></Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-rose-600" title="Delete" onClick={() => remove(s)}><Trash2 size={14} /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Add / edit server */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="server-dialog">
          <DialogHeader><DialogTitle>{editId ? "Edit server" : "Add server"}</DialogTitle><DialogDescription>Track a VPS or bare-metal server in your inventory.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} data-testid="server-name" /></div>
            <div className="space-y-1.5"><Label>Hostname / IP</Label><Input value={form.hostname} onChange={(e) => setForm((p) => ({ ...p, hostname: e.target.value }))} placeholder="1.2.3.4 or vps.example.com" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Environment</Label>
                <select value={form.environment} onChange={(e) => setForm((p) => ({ ...p, environment: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {["production", "staging", "development"].map((x) => <option key={x} value={x} className="capitalize">{x}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Provider</Label><Input value={form.provider} onChange={(e) => setForm((p) => ({ ...p, provider: e.target.value }))} placeholder="Railway, Hetzner…" /></div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Live agent (optional — for real metrics & Docker control)</p>
              <div className="space-y-1.5"><Label>Agent URL</Label><Input value={form.agent_url} onChange={(e) => setForm((p) => ({ ...p, agent_url: e.target.value }))} placeholder="https://your-vps:9101" data-testid="server-agent-url" /></div>
              <div className="space-y-1.5 mt-2"><Label>Agent key</Label><Input type="password" value={form.agent_key} onChange={(e) => setForm((p) => ({ ...p, agent_key: e.target.value }))} placeholder="Shared secret set on the agent" data-testid="server-agent-key" /></div>
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground border-0" data-testid="save-server">{saving ? "Saving…" : editId ? "Save" : "Add server"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Live metrics */}
      <Dialog open={!!metrics} onOpenChange={(o) => !o && setMetrics(null)}>
        <DialogContent data-testid="metrics-dialog">
          <DialogHeader><DialogTitle>Live metrics · {metrics?.name}</DialogTitle></DialogHeader>
          {metrics?.loading ? <LoadingState /> : metrics ? (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="CPU" value={`${metrics.cpu_percent ?? "—"}%`} tint="bg-sky-500/10 text-sky-600" />
              <StatCard label="RAM" value={`${metrics.ram_percent ?? "—"}%`} tint="bg-violet-500/10 text-violet-600" />
              <StatCard label="Disk" value={`${metrics.disk_percent ?? "—"}%`} tint="bg-amber-500/10 text-amber-600" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Docker containers */}
      <Dialog open={!!ctnServer} onOpenChange={(o) => !o && setCtnServer(null)}>
        <DialogContent className="max-w-3xl" data-testid="containers-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Boxes size={18} /> Docker containers · {ctnServer?.name}</DialogTitle>
            <DialogDescription className="flex items-center gap-4">
              {ctnError ? (
                <span className="inline-flex items-center gap-1.5 text-rose-600" data-testid="agent-disconnected"><WifiOff size={14} /> Agent disconnected</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-emerald-600" data-testid="agent-connected"><Wifi size={14} /> Agent connected</span>
              )}
              <button onClick={() => fetchContainers(ctnServer)} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors" data-testid="refresh-containers" disabled={ctnLoading}>
                <RefreshCw size={14} className={ctnLoading ? "animate-spin" : ""} /> Refresh
              </button>
            </DialogDescription>
          </DialogHeader>

          {ctnLoading && containers.length === 0 ? <LoadingState /> : ctnError ? (
            <EmptyState icon={WifiOff} title="Agent unreachable" desc={ctnError} />
          ) : containers.length === 0 ? (
            <EmptyState icon={Boxes} title="No containers" desc="No Docker containers found on this host." />
          ) : (
            <div className="rounded-xl border border-border overflow-hidden overflow-x-auto max-h-[55vh] overflow-y-auto" data-testid="containers-table">
              <Table>
                <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Container</TableHead><TableHead>State</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {containers.map((c) => {
                    const st = (c.state || "").toLowerCase();
                    const running = st === "running";
                    const stopped = ["exited", "stopped", "dead"].includes(st);
                    const busy = busyName === c.name;
                    return (
                      <TableRow key={c.name}>
                        <TableCell>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate max-w-[240px]">{c.image}</p>
                          <p className="text-xs text-muted-foreground">{c.status}</p>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${containerStateColor(c.state)}`}>{containerStateLabel(c.state)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1 items-center">
                            {busy && <Loader2 size={14} className="animate-spin text-muted-foreground mr-1" data-testid="container-busy" />}
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-emerald-600" title="Start" data-testid="container-start" disabled={busy || running} onClick={() => containerAction(c, "start")}><Play size={14} /></Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-amber-600" title="Restart" data-testid="container-restart" disabled={busy || stopped} onClick={() => containerAction(c, "restart")}><RotateCw size={14} /></Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-rose-600" title="Stop" data-testid="container-stop" disabled={busy || stopped} onClick={() => containerAction(c, "stop")}><Square size={14} /></Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-sky-600" title="Logs" data-testid="container-logs" disabled={busy} onClick={() => openLogs(c)}><FileText size={14} /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Container logs */}
      <Dialog open={!!logsFor} onOpenChange={(o) => !o && setLogsFor(null)}>
        <DialogContent className="max-w-3xl" data-testid="logs-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText size={18} /> Logs · {logsFor}</DialogTitle>
            <DialogDescription className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Lines:</span>
                <select value={logsTail} onChange={(e) => changeTail(Number(e.target.value))} className="h-8 rounded-md border border-input bg-background px-2 text-sm" data-testid="logs-tail-select">
                  {TAIL_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </span>
              <button onClick={() => fetchLogs(logsFor, logsTail)} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors" data-testid="refresh-logs" disabled={logsLoading}>
                <RefreshCw size={14} className={logsLoading ? "animate-spin" : ""} /> Refresh logs
              </button>
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-slate-950 text-slate-100 font-mono text-xs p-4 max-h-[55vh] overflow-auto whitespace-pre-wrap break-words" data-testid="logs-output">
            {logsLoading ? "Loading…" : logsText || "(no output)"}
          </div>
        </DialogContent>
      </Dialog>
    </PlatformShell>
  );
}

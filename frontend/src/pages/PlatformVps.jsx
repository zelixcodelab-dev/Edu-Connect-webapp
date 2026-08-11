import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Server, Power, RotateCw, Square, Play, Plus, Trash2, Info } from "lucide-react";
import api from "@/lib/api";
import PlatformShell from "@/components/platform/PlatformShell";
import { StatCard, StatusBadge, EmptyState, LoadingState } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

const empty = { name: "", environment: "production", hostname: "", provider: "Custom", status: "online", notes: "" };

export default function PlatformVps() {
  const [servers, setServers] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

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
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground border-0" data-testid="save-server">{saving ? "Saving…" : editId ? "Save" : "Add server"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </PlatformShell>
  );
}

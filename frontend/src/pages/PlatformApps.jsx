import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, AppWindow, CheckCircle2, AlertTriangle, Pencil, Trash2, Users, ArrowUpRight } from "lucide-react";
import api from "@/lib/api";
import { useNavigate } from "react-router-dom";
import PlatformShell from "@/components/platform/PlatformShell";
import { StatCard, StatusBadge, EmptyState, LoadingState } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

const ENV_TONE = { production: "bg-emerald-500/10 text-emerald-600", staging: "bg-amber-500/10 text-amber-600", development: "bg-sky-500/10 text-sky-600" };
const empty = { name: "", description: "", version: "1.0.0", environment: "production", status: "online", category: "SaaS", logo_url: "" };

export default function PlatformApps() {
  const nav = useNavigate();
  const [apps, setApps] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get("/platform/apps"); setApps(data.apps || []); setCounts(data.counts || {}); }
    catch { toast.error("Failed to load apps"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(empty); setEditId(null); setOpen(true); };
  const openEdit = (a) => { setForm({ ...empty, ...a }); setEditId(a.id); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editId) await api.patch(`/platform/apps/${editId}`, form);
      else await api.post("/platform/apps", form);
      toast.success(editId ? "Application updated" : "Application added");
      setOpen(false); await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); } finally { setSaving(false); }
  };

  const remove = async (a) => {
    if (!window.confirm(`Delete application "${a.name}"?`)) return;
    try { await api.delete(`/platform/apps/${a.id}`); toast.success("Deleted"); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  return (
    <PlatformShell module={MODULE_BY_KEY["my-apps"]} title="My Apps">
      <div className="space-y-8">
        <div className="grid grid-cols-3 gap-4 max-w-xl">
          <StatCard icon={AppWindow} label="Applications" value={counts.total || 0} tint="bg-violet-500/10 text-violet-600" />
          <StatCard icon={CheckCircle2} label="Online" value={counts.online || 0} tint="bg-emerald-500/10 text-emerald-600" />
          <StatCard icon={AlertTriangle} label="Issues" value={counts.issues || 0} tint="bg-rose-500/10 text-rose-600" />
        </div>

        <div className="flex items-center justify-between">
          <div><h2 className="font-display text-xl font-semibold">Applications</h2><p className="text-sm text-muted-foreground">Every SaaS product on your platform.</p></div>
          <Button onClick={openCreate} data-testid="new-app-btn" className="bg-primary hover:bg-primary/90 text-primary-foreground border-0"><Plus size={16} className="mr-1.5" /> New app</Button>
        </div>

        {loading ? <LoadingState /> : apps.length === 0 ? (
          <EmptyState icon={AppWindow} title="No applications" desc="Add your first SaaS application." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="apps-grid">
            {apps.map((a) => (
              <div key={a.id} className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4" data-testid={`app-${a.slug}`}>
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-muted overflow-hidden flex items-center justify-center shrink-0">
                    {a.logo_url ? <img src={a.logo_url} alt={a.name} className="w-full h-full object-contain p-1" /> : <AppWindow size={22} className="text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display font-semibold truncate">{a.name}</h3>
                    <p className="text-xs text-muted-foreground">v{a.version} · {a.category}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">{a.description}</p>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className={`px-2 py-0.5 rounded-full capitalize ${ENV_TONE[a.environment] || "bg-muted"}`}>{a.environment}</span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><Users size={13} /> {a.active_users} users</span>
                  <span className="text-muted-foreground">· {a.assigned_clients} clients</span>
                </div>
                <div className="flex items-center gap-1.5 pt-2 border-t border-border/60 mt-auto">
                  <Button size="sm" variant="ghost" onClick={() => nav(`/platform/my-apps/${a.id}`)} className="h-8" data-testid={`open-app-${a.slug}`}><ArrowUpRight size={14} className="mr-1" /> Open</Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(a)} className="h-8"><Pencil size={14} className="mr-1" /> Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(a)} className="h-8 text-rose-600 hover:text-rose-700"><Trash2 size={14} className="mr-1" /> Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="app-dialog">
          <DialogHeader><DialogTitle>{editId ? "Edit application" : "New application"}</DialogTitle><DialogDescription>Applications are generic — add any SaaS product.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} data-testid="app-name" /></div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Version</Label><Input value={form.version} onChange={(e) => setForm((p) => ({ ...p, version: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Category</Label><Input value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Environment</Label>
                <select value={form.environment} onChange={(e) => setForm((p) => ({ ...p, environment: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {["production", "staging", "development"].map((x) => <option key={x} value={x} className="capitalize">{x}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Status</Label>
                <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} data-testid="app-status" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {["online", "degraded", "offline", "maintenance"].map((x) => <option key={x} value={x} className="capitalize">{x}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Logo URL (optional)</Label><Input value={form.logo_url} onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))} placeholder="/brand-logo.png" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground border-0" data-testid="save-app">{saving ? "Saving…" : editId ? "Save changes" : "Add app"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlatformShell>
  );
}

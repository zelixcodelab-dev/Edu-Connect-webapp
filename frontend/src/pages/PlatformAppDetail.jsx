import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, AppWindow, Users, Boxes, Rocket, GitBranch, ScrollText, KeyRound, Server, Database, Settings2 } from "lucide-react";
import api from "@/lib/api";
import PlatformShell from "@/components/platform/PlatformShell";
import { StatCard, StatusBadge, EmptyState, LoadingState } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ENV_TONE = { production: "bg-emerald-500/10 text-emerald-600", staging: "bg-amber-500/10 text-amber-600", development: "bg-sky-500/10 text-sky-600" };

export default function PlatformAppDetail() {
  const { appId } = useParams();
  const nav = useNavigate();
  const [app, setApp] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([
        api.get(`/platform/apps/${appId}`),
        api.get(`/platform/tenants`).catch(() => ({ data: { tenants: [] } })),
      ]);
      setApp(a.data); setForm(a.data); setClients(t.data.tenants || []);
    } catch { /* */ } finally { setLoading(false); }
  }, [appId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/platform/apps/${appId}`, {
        name: form.name, description: form.description, version: form.version,
        environment: form.environment, status: form.status, category: form.category,
      });
      setApp(data); setForm(data); toast.success("Application updated");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); } finally { setSaving(false); }
  };

  if (loading) return <PlatformShell module={MODULE_BY_KEY["my-apps"]} title="Application"><LoadingState /></PlatformShell>;
  if (!app) return <PlatformShell module={MODULE_BY_KEY["my-apps"]} title="Application"><EmptyState title="Application not found" /></PlatformShell>;

  const assigned = clients.filter((c) => (app.assigned_client_ids || []).includes(c.id));

  return (
    <PlatformShell module={MODULE_BY_KEY["my-apps"]} title="Application detail">
      <button onClick={() => nav("/platform/my-apps")} data-testid="back-to-apps" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5">
        <ArrowLeft size={15} /> All apps
      </button>

      <div className="flex items-start gap-4 mb-8">
        <div className="w-16 h-16 rounded-2xl bg-muted overflow-hidden flex items-center justify-center shrink-0">
          {app.logo_url ? <img src={app.logo_url} alt={app.name} className="w-full h-full object-contain p-1.5" /> : <AppWindow size={28} className="text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-2xl font-bold tracking-tight">{app.name}</h2>
          <p className="text-sm text-muted-foreground">v{app.version} · {app.category}</p>
          <div className="flex items-center gap-2 mt-2">
            <StatusBadge status={app.status} />
            <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${ENV_TONE[app.environment] || "bg-muted"}`}>{app.environment}</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview" data-testid="app-tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="clients" data-testid="app-tab-clients">Clients</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
          <TabsTrigger value="server">Server</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="settings" data-testid="app-tab-settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Users} label="Active users" value={app.active_users ?? 0} tint="bg-violet-500/10 text-violet-600" />
            <StatCard icon={Boxes} label="Assigned clients" value={app.assigned_clients ?? 0} tint="bg-rose-500/10 text-rose-600" />
            <StatCard icon={Rocket} label="Environment" value={<span className="text-base capitalize">{app.environment}</span>} tint="bg-sky-500/10 text-sky-600" />
            <StatCard icon={GitBranch} label="Version" value={`v${app.version}`} tint="bg-emerald-500/10 text-emerald-600" />
          </div>
          <div className="mt-6 rounded-xl border border-border bg-card p-5">
            <p className="font-display font-semibold mb-1">Description</p>
            <p className="text-sm text-muted-foreground">{app.description || "No description."}</p>
          </div>
        </TabsContent>

        <TabsContent value="clients" className="pt-6">
          {assigned.length === 0 ? <EmptyState icon={Boxes} title="No clients assigned" desc="Assign this app to client workspaces." /> : (
            <div className="space-y-2" data-testid="app-clients">
              {assigned.map((c) => (
                <button key={c.id} onClick={() => nav(`/platform/clients/${c.id}`)} className="w-full text-left rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3 hover:border-primary/40 transition-colors">
                  <div><p className="font-medium">{c.name}</p><p className="text-xs text-muted-foreground">{c.admin_email}</p></div>
                  <StatusBadge status={c.status} />
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="pt-6">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4 max-w-lg">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} data-testid="app-edit-name" /></div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea rows={2} value={form.description || ""} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Version</Label><Input value={form.version || ""} onChange={(e) => setForm((p) => ({ ...p, version: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Status</Label>
                <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {["online", "degraded", "offline", "maintenance"].map((x) => <option key={x} value={x} className="capitalize">{x}</option>)}
                </select>
              </div>
            </div>
            <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground border-0" data-testid="save-app-detail">{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </TabsContent>

        <TabsContent value="deployments" className="pt-6"><EmptyState icon={Rocket} title="Deployments" desc="Connect your CI/CD or deploy provider to stream real deployment history here." /></TabsContent>
        <TabsContent value="database" className="pt-6"><EmptyState icon={Database} title="Database" desc="View live connections and collections in the Database module." action={<Button variant="ghost" onClick={() => nav('/platform/database')}>Open Database</Button>} /></TabsContent>
        <TabsContent value="api" className="pt-6"><EmptyState icon={KeyRound} title="API keys" desc="Issue and rotate API keys once the API gateway is connected." /></TabsContent>
        <TabsContent value="server" className="pt-6"><EmptyState icon={Server} title="Server" desc="Link this app to a server in the VPS module to see runtime health." action={<Button variant="ghost" onClick={() => nav('/platform/vps-server')}>Open VPS</Button>} /></TabsContent>
        <TabsContent value="logs" className="pt-6"><EmptyState icon={ScrollText} title="Logs" desc="Live application logs stream here once a log source is connected." /></TabsContent>
        <TabsContent value="versions" className="pt-6"><EmptyState icon={GitBranch} title="Versions" desc={`Current: v${app.version}. Full release history appears when a version source is connected.`} /></TabsContent>
      </Tabs>
    </PlatformShell>
  );
}

import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Settings2, Users, ShieldCheck, CreditCard, Boxes, Server, Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import PlatformShell from "@/components/platform/PlatformShell";
import { EmptyState, LoadingState, Avatar } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

const SECTIONS = [
  { key: "platform", label: "Platform", icon: Settings2 },
  { key: "users", label: "Users & Access", icon: Users },
  { key: "clients", label: "Clients & Plans", icon: CreditCard },
  { key: "applications", label: "Applications", icon: Boxes },
  { key: "infrastructure", label: "Infrastructure", icon: Server },
  { key: "security", label: "Security", icon: ShieldCheck },
];
const fmt = (s) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function PlatformSettings() {
  const { user } = useAuth();
  const [section, setSection] = useState("platform");
  const mod = { ...MODULE_BY_KEY.settings, subnav: [] };
  return (
    <PlatformShell module={mod} title="Settings">
      <div className="grid lg:grid-cols-[220px,1fr] gap-6">
        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button key={s.key} onClick={() => setSection(s.key)} data-testid={`settings-nav-${s.key}`}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${section === s.key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"}`}>
                <Icon size={16} /> {s.label}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0">
          {section === "platform" && <GeneralSettings />}
          {section === "users" && <UsersAccess me={user} />}
          {section === "clients" && <Plans />}
          {section === "security" && <SecurityAudit />}
          {section === "applications" && <EmptyState icon={Boxes} title="Applications" desc="Manage apps in the My Apps module. API keys, webhooks & integrations arrive in a later phase." />}
          {section === "infrastructure" && <EmptyState icon={Server} title="Infrastructure" desc="Databases, VPS, backups & monitoring are configured in Phase 4." />}
        </div>
      </div>
    </PlatformShell>
  );
}

function Card({ title, desc, children }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 mb-5">
      {title && <div className="mb-4"><h3 className="font-display text-lg font-semibold">{title}</h3>{desc && <p className="text-sm text-muted-foreground">{desc}</p>}</div>}
      {children}
    </div>
  );
}

function GeneralSettings() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get("/platform/settings").then(({ data }) => setS(data)).catch(() => setS({})); }, []);
  const save = async () => {
    setSaving(true);
    try { const { data } = await api.patch("/platform/settings", s); setS(data); toast.success("Settings saved"); }
    catch { toast.error("Save failed"); } finally { setSaving(false); }
  };
  if (!s) return <LoadingState />;
  return (
    <Card title="General" desc="Platform-wide identity and defaults.">
      <div className="space-y-4 max-w-lg">
        <div className="space-y-1.5"><Label>Platform name</Label><Input value={s.platform_name || ""} onChange={(e) => setS((p) => ({ ...p, platform_name: e.target.value }))} data-testid="settings-platform-name" /></div>
        <div className="space-y-1.5"><Label>Support email</Label><Input value={s.support_email || ""} onChange={(e) => setS((p) => ({ ...p, support_email: e.target.value }))} placeholder="support@yourdomain.com" /></div>
        <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={!!s.maintenance} onChange={(e) => setS((p) => ({ ...p, maintenance: e.target.checked }))} /> Maintenance mode</label>
        <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground border-0" data-testid="save-settings">{saving ? "Saving…" : "Save changes"}</Button>
      </div>
    </Card>
  );
}

function UsersAccess({ me }) {
  const [staff, setStaff] = useState([]);
  const [roles, setRoles] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "support" });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const [s, r] = await Promise.all([api.get("/platform/staff"), api.get("/platform/roles")]);
    setStaff(s.data.staff || []); setRoles(r.data.roles || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form.email || !form.password || !form.name) { toast.error("All fields required"); return; }
    setSaving(true);
    try { await api.post("/platform/staff", form); toast.success("Staff member added"); setOpen(false); setForm({ name: "", email: "", password: "", role: "support" }); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); } finally { setSaving(false); }
  };
  const changeRole = async (u, role) => { try { await api.patch(`/platform/staff/${u.id}`, { role }); toast.success("Role updated"); await load(); } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); } };
  const remove = async (u) => { if (!window.confirm(`Remove ${u.email}?`)) return; try { await api.delete(`/platform/staff/${u.id}`); toast.success("Removed"); await load(); } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); } };

  return (
    <>
      <Card title="Platform users" desc="Team members who can access this console.">
        <div className="flex justify-end mb-3"><Button onClick={() => setOpen(true)} size="sm" data-testid="add-staff-btn" className="bg-primary text-primary-foreground border-0"><Plus size={15} className="mr-1" /> Add user</Button></div>
        <div className="space-y-2" data-testid="staff-list">
          {staff.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <Avatar name={u.name} size={34} />
              <div className="min-w-0 flex-1"><p className="font-medium truncate">{u.name}</p><p className="text-xs text-muted-foreground truncate">{u.email}</p></div>
              {u.is_owner ? (
                <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">Platform Owner</span>
              ) : (
                <>
                  <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} data-testid={`staff-role-${u.id}`} className="h-8 rounded-md border border-input bg-background px-2 text-sm capitalize">
                    {roles.filter((r) => r.key !== "platform_owner").map((r) => <option key={r.key} value={r.key}>{r.key.replace("_", " ")}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => remove(u)} className="h-8 text-rose-600"><Trash2 size={15} /></Button>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Roles & permissions" desc="What each role can do (enforced server-side).">
        <div className="space-y-3">
          {roles.map((r) => (
            <div key={r.key} className="rounded-lg border border-border p-3">
              <p className="font-medium capitalize mb-2">{r.key.replace("_", " ")} <span className="text-xs text-muted-foreground">· {r.permissions.length} permissions</span></p>
              <div className="flex flex-wrap gap-1.5">
                {r.permissions.slice(0, 24).map((p) => <span key={p} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{p}</span>)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="staff-dialog">
          <DialogHeader><DialogTitle>Add platform user</DialogTitle><DialogDescription>They can sign in with these credentials and their role's permissions.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} data-testid="staff-name" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} data-testid="staff-email" /></div>
            <div className="space-y-1.5"><Label>Temporary password</Label><Input value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} data-testid="staff-password" /></div>
            <div className="space-y-1.5"><Label>Role</Label>
              <select value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} data-testid="staff-role" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm capitalize">
                {["platform_admin", "developer", "support", "viewer"].map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={add} disabled={saving} className="bg-primary text-primary-foreground border-0" data-testid="save-staff">{saving ? "Adding…" : "Add user"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Plans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", price: 0, features: "", editId: null });
  const load = useCallback(async () => { setLoading(true); try { const { data } = await api.get("/platform/plans"); setPlans(data.plans || []); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    const body = { name: form.name, price: Number(form.price) || 0, features: form.features.split(",").map((x) => x.trim()).filter(Boolean), limits: {} };
    try { if (form.editId) await api.patch(`/platform/plans/${form.editId}`, body); else await api.post("/platform/plans", body); toast.success("Saved"); setOpen(false); await load(); }
    catch { toast.error("Save failed"); }
  };
  const remove = async (p) => { if (!window.confirm(`Delete plan ${p.name}?`)) return; try { await api.delete(`/platform/plans/${p.id}`); toast.success("Deleted"); await load(); } catch { toast.error("Failed"); } };
  if (loading) return <LoadingState />;
  return (
    <Card title="Plans" desc="Subscription tiers offered to clients.">
      <div className="flex justify-end mb-3"><Button size="sm" onClick={() => { setForm({ name: "", price: 0, features: "", editId: null }); setOpen(true); }} data-testid="add-plan-btn" className="bg-primary text-primary-foreground border-0"><Plus size={15} className="mr-1" /> Add plan</Button></div>
      <div className="grid sm:grid-cols-3 gap-3" data-testid="plans-grid">
        {plans.map((p) => (
          <div key={p.id} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between"><p className="font-display font-semibold">{p.name}</p><Button size="sm" variant="ghost" onClick={() => remove(p)} className="h-7 w-7 p-0 text-rose-600"><Trash2 size={14} /></Button></div>
            <p className="text-2xl font-display font-bold mt-1">${p.price}<span className="text-xs text-muted-foreground font-normal">/mo</span></p>
            <ul className="mt-2 space-y-1">{(p.features || []).map((f) => <li key={f} className="text-xs text-muted-foreground">• {f}</li>)}</ul>
            <Button size="sm" variant="ghost" className="mt-2 h-7 px-2" onClick={() => { setForm({ name: p.name, price: p.price, features: (p.features || []).join(", "), editId: p.id }); setOpen(true); }}>Edit</Button>
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.editId ? "Edit plan" : "New plan"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} data-testid="plan-name" /></div>
            <div className="space-y-1.5"><Label>Price (USD/mo)</Label><Input type="number" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Features (comma-separated)</Label><Input value={form.features} onChange={(e) => setForm((p) => ({ ...p, features: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} className="bg-primary text-primary-foreground border-0" data-testid="save-plan">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SecurityAudit() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get("/platform/audit").then(({ data }) => setEntries(data.entries || [])).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <LoadingState />;
  return (
    <Card title="Audit log" desc="Every sensitive action is recorded.">
      {entries.length === 0 ? <p className="text-sm text-muted-foreground">No audited actions yet.</p> : (
        <div className="space-y-2" data-testid="audit-list">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
              <div className="min-w-0"><span className="font-medium">{e.user_name}</span> <span className="text-muted-foreground">· {e.action} · {e.resource}</span>{e.ip && <span className="text-xs text-muted-foreground"> · {e.ip}</span>}</div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{fmt(e.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

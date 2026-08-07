import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Buildings, Plus, PencilSimple, Trash, Key, ArrowClockwise, SignOut,
  Sun, Moon, UsersThree, Student, CheckCircle, Prohibit, Link as LinkIcon, Sparkle,
} from "@phosphor-icons/react";

const emptyForm = () => ({
  name: "",
  admin_email: "",
  admin_password: "",
  admin_name: "Administrator",
  status: "active",
  brand_color: DEFAULT_BRANDING.brand_color,
  logo_url: "",
  app_name: "",
  app_short: "",
  company_line: DEFAULT_BRANDING.company_line,
  hero_title: DEFAULT_BRANDING.hero_title,
  hero_accent: DEFAULT_BRANDING.hero_accent,
  hero_tagline: DEFAULT_BRANDING.hero_tagline,
  eyebrow: DEFAULT_BRANDING.eyebrow,
  currency: "INR",
  enabled_modules: [],
});

function StatCard({ icon: Icon, label, value, tint }) {
  return (
    <div className="card-premium p-5 flex items-center gap-4" data-testid={`stat-${label}`}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${tint}`}>
        <Icon size={22} weight="duotone" />
      </div>
      <div>
        <p className="text-2xl font-display font-semibold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  );
}

export default function PlatformConsole() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();

  const [tenants, setTenants] = useState([]);
  const [summary, setSummary] = useState({ companies: 0, active: 0, suspended: 0, total_users: 0 });
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // tenant id or null (create)
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, s, m] = await Promise.all([
        api.get("/platform/tenants"),
        api.get("/platform/summary"),
        api.get("/platform/modules"),
      ]);
      setTenants(t.data.tenants || []);
      setSummary(s.data || {});
      setModules(m.data.modules || []);
    } catch (e) {
      toast.error("Failed to load companies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const lockedKeys = useMemo(() => modules.filter((m) => m.locked).map((m) => m.key), [modules]);

  const openCreate = () => {
    const f = emptyForm();
    f.enabled_modules = modules.map((m) => m.key); // all on by default
    setForm(f);
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (t) => {
    const b = t.branding || {};
    setForm({
      ...emptyForm(),
      name: t.name,
      admin_email: t.admin_email || "",
      admin_password: "",
      status: t.status || "active",
      brand_color: b.brand_color || DEFAULT_BRANDING.brand_color,
      logo_url: b.logo_url || "",
      app_name: b.app_name || t.name,
      app_short: b.app_short || "",
      company_line: b.company_line || "",
      hero_title: b.hero_title || "",
      hero_accent: b.hero_accent || "",
      hero_tagline: b.hero_tagline || "",
      eyebrow: b.eyebrow || "",
      currency: b.currency || "INR",
      enabled_modules: t.enabled_modules || [],
    });
    setEditing(t.id);
    setOpen(true);
  };

  const setF = (k) => (e) => setForm((prev) => ({ ...prev, [k]: e?.target ? e.target.value : e }));

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) { toast.error("Logo must be under 500 KB"); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((p) => ({ ...p, logo_url: reader.result }));
    reader.readAsDataURL(file);
  };

  const toggleModule = (key) => {
    if (lockedKeys.includes(key)) return;
    setForm((p) => {
      const has = p.enabled_modules.includes(key);
      return { ...p, enabled_modules: has ? p.enabled_modules.filter((k) => k !== key) : [...p.enabled_modules, key] };
    });
  };

  const branding = () => ({
    app_name: form.app_name || form.name,
    app_short: form.app_short,
    company_line: form.company_line,
    logo_url: form.logo_url,
    brand_color: form.brand_color,
    hero_title: form.hero_title,
    hero_accent: form.hero_accent,
    hero_tagline: form.hero_tagline,
    eyebrow: form.eyebrow,
    currency: form.currency,
  });

  const save = async () => {
    if (!form.name.trim()) { toast.error("Company name is required"); return; }
    if (!editing && (!form.admin_email || form.admin_password.length < 6)) {
      toast.error("Admin email and a password (6+ chars) are required");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/platform/tenants/${editing}`, {
          name: form.name,
          status: form.status,
          branding: branding(),
          enabled_modules: form.enabled_modules,
        });
        toast.success("Company updated");
      } else {
        await api.post("/platform/tenants", {
          name: form.name,
          admin_email: form.admin_email,
          admin_password: form.admin_password,
          admin_name: form.admin_name || "Administrator",
          branding: branding(),
          enabled_modules: form.enabled_modules,
        });
        toast.success("Company created");
      }
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (t) => {
    const status = t.status === "suspended" ? "active" : "suspended";
    try {
      await api.patch(`/platform/tenants/${t.id}`, { status });
      toast.success(status === "active" ? "Company activated" : "Company suspended");
      await load();
    } catch { toast.error("Failed to update status"); }
  };

  const resetAdmin = async (t) => {
    const pw = window.prompt(`Set a new password for ${t.admin_email}`);
    if (!pw) return;
    if (pw.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    try {
      await api.post(`/platform/tenants/${t.id}/reset-admin`, { admin_password: pw });
      toast.success("Admin password reset");
    } catch (e) { toast.error(e?.response?.data?.detail || "Reset failed"); }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"? This permanently removes the company and ALL its data.`)) return;
    try {
      await api.delete(`/platform/tenants/${t.id}`);
      toast.success("Company deleted");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const copyLogin = () => {
    const url = `${window.location.origin}/login`;
    navigator.clipboard?.writeText(url);
    toast.success("Login URL copied");
  };

  const doLogout = async () => { await logout(); nav("/login"); };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b border-border">
        <div className="h-16 px-4 md:px-8 max-w-[1400px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-gradient text-white flex items-center justify-center">
              <Buildings size={22} weight="fill" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">Platform Console</p>
              <h1 className="font-display text-lg font-semibold leading-tight">Companies</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyLogin} title="Copy login URL" className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-muted/60 hover:bg-muted text-sm text-muted-foreground">
              <LinkIcon size={15} /> Login link
            </button>
            <button onClick={toggle} className="w-10 h-10 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center" title="Toggle theme">
              {theme === "dark" ? <Sun size={18} weight="fill" className="text-amber-400" /> : <Moon size={18} weight="fill" className="text-orange-600" />}
            </button>
            <div className="hidden md:block text-right mr-1">
              <p className="text-xs font-medium leading-tight">{user?.name}</p>
              <p className="text-[10px] text-muted-foreground">Platform owner</p>
            </div>
            <button onClick={doLogout} title="Sign out" data-testid="platform-logout" className="w-9 h-9 rounded-full bg-muted/60 hover:bg-rose-500/15 hover:text-rose-600 flex items-center justify-center">
              <SignOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 space-y-8">
        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Buildings} label="Companies" value={summary.companies || 0} tint="bg-orange-500/10 text-orange-600" />
          <StatCard icon={CheckCircle} label="Active" value={summary.active || 0} tint="bg-emerald-500/10 text-emerald-600" />
          <StatCard icon={Prohibit} label="Suspended" value={summary.suspended || 0} tint="bg-rose-500/10 text-rose-600" />
          <StatCard icon={UsersThree} label="Total users" value={summary.total_users || 0} tint="bg-blue-500/10 text-blue-600" />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold">Your companies</h2>
            <p className="text-sm text-muted-foreground">Create and white-label a workspace for each customer.</p>
          </div>
          <Button onClick={openCreate} data-testid="new-company-btn" className="btn-amber border-0">
            <Plus size={16} weight="bold" className="mr-1.5" /> New company
          </Button>
        </div>

        {/* Company grid */}
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : tenants.length === 0 ? (
          <div className="card-premium p-10 text-center text-muted-foreground">No companies yet. Create your first one.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="company-grid">
            {tenants.map((t) => (
              <div key={t.id} className="card-premium p-5 flex flex-col gap-4" data-testid={`company-${t.slug}`}>
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-display font-bold text-lg overflow-hidden shrink-0"
                       style={{ background: t.branding?.logo_url ? "#fff" : t.branding?.brand_color || "#C70000" }}>
                    {t.branding?.logo_url
                      ? <img src={t.branding.logo_url} alt={t.name} className="w-full h-full object-contain p-1" />
                      : (t.name || "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-semibold truncate">{t.name}</h3>
                      {t.is_default && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{t.admin_email}</p>
                  </div>
                  <Badge className={t.status === "active" ? "bg-emerald-500/15 text-emerald-600 border-0" : "bg-rose-500/15 text-rose-600 border-0"}>
                    {t.status}
                  </Badge>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><UsersThree size={14} /> {t.stats?.users ?? 0} users</span>
                  <span className="inline-flex items-center gap-1"><Student size={14} /> {t.stats?.students ?? 0} students</span>
                  <span className="inline-flex items-center gap-1"><Sparkle size={14} /> {t.enabled_modules?.length ?? 0} modules</span>
                  <span className="w-4 h-4 rounded-full border border-border" title={t.branding?.brand_color} style={{ background: t.branding?.brand_color }} />
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t border-border/60 mt-auto flex-wrap">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(t)} data-testid={`edit-${t.slug}`} className="h-8"><PencilSimple size={15} className="mr-1" /> Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => resetAdmin(t)} className="h-8"><Key size={15} className="mr-1" /> Reset</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleStatus(t)} className="h-8">
                    {t.status === "active" ? <><Prohibit size={15} className="mr-1" /> Suspend</> : <><ArrowClockwise size={15} className="mr-1" /> Activate</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(t)} className="h-8 text-rose-600 hover:text-rose-700"><Trash size={15} className="mr-1" /> Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="company-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit company" : "New company"}</DialogTitle>
            <DialogDescription>{editing ? "Update branding, modules and status." : "Provision an isolated, white-labeled workspace."}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Company name</Label>
                <Input value={form.name} onChange={setF("name")} placeholder="Acme Academy" data-testid="company-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Default currency</Label>
                <select value={form.currency} onChange={setF("currency")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
            </div>

            {!editing && (
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Admin name</Label>
                  <Input value={form.admin_name} onChange={setF("admin_name")} data-testid="admin-name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Admin email</Label>
                  <Input type="email" value={form.admin_email} onChange={setF("admin_email")} placeholder="admin@acme.com" data-testid="admin-email" />
                </div>
                <div className="space-y-1.5">
                  <Label>Admin password</Label>
                  <Input type="text" value={form.admin_password} onChange={setF("admin_password")} placeholder="min 6 chars" data-testid="admin-password" />
                </div>
              </div>
            )}

            {editing && (
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Suspended companies cannot sign in.</p>
                </div>
                <Switch checked={form.status === "active"} onCheckedChange={(v) => setForm((p) => ({ ...p, status: v ? "active" : "suspended" }))} />
              </div>
            )}

            {/* Branding */}
            <div className="space-y-4 rounded-xl border border-border p-4">
              <p className="text-sm font-semibold flex items-center gap-2"><Sparkle size={16} weight="fill" className="text-orange-600" /> Branding</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>App name (shown in UI)</Label>
                  <Input value={form.app_name} onChange={setF("app_name")} placeholder={form.name || "Acme Academy"} data-testid="brand-app-name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Short name</Label>
                  <Input value={form.app_short} onChange={setF("app_short")} placeholder="Acme" />
                </div>
              </div>
              <div className="grid sm:grid-cols-[auto,1fr] gap-4 items-end">
                <div className="space-y-1.5">
                  <Label>Brand color</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.brand_color} onChange={setF("brand_color")} className="h-10 w-14 rounded-md border border-input bg-background cursor-pointer" data-testid="brand-color" />
                    <Input value={form.brand_color} onChange={setF("brand_color")} className="w-28" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Logo (PNG/SVG, under 500KB)</Label>
                  <div className="flex items-center gap-3">
                    <input type="file" accept="image/*" onChange={onLogo} className="text-sm" data-testid="brand-logo" />
                    {form.logo_url && (
                      <div className="flex items-center gap-2">
                        <img src={form.logo_url} alt="logo" className="w-9 h-9 object-contain rounded border border-border bg-card" />
                        <button type="button" onClick={() => setForm((p) => ({ ...p, logo_url: "" }))} className="text-xs text-rose-600">Remove</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Tagline / company line</Label>
                <Input value={form.company_line} onChange={setF("company_line")} placeholder="Admissions & Finance Suite" />
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Advanced (login hero copy)</summary>
                <div className="mt-3 space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Hero title</Label><Input value={form.hero_title} onChange={setF("hero_title")} /></div>
                    <div className="space-y-1.5"><Label>Hero accent</Label><Input value={form.hero_accent} onChange={setF("hero_accent")} /></div>
                  </div>
                  <div className="space-y-1.5"><Label>Eyebrow</Label><Input value={form.eyebrow} onChange={setF("eyebrow")} /></div>
                  <div className="space-y-1.5"><Label>Hero tagline</Label><Textarea value={form.hero_tagline} onChange={setF("hero_tagline")} rows={2} /></div>
                </div>
              </details>
            </div>

            {/* Modules */}
            <div className="space-y-3 rounded-xl border border-border p-4">
              <p className="text-sm font-semibold">Enabled modules</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {modules.map((m) => {
                  const checked = form.enabled_modules.includes(m.key) || m.locked;
                  return (
                    <label key={m.key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${checked ? "border-orange-500/40 bg-orange-500/5" : "border-border"} ${m.locked ? "opacity-70 cursor-not-allowed" : ""}`}>
                      <input type="checkbox" checked={checked} disabled={m.locked} onChange={() => toggleModule(m.key)} data-testid={`module-${m.key}`} />
                      <span className="truncate">{m.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="btn-amber border-0" data-testid="save-company">
              {saving ? "Saving…" : editing ? "Save changes" : "Create company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding, applyBranding, DEFAULT_BRANDING } from "@/lib/branding";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Palette, FloppyDisk, ArrowCounterClockwise, GraduationCap } from "@phosphor-icons/react";

export default function Branding() {
  const { refresh } = useAuth();
  const { branding, setBrandingData, enabledModules } = useBranding();
  const [form, setForm] = useState({ ...DEFAULT_BRANDING, ...branding });
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.get("/branding/me").then(({ data }) => {
      if (!mounted) return;
      if (data?.branding) setForm({ ...DEFAULT_BRANDING, ...data.branding });
      if (typeof data?.can_edit === "boolean") setCanEdit(data.can_edit);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const setF = (k) => (e) => {
    const v = e?.target ? e.target.value : e;
    setForm((p) => {
      const next = { ...p, [k]: v };
      // Live-preview the brand colour immediately.
      if (k === "brand_color" || k === "logo_url" || k === "app_name") applyBranding(next);
      return next;
    });
  };

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) { toast.error("Logo must be under 500 KB"); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((p) => { const n = { ...p, logo_url: reader.result }; applyBranding(n); return n; });
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch("/branding", {
        app_name: form.app_name,
        app_short: form.app_short,
        company_line: form.company_line,
        brand_color: form.brand_color,
        logo_url: form.logo_url,
        hero_title: form.hero_title,
        hero_accent: form.hero_accent,
        hero_tagline: form.hero_tagline,
        eyebrow: form.eyebrow,
      });
      const merged = data?.branding || form;
      setBrandingData(merged, enabledModules);
      await refresh();
      toast.success("Branding saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const resetPreview = () => { applyBranding(branding); setForm({ ...DEFAULT_BRANDING, ...branding }); };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-gradient text-white flex items-center justify-center">
          <Palette size={22} weight="fill" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold">Customize your workspace</h1>
          <p className="text-sm text-muted-foreground">Set your brand name, logo and colour. Changes apply across the app.</p>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          Only your workspace super admin can change branding.
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Form */}
        <div className="lg:col-span-3 card-premium p-6 space-y-5" data-testid="branding-form">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>App name</Label>
              <Input value={form.app_name || ""} onChange={setF("app_name")} disabled={!canEdit} data-testid="b-app-name" />
            </div>
            <div className="space-y-1.5">
              <Label>Short name</Label>
              <Input value={form.app_short || ""} onChange={setF("app_short")} disabled={!canEdit} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Company line / tagline</Label>
            <Input value={form.company_line || ""} onChange={setF("company_line")} disabled={!canEdit} />
          </div>

          <div className="grid sm:grid-cols-[auto,1fr] gap-4 items-end">
            <div className="space-y-1.5">
              <Label>Brand color</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.brand_color || "#C70000"} onChange={setF("brand_color")} disabled={!canEdit} className="h-10 w-14 rounded-md border border-input bg-background cursor-pointer" data-testid="b-color" />
                <Input value={form.brand_color || ""} onChange={setF("brand_color")} disabled={!canEdit} className="w-28" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Logo (under 500KB)</Label>
              <div className="flex items-center gap-3">
                <input type="file" accept="image/*" onChange={onLogo} disabled={!canEdit} className="text-sm" data-testid="b-logo" />
                {form.logo_url && (
                  <button type="button" onClick={() => setForm((p) => { const n = { ...p, logo_url: "" }; applyBranding(n); return n; })} className="text-xs text-rose-600">Remove</button>
                )}
              </div>
            </div>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Login page hero copy</summary>
            <div className="mt-3 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Hero title</Label><Input value={form.hero_title || ""} onChange={setF("hero_title")} disabled={!canEdit} /></div>
                <div className="space-y-1.5"><Label>Hero accent</Label><Input value={form.hero_accent || ""} onChange={setF("hero_accent")} disabled={!canEdit} /></div>
              </div>
              <div className="space-y-1.5"><Label>Eyebrow</Label><Input value={form.eyebrow || ""} onChange={setF("eyebrow")} disabled={!canEdit} /></div>
              <div className="space-y-1.5"><Label>Hero tagline</Label><Textarea rows={2} value={form.hero_tagline || ""} onChange={setF("hero_tagline")} disabled={!canEdit} /></div>
            </div>
          </details>

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={save} disabled={!canEdit || saving} className="btn-amber border-0" data-testid="b-save">
              <FloppyDisk size={16} className="mr-1.5" /> {saving ? "Saving…" : "Save branding"}
            </Button>
            <Button variant="ghost" onClick={resetPreview}><ArrowCounterClockwise size={16} className="mr-1.5" /> Reset preview</Button>
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card-premium p-5 space-y-4" data-testid="branding-preview">
            <p className="label-eyebrow">Preview</p>
            <div className="flex items-center gap-3">
              <BrandMark size={44} />
              <div>
                <p className="font-display font-semibold">{form.app_name || "EduConnect Pro"}</p>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{form.company_line}</p>
              </div>
            </div>
            <div className="rounded-xl overflow-hidden border border-border">
              <div className="bg-amber-gradient text-white p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest opacity-90"><GraduationCap size={14} weight="fill" /> {form.eyebrow}</div>
                <p className="font-display text-lg font-bold mt-2">{form.hero_title} <span className="italic font-light opacity-90">{form.hero_accent}</span></p>
              </div>
              <div className="p-4 space-y-3 bg-card">
                <button className="w-full h-10 rounded-lg btn-amber border-0 text-sm font-medium">Primary button</button>
                <div className="flex gap-2">
                  <span className="text-sm text-orange-600 font-medium">Accent link</span>
                  <span className="text-sm text-muted-foreground">Muted text</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

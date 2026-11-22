import React, { useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthedObjectUrl } from "@/components/AuthedImage";
import { Label } from "@/components/ui/label";
import { Check, Image as ImageIcon, UploadSimple, Trash } from "@phosphor-icons/react";

const OPTIONS = [
  { key: "plain", label: "Plain", hint: "Solid app colour", swatch: "bg-background" },
  { key: "gradient", label: "Gradient", hint: "Soft brand tint", swatch: "app-glass-bg" },
  { key: "photo", label: "Photo", hint: "Your own image", swatch: "" },
];

function Swatch({ opt, photo }) {
  if (opt.key === "photo") {
    return photo
      ? <img src={photo} alt="" className="w-full h-full object-cover" />
      : <span className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground"><ImageIcon size={22} /></span>;
  }
  return (
    <span className={`relative w-full h-full block ${opt.swatch}`}>
      <span className="glass-panel absolute left-2 top-2 bottom-2 w-6 rounded-lg" />
    </span>
  );
}

export default function BackgroundPicker({ mode, url, disabled, onChange }) {
  const [busy, setBusy] = useState(false);
  const photo = useAuthedObjectUrl(url);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Photo must be 2MB or smaller"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/uploads/image", fd);
      onChange({ app_background: "photo", app_background_url: data.url });
      toast.success("Photo uploaded — save branding to apply");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="bg-picker">
      <Label>App background</Label>
      <p className="text-xs text-muted-foreground -mt-1">Shown behind the glass sidebar on every page.</p>
      <div className="grid grid-cols-3 gap-3">
        {OPTIONS.map((opt) => {
          const active = mode === opt.key;
          return (
            <button key={opt.key} type="button" disabled={disabled} onClick={() => onChange({ app_background: opt.key })}
              data-testid={`bg-option-${opt.key}`} aria-pressed={active}
              className={`text-left rounded-2xl border p-1.5 transition-[border-color,box-shadow] disabled:opacity-60 ${active ? "border-[hsl(var(--primary))] ring-4 ring-[hsl(var(--primary))]/10" : "border-border hover:border-foreground/30"}`}>
              <span className="block h-16 rounded-xl overflow-hidden border border-border/60"><Swatch opt={opt} photo={photo} /></span>
              <span className="flex items-center justify-between px-1.5 pt-2 pb-0.5">
                <span>
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{opt.hint}</span>
                </span>
                {active && <Check size={15} weight="bold" className="text-[hsl(var(--primary))]" />}
              </span>
            </button>
          );
        })}
      </div>
      {mode === "photo" && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm cursor-pointer hover:bg-muted ${disabled || busy ? "pointer-events-none opacity-60" : ""}`} data-testid="bg-photo-upload-label">
            <UploadSimple size={15} /> {busy ? "Uploading…" : url ? "Replace photo" : "Upload photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={upload} data-testid="bg-photo-input" />
          </label>
          {url && (
            <button type="button" disabled={disabled} onClick={() => onChange({ app_background: "gradient", app_background_url: "" })}
              className="inline-flex items-center gap-1 text-xs text-rose-600" data-testid="bg-photo-remove">
              <Trash size={13} /> Remove photo
            </button>
          )}
          {!url && <span className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 2MB. Until a photo is added, the gradient is shown.</span>}
        </div>
      )}
    </div>
  );
}

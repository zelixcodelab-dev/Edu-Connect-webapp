import React, { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import AuthedImage from "@/components/AuthedImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Buildings, Camera } from "@phosphor-icons/react";
import { toast } from "sonner";

// Single company profile used on every payslip. Admin-editable.
export default function CompanyProfileDialog({ open, onOpenChange }) {
  const [form, setForm] = useState({ legal_name: "", address: "", logo_url: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const logoRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get("/attendance/company-profile")
      .then(({ data }) => setForm({ legal_name: data.legal_name || "", address: data.address || "", logo_url: data.logo_url || "" }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/uploads/image", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, logo_url: data.url }));
      toast.success("Logo uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (logoRef.current) logoRef.current.value = "";
    }
  };

  const save = async () => {
    if (!form.legal_name.trim()) { toast.error("Company name is required"); return; }
    setSaving(true);
    try {
      await api.put("/attendance/company-profile", form);
      toast.success("Company profile saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-lg" data-testid="company-profile-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><Buildings size={18} /> Company profile</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Shown as the header on every employee payslip.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-lg bg-muted overflow-hidden flex items-center justify-center shrink-0 border border-border">
                {form.logo_url ? (
                  <AuthedImage url={form.logo_url} alt="logo" className="w-full h-full object-contain" testid="company-logo-preview" />
                ) : (
                  <Buildings size={30} className="text-muted-foreground" weight="thin" />
                )}
              </div>
              <div>
                <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadLogo} className="hidden" data-testid="company-logo-input" />
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => logoRef.current?.click()} data-testid="company-logo-btn">
                  <Camera size={14} className="mr-1.5" /> {uploading ? "Uploading…" : (form.logo_url ? "Change logo" : "Upload logo")}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-1">Optional · PNG or JPG</p>
              </div>
            </div>
            <div>
              <Label>Legal name *</Label>
              <Input value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} data-testid="company-name-input" />
            </div>
            <div>
              <Label>Address</Label>
              <Textarea rows={3} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="company-address-input" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
              <Button className="btn-amber border-0" onClick={save} disabled={saving} data-testid="company-save-btn">
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

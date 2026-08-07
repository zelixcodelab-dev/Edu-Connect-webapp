import React, { useEffect, useRef, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { photoSrc } from "@/pages/Clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Camera, UserCircle, IdentificationBadge, EnvelopeSimple, Phone, LockSimple } from "@phosphor-icons/react";
import { toast } from "sonner";

const empty = { name: "", date_of_birth: "", address: "", place: "", photo_url: "" };

function ReadOnlyField({ icon: Icon, label, value, testid }) {
  return (
    <div>
      <Label className="flex items-center gap-1.5 text-muted-foreground">
        {label} <LockSimple size={12} className="opacity-70" />
      </Label>
      <div className="mt-1.5 flex items-center gap-2 h-10 px-3 rounded-md border border-border bg-muted/40 text-sm text-foreground" data-testid={testid}>
        <Icon size={15} className="text-muted-foreground shrink-0" />
        <span className="truncate">{value || "—"}</span>
      </div>
    </div>
  );
}

export default function StaffProfile() {
  const { refresh } = useAuth();
  const [form, setForm] = useState(empty);
  const [readonly, setReadonly] = useState({ email: "", phone: "", employee_id: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const photoInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/staff/me/profile");
      setForm({
        name: data.name || "", date_of_birth: data.date_of_birth || "",
        address: data.address || "", place: data.place || "", photo_url: data.photo_url || "",
      });
      setReadonly({ email: data.email || "", phone: data.phone || "", employee_id: data.employee_id || "" });
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not load profile");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/uploads/image", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, photo_url: data.url }));
      toast.success("Photo uploaded — save to apply");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Upload failed");
    } finally {
      setUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      await api.patch("/staff/me/profile", {
        name: form.name.trim(),
        date_of_birth: form.date_of_birth || null,
        address: form.address.trim(),
        place: form.place.trim(),
        photo_url: form.photo_url || "",
      });
      toast.success("Profile saved");
      await refresh?.();
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not save");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl" data-testid="staff-profile-page">
      <header>
        <p className="label-eyebrow">My account</p>
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Keep your details up to date.</p>
      </header>

      <Card className="p-6 border border-border bg-card rounded-lg shadow-none">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            {/* Photo */}
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0 border border-border">
                {form.photo_url ? (
                  <img src={photoSrc(form.photo_url)} alt="profile" className="w-full h-full object-cover" data-testid="profile-photo-preview" />
                ) : (
                  <UserCircle size={46} className="text-muted-foreground" weight="thin" />
                )}
              </div>
              <div>
                <input ref={photoInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif" onChange={uploadPhoto} className="hidden" data-testid="profile-photo-input" />
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => photoInputRef.current?.click()} data-testid="profile-photo-btn">
                  <Camera size={14} className="mr-1.5" /> {uploading ? "Uploading…" : (form.photo_url ? "Change photo" : "Upload photo")}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-1">JPG, PNG, WebP or GIF · up to 2MB</p>
              </div>
            </div>

            {/* Editable */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Name *</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" data-testid="profile-name" />
              </div>
              <div>
                <Label>Date of birth</Label>
                <Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} className="mt-1.5" data-testid="profile-dob" />
              </div>
            </div>

            {/* Read-only */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <ReadOnlyField icon={IdentificationBadge} label="Employee ID" value={readonly.employee_id} testid="profile-employee-id" />
              <ReadOnlyField icon={EnvelopeSimple} label="Email" value={readonly.email} testid="profile-email" />
              <ReadOnlyField icon={Phone} label="Phone number" value={readonly.phone} testid="profile-phone" />
            </div>

            {/* Editable */}
            <div>
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Residential address" className="mt-1.5" data-testid="profile-address" />
            </div>
            <div>
              <Label>Place</Label>
              <Input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="e.g. Bangalore" className="mt-1.5" data-testid="profile-place" />
            </div>

            <div className="pt-1">
              <Button type="submit" disabled={saving} className="btn-amber border-0" data-testid="profile-save">{saving ? "Saving…" : "Save profile"}</Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

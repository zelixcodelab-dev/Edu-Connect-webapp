import React, { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import StaffProfile from "@/pages/StaffProfile";
import AdmissionRevenuePinSettings from "@/components/settings/AdmissionRevenuePinSettings";

export default function Settings() {
  const { user, updateProfile } = useAuth();
  if (user?.role === "staff") return <StaffProfile />;
  return <WorkspaceSettings user={user} updateProfile={updateProfile} />;
}

function WorkspaceSettings({ user, updateProfile }) {
  const [form, setForm] = useState({
    name: user?.name || "",
    business_name: user?.business_name || "",
    currency: user?.currency || "USD",
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl" data-testid="settings-page">
      <header>
        <p className="label-eyebrow">Preferences</p>
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Settings</h1>
      </header>

      <Card className="p-6 border border-border bg-card rounded-lg shadow-none">
        <form onSubmit={submit} className="space-y-5">
          <div>
            <Label>Your name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="settings-name" />
          </div>
          <div>
            <Label>Business name</Label>
            <Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} data-testid="settings-business" />
          </div>
          <div>
            <Label>Currency</Label>
            <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
              <SelectTrigger data-testid="settings-currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD — US Dollar ($)</SelectItem>
                <SelectItem value="INR">INR — Indian Rupee (₹)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Email</Label>
            <Input value={user?.email || ""} disabled />
            <p className="text-xs text-muted-foreground mt-1">Email cannot be changed.</p>
          </div>
          <Button type="submit" disabled={saving} className="btn-amber border-0 lift" data-testid="settings-save">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Card>

      {user?.role === "super_admin" && (
        <AdmissionRevenuePinSettings userEmail={user?.email} />
      )}
    </div>
  );
}

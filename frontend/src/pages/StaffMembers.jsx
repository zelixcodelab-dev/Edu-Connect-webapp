import React, { useCallback, useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, IdentificationBadge, Eye, EyeSlash, Key, Trash, EnvelopeSimple } from "@phosphor-icons/react";

const OFFICES = [
  { value: "KM_BLR", label: "KM Bengaluru (BLR)" },
  { value: "KM_TCR", label: "KM Thrissur (TCR)" },
  { value: "KM_KMLY", label: "KM Kumily (KMLY)" },
];

const emptyForm = { name: "", email: "", password: "", office: "" };

export default function StaffMembers() {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  const [resetFor, setResetFor] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [deleteFor, setDeleteFor] = useState(null);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/users/staff");
      setStaff(data);
    } catch (err) {
      console.error("[staff] fetch failed:", err);
      toast.error("Could not load staff");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  const openCreate = () => {
    setForm({ ...emptyForm, office: isSuper ? "" : user?.office || "" });
    setShowPw(false);
    setCreateOpen(true);
  };

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || form.password.length < 6) {
      toast.error("Name, email and a 6+ char password are required");
      return;
    }
    if (isSuper && !form.office) { toast.error("Pick an office"); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), email: form.email.trim(), password: form.password, role: "staff" };
      if (isSuper) payload.office = form.office;
      await api.post("/users", payload);
      toast.success("Staff account created");
      setCreateOpen(false);
      fetchStaff();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not create staff");
    } finally { setSaving(false); }
  };

  const doReset = async () => {
    if (newPw.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    try {
      await api.post(`/users/${resetFor.id}/reset-password`, { new_password: newPw });
      toast.success(`Password reset for ${resetFor.name}`);
      setResetFor(null); setNewPw("");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Reset failed");
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/users/${deleteFor.id}`);
      toast.success("Staff account removed");
      setDeleteFor(null);
      fetchStaff();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Delete failed");
    }
  };

  return (
    <div className="space-y-6" data-testid="staff-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-eyebrow">Team</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">Staff accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Login accounts for telecallers & field staff. They can manage leads and request leave.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="add-staff-btn" className="btn-amber border-0">
          <Plus size={16} className="mr-1.5" /> Add staff
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
      ) : staff.length === 0 ? (
        <Card className="py-16 text-center" data-testid="staff-empty">
          <IdentificationBadge size={40} className="mx-auto text-muted-foreground mb-3" weight="duotone" />
          <p className="text-foreground font-medium">No staff accounts yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create a staff login so they can work leads & follow-ups.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="staff-grid">
          {staff.map((s) => (
            <Card key={s.id} className="p-4" data-testid={`staff-card-${s.id}`}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-gradient text-white font-semibold flex items-center justify-center shrink-0">
                  {(s.name || "?").trim().slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><EnvelopeSimple size={12} /> {s.email}</p>
                  {s.office && <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s.office.replace("KM_", "KM ")}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                <Button variant="outline" size="sm" className="h-8 flex-1" onClick={() => { setResetFor(s); setNewPw(""); }} data-testid={`staff-reset-${s.id}`}>
                  <Key size={13} className="mr-1" /> Reset password
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10" onClick={() => setDeleteFor(s)} data-testid={`staff-delete-${s.id}`}>
                  <Trash size={14} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card max-w-md" data-testid="create-staff-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Add staff account</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              They can sign in immediately and start working leads.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Name</Label>
              <Input id="s-name" data-testid="staff-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Staff member name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-email">Email</Label>
              <Input id="s-email" type="email" data-testid="staff-email-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="staff@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-pw">Password</Label>
              <div className="relative">
                <Input id="s-pw" type={showPw ? "text" : "password"} data-testid="staff-password-input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" className="pr-10" />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPw ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {isSuper ? (
              <div className="space-y-1.5">
                <Label>Office</Label>
                <Select value={form.office} onValueChange={(v) => setForm({ ...form, office: v })}>
                  <SelectTrigger data-testid="staff-office-select" className="bg-card"><SelectValue placeholder="Pick the office" /></SelectTrigger>
                  <SelectContent>
                    {OFFICES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Office: <span className="text-foreground font-medium">{(user?.office || "").replace("KM_", "KM ")}</span> (your office)</p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} data-testid="staff-create-submit" className="btn-amber border-0">{saving ? "Creating…" : "Create staff"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetFor} onOpenChange={(v) => { if (!v) { setResetFor(null); setNewPw(""); } }}>
        <DialogContent className="bg-card max-w-sm" data-testid="staff-reset-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Reset password</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">Set a new password for {resetFor?.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-pw">New password</Label>
            <Input id="reset-pw" type="text" data-testid="staff-reset-input" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min 8 characters" />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => { setResetFor(null); setNewPw(""); }}>Cancel</Button>
            <Button type="button" onClick={doReset} data-testid="staff-reset-submit" className="btn-amber border-0">Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={!!deleteFor} onOpenChange={(v) => { if (!v) setDeleteFor(null); }}>
        <AlertDialogContent data-testid="staff-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this staff account?</AlertDialogTitle>
            <AlertDialogDescription>{deleteFor?.name} will no longer be able to sign in. Their leads stay in the system.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-rose-600 hover:bg-rose-700">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

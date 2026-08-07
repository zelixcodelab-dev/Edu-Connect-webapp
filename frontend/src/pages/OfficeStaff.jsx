import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { photoSrc } from "@/pages/Clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Plus, PencilSimple, Trash, Key, Camera, UserCircle, EnvelopeSimple, IdentificationBadge,
  MapPin, Cake, CurrencyInr, Buildings, ShieldWarning, LinkSimple, Phone,
} from "@phosphor-icons/react";
import { toast } from "sonner";

const OFFICES = [
  { value: "KM_BLR", label: "KM BLR" },
  { value: "KM_TCR", label: "KM TCR" },
  { value: "KM_KMLY", label: "KM KMLY" },
];

const emptyForm = {
  name: "", email: "", password: "", photo_url: "", employee_id: "", phone: "",
  date_of_birth: "", place: "", address: "", eligible_incentive: "", office: "",
};

export default function OfficeStaff() {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // row when editing, null when creating
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [loginFor, setLoginFor] = useState(null);
  const [loginCreds, setLoginCreds] = useState({ email: "", password: "" });

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/staff/members");
      setRows(data || []);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not load staff");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/uploads/image", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, photo_url: data.url }));
      toast.success("Photo uploaded");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Upload failed");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm, office: isSuper ? "" : (user?.office || "") }); setOpen(true); };
  const openEdit = (r) => {
    setEditing(r);
    setForm({
      name: r.name || "", email: r.email || "", password: "", photo_url: r.photo_url || "",
      employee_id: r.employee_id || "", phone: r.phone || "", date_of_birth: r.date_of_birth || "", place: r.place || "",
      address: r.address || "", eligible_incentive: r.eligible_incentive ?? "", office: r.office || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (!editing) {
      if (!form.email.trim() || form.password.length < 6) { toast.error("Email and a 6+ char password are required"); return; }
      if (isSuper && !form.office) { toast.error("Pick an office"); return; }
    }
    setSaving(true);
    try {
      const base = {
        name: form.name.trim(),
        photo_url: form.photo_url || null,
        employee_id: form.employee_id.trim() || null,
        phone: form.phone.trim() || null,
        date_of_birth: form.date_of_birth || null,
        place: form.place.trim() || null,
        address: form.address.trim() || null,
        eligible_incentive: form.eligible_incentive === "" ? null : Number(form.eligible_incentive),
      };
      if (editing) {
        await api.patch(`/staff/members/${editing.client_id}`, { ...base, email: form.email.trim() || undefined });
        toast.success("Staff updated");
      } else {
        await api.post("/staff/members", { ...base, email: form.email.trim(), password: form.password, office: isSuper ? form.office : undefined });
        toast.success("Staff member created");
      }
      setOpen(false); load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not save");
    } finally { setSaving(false); }
  };

  const doReset = async () => {
    if (newPw.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    try {
      await api.post(`/users/${resetFor.login_user_id}/reset-password`, { new_password: newPw });
      toast.success(`Password reset for ${resetFor.name}`);
      setResetFor(null); setNewPw("");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Reset failed");
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`Remove ${r.name}? This deletes their profile and login.`)) return;
    try {
      if (r.client_id) await api.delete(`/staff/members/${r.client_id}`);
      else if (r.login_user_id) await api.delete(`/users/${r.login_user_id}`);
      toast.success("Staff member removed"); load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Delete failed");
    }
  };

  const createLogin = async () => {
    if (!loginCreds.email.trim() || loginCreds.password.length < 6) { toast.error("Email and a 6+ char password are required"); return; }
    try {
      await api.post(`/staff/members/${loginFor.client_id}/login`, { email: loginCreds.email.trim(), password: loginCreds.password });
      toast.success("Login created"); setLoginFor(null); setLoginCreds({ email: "", password: "" }); load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not create login");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="office-staff-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">People</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Staff</h1>
          <p className="text-sm text-muted-foreground mt-1">Profiles & login accounts in one place.</p>
        </div>
        <Button onClick={openCreate} data-testid="add-staff-btn" className="h-10 btn-amber border-0">
          <Plus size={16} className="mr-1.5" /> Add staff
        </Button>
      </header>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground border border-border shadow-none" data-testid="empty-staff">
          No staff yet. Add your first staff member.
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="staff-grid">
          {rows.map((r) => (
            <Card key={r.client_id || r.login_user_id} className="p-5 border border-border bg-card rounded-lg shadow-none" data-testid={`staff-row-${r.client_id || r.login_user_id}`}>
              <div className="flex items-start justify-between">
                <div
                  className={`flex items-center gap-3 min-w-0 ${r.client_id ? "cursor-pointer" : ""}`}
                  onClick={() => r.client_id && nav(`/clients/${r.client_id}`)}
                  role={r.client_id ? "button" : undefined}
                >
                  <div className="w-12 h-12 rounded-md bg-muted text-foreground flex items-center justify-center font-medium overflow-hidden shrink-0">
                    {r.photo_url ? <img src={photoSrc(r.photo_url)} alt={r.name} className="w-full h-full object-cover" /> : (r.name || "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.name}</p>
                    {r.office && <p className="text-xs text-muted-foreground flex items-center gap-1"><Buildings size={12} /> {r.office.replace("KM_", "KM ")}</p>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {r.client_id && <button onClick={() => openEdit(r)} data-testid={`staff-edit-${r.client_id}`} className="text-muted-foreground hover:text-foreground p-1.5" title="Edit profile"><PencilSimple size={16} /></button>}
                  <button onClick={() => remove(r)} data-testid={`staff-delete-${r.client_id || r.login_user_id}`} className="text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 p-1.5" title="Remove"><Trash size={16} /></button>
                </div>
              </div>

              <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                {r.email && <p className="flex items-center gap-2 truncate"><EnvelopeSimple size={14} /> {r.email}</p>}
                {r.phone && <p className="flex items-center gap-2"><Phone size={14} /> {r.phone}</p>}
                {r.employee_id && <p className="flex items-center gap-2"><IdentificationBadge size={14} /> {r.employee_id}</p>}
                {r.place && <p className="flex items-center gap-2"><MapPin size={14} /> {r.place}</p>}
                {r.date_of_birth && <p className="flex items-center gap-2"><Cake size={14} /> {new Date(r.date_of_birth).toLocaleDateString()}</p>}
                {r.eligible_incentive != null && <p className="flex items-center gap-2"><CurrencyInr size={14} /> ₹{r.eligible_incentive}/admission</p>}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {r.has_login ? (
                  <>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Login active</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setResetFor(r)} data-testid={`staff-reset-${r.login_user_id}`}>
                      <Key size={12} className="mr-1" /> Reset password
                    </Button>
                  </>
                ) : r.client_id ? (
                  <>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center gap-1"><ShieldWarning size={11} /> No login</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setLoginFor(r); setLoginCreds({ email: r.email || "", password: "" }); }} data-testid={`staff-add-login-${r.client_id}`}>
                      <LinkSimple size={12} className="mr-1" /> Create login
                    </Button>
                  </>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Login only · no profile</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card max-h-[90vh] overflow-y-auto" data-testid="staff-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? "Edit staff" : "Add staff"}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {editing ? "Update the profile. Name/email changes sync to their login." : "Creates the profile and a login account together."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0 border border-border">
                {form.photo_url ? <img src={photoSrc(form.photo_url)} alt="staff" className="w-full h-full object-cover" data-testid="staff-photo-preview" /> : <UserCircle size={38} className="text-muted-foreground" weight="thin" />}
              </div>
              <div>
                <input ref={photoInputRef} type="file" accept="image/jpeg,image/jpg" onChange={uploadPhoto} className="hidden" data-testid="staff-photo-input" />
                <Button type="button" variant="outline" size="sm" disabled={uploadingPhoto} onClick={() => photoInputRef.current?.click()} data-testid="staff-photo-btn">
                  <Camera size={14} className="mr-1.5" /> {uploadingPhoto ? "Uploading…" : (form.photo_url ? "Change photo" : "Upload photo")}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-1">JPEG/JPG · up to 5MB</p>
              </div>
            </div>
            <div><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="staff-name" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Email {editing ? "" : "*"}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="staff-email" /></div>
              {!editing && <div><Label>Password *</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" data-testid="staff-password" /></div>}
            </div>
            {isSuper && !editing && (
              <div>
                <Label>Office *</Label>
                <Select value={form.office} onValueChange={(v) => setForm({ ...form, office: v })}>
                  <SelectTrigger data-testid="staff-office"><SelectValue placeholder="Pick office" /></SelectTrigger>
                  <SelectContent>{OFFICES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Employee ID</Label>
                <Input value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder={editing ? "" : "Auto-generated"} data-testid="staff-empid" />
              </div>
              <div><Label>Date of birth</Label><Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} data-testid="staff-dob" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Phone number</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 98xxxxxxx" data-testid="staff-phone" /></div>
              <div><Label>Place</Label><Input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="e.g. Bangalore" data-testid="staff-place" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Incentive (₹/admission)</Label><Input type="number" min="0" step="50" value={form.eligible_incentive} onChange={(e) => setForm({ ...form, eligible_incentive: e.target.value })} placeholder="e.g. 500" data-testid="staff-incentive" /></div>
            </div>
            <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Residential address" data-testid="staff-address" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="btn-amber border-0" data-testid="staff-save">{saving ? "Saving…" : (editing ? "Save" : "Add staff")}</Button>
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
          <div><Label htmlFor="reset-pw">New password</Label><Input id="reset-pw" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min 8 characters" data-testid="staff-new-password" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setResetFor(null); setNewPw(""); }}>Cancel</Button>
            <Button type="button" className="btn-amber border-0" onClick={doReset} data-testid="staff-reset-confirm">Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create login for profile-only */}
      <Dialog open={!!loginFor} onOpenChange={(v) => { if (!v) { setLoginFor(null); setLoginCreds({ email: "", password: "" }); } }}>
        <DialogContent className="bg-card max-w-sm" data-testid="staff-login-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Create login</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">Give {loginFor?.name} a login account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Email</Label><Input type="email" value={loginCreds.email} onChange={(e) => setLoginCreds({ ...loginCreds, email: e.target.value })} data-testid="staff-login-email" /></div>
            <div><Label>Password</Label><Input type="password" value={loginCreds.password} onChange={(e) => setLoginCreds({ ...loginCreds, password: e.target.value })} placeholder="Min 6 characters" data-testid="staff-login-password" /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setLoginFor(null); setLoginCreds({ email: "", password: "" }); }}>Cancel</Button>
            <Button type="button" className="btn-amber border-0" onClick={createLogin} data-testid="staff-login-confirm">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle, UserPlus, Eye, EyeSlash, ShieldCheck } from "@phosphor-icons/react";

const OFFICE_OPTIONS = [
  { value: "KM_BLR", label: "KM BLR" },
  { value: "KM_TCR", label: "KM TCR" },
  { value: "KM_KMLY", label: "KM KMLY" },
];

const emptyNewUser = () => ({
  email: "", password: "", name: "",
  role: "office_admin", office: "KM_BLR", currency: "INR",
  linked_client_id: "",
});

/** Create-user dialog. Self-contained — owns its form state, lazy-loads
 * external clients when role flips to "user", and calls onCreated() with
 * the new user payload so the parent can refresh its roster.
 */
export default function CreateUserDialog({ open, onOpenChange, onCreated }) {
  const [form, setForm] = useState(emptyNewUser);
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [externalClients, setExternalClients] = useState([]);
  const [externalLoaded, setExternalLoaded] = useState(false);
  const [linkedClientSearch, setLinkedClientSearch] = useState("");

  // Reset form whenever the dialog reopens
  useEffect(() => {
    if (open) {
      setForm(emptyNewUser());
      setShowPwd(false);
      setLinkedClientSearch("");
    }
  }, [open]);

  // Lazy-load external clients (sub-agent / associate consultant) the FIRST
  // time role flips to "user". Cached after that.
  useEffect(() => {
    if (form.role !== "user" || externalLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/clients");
        if (cancelled) return;
        const external = (data || []).filter((c) =>
          c.client_type === "sub_agent_associate" || c.client_type === "associate_consultant"
        );
        setExternalClients(external);
        setExternalLoaded(true);
      } catch (err) {
        console.error("[users] failed to load external clients:", err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [form.role, externalLoaded]);

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.email.trim() || !form.password || !form.name.trim()) {
      toast.error("Email, password and name are required"); return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters"); return;
    }
    if (form.role === "office_admin" && !form.office) {
      toast.error("Pick the office for the office admin"); return;
    }
    if (form.role === "user" && !form.linked_client_id) {
      toast.error("Pick the client this user account is linked to"); return;
    }
    setSaving(true);
    try {
      const payload = {
        email: form.email.trim().toLowerCase(),
        password: form.password,
        name: form.name.trim(),
        role: form.role,
        currency: form.currency || "INR",
        ...(form.role === "office_admin" ? { office: form.office } : {}),
        ...(form.role === "user" && form.linked_client_id ? { linked_client_id: form.linked_client_id } : {}),
      };
      const { data } = await api.post("/users", payload);
      toast.success(`${data.name} created · can sign in immediately`);
      onOpenChange(false);
      onCreated?.(data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="create-user-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <UserPlus size={18} weight="duotone" className="text-orange-600 dark:text-orange-400" />
            Create user
          </DialogTitle>
          <DialogDescription>
            Add a user directly — they'll be approved immediately and can sign in with the password you set.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Full name <span className="text-rose-600">*</span></Label>
            {form.role === "user" ? (
              <>
                <Select
                  value={form.linked_client_id || ""}
                  onValueChange={(id) => {
                    const c = externalClients.find((x) => x.id === id);
                    setForm((f) => ({
                      ...f,
                      linked_client_id: id,
                      name: c?.name || f.name,
                      email: c?.email || f.email,
                    }));
                  }}
                >
                  <SelectTrigger data-testid="cu-linked-client" className="w-full">
                    <SelectValue placeholder={externalLoaded ? "Select a sub-agent / consultant…" : "Loading clients…"} />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="px-2 pt-1 pb-2">
                      <Input
                        value={linkedClientSearch}
                        onChange={(e) => setLinkedClientSearch(e.target.value)}
                        placeholder="Search by name"
                        className="h-8 text-sm"
                        data-testid="cu-linked-client-search"
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                    {externalClients
                      .filter((c) => !linkedClientSearch || c.name.toLowerCase().includes(linkedClientSearch.toLowerCase()))
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id} data-testid={`cu-linked-client-opt-${c.id}`}>
                          <div className="flex flex-col">
                            <span>{c.name}</span>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {c.client_type === "sub_agent_associate" ? "Sub-agent" : "Associate consultant"}
                              {c.email ? ` · ${c.email}` : ""}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    {externalLoaded && externalClients.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        No sub-agents or associate consultants yet. Add one from the Clients page first.
                      </div>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Pick the client whose dashboard this login should be tied to. They will see only students that reference them and their SC earned (read-only).
                </p>
              </>
            ) : (
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Jane Doe"
                data-testid="cu-name"
                required
              />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Email <span className="text-rose-600">*</span></Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="user@company.com"
                data-testid="cu-email"
                required
              />
            </div>
            <div>
              <Label>Password <span className="text-rose-600">*</span></Label>
              <div className="relative">
                <Input
                  type={showPwd ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Min 6 characters"
                  data-testid="cu-password"
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  data-testid="cu-toggle-pwd"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                  title={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Share this password with the user securely.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Role <span className="text-rose-600">*</span></Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger data-testid="cu-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="office_admin">Office Admin</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="user">User (personal finance)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.role === "office_admin" ? (
              <div>
                <Label>Office <span className="text-rose-600">*</span></Label>
                <Select value={form.office} onValueChange={(v) => setForm({ ...form, office: v })}>
                  <SelectTrigger data-testid="cu-office"><SelectValue placeholder="Pick office" /></SelectTrigger>
                  <SelectContent>
                    {OFFICE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger data-testid="cu-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR (₹)</SelectItem>
                    <SelectItem value="USD">USD ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {form.role === "super_admin" ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-gradient-soft p-3 text-xs flex items-start gap-2.5" data-testid="cu-super-warning">
              <ShieldCheck size={16} weight="fill" className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
              <span className="text-foreground">
                <strong>Super Admin</strong> gets full access to every page across all offices and can manage other users. Use sparingly.
              </span>
            </div>
          ) : (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/10 p-3 text-xs flex items-start gap-2.5">
              <CheckCircle size={16} weight="fill" className="text-emerald-700 dark:text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-foreground">
                Office admins are created with <strong>all 8 pages set to edit</strong>. Fine-tune via the Permissions button on their card after creation.
              </span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="btn-amber border-0" data-testid="cu-save">
              <UserPlus size={14} className="mr-1.5" />
              {saving ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

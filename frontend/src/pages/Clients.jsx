import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { API, getStoredToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canEdit } from "@/lib/perm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, PencilSimple, Trash, EnvelopeSimple, Phone, Buildings, Cake, CurrencyInr, IdentificationBadge, MapPin, Camera, UserCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import OfficeStaff from "@/pages/OfficeStaff";

export const CLIENT_TYPES = [
  { value: "staff", label: "Our Staff" },
  { value: "sub_agent_associate", label: "Sub Agent / Associate" },
  { value: "associate_consultant", label: "Associate Consultant" },
  { value: "km_blr_office", label: "KM BLR Office" },
  { value: "km_tcr_office", label: "KM TCR Office" },
  { value: "km_kmly_office", label: "KM KMLY Office" },
];

// Page scoping: "Employees" shows staff + KM offices; "Clients" shows the
// routing partners (sub-agents / associate consultants).
export const EMPLOYEE_PAGE_TYPES = ["staff", "km_blr_office", "km_tcr_office", "km_kmly_office"];
export const CLIENT_PAGE_TYPES = ["sub_agent_associate", "associate_consultant"];

const OFFICES = [
  { value: "KM_BLR", label: "KM BLR" },
  { value: "KM_TCR", label: "KM TCR" },
  { value: "KM_KMLY", label: "KM KMLY" },
];

export function clientTypeLabel(v) {
  return CLIENT_TYPES.find((t) => t.value === v)?.label || "—";
}

export function photoSrc(u) {
  return u ? `${API}${u.replace(/^\/api/, "")}?auth=${getStoredToken() || ""}` : null;
}

const TYPE_BADGE = {
  staff: "bg-orange-100/60 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400",
  sub_agent_associate: "bg-violet-100/60 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400",
  associate_consultant: "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400",
  km_blr_office: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  km_tcr_office: "bg-sky-100/60 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400",
  km_kmly_office: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const empty = {
  name: "", client_type: "sub_agent_associate", email: "", phone: "", company: "",
  office: "", eligible_incentive: "", date_of_birth: "",
  employee_id: "", address: "", place: "", photo_url: "",
  home_office: "",
};

const HOME_OFFICE_OPTIONS = [
  { value: "KM_BLR", label: "KM BLR" },
  { value: "KM_TCR", label: "KM TCR" },
  { value: "KM_KMLY", label: "KM KMLY" },
  { value: "ALL", label: "Shared (all offices)" },
];

// Dispatcher: office admins get the unified staff page; super admins get the
// scoped People page (Employees vs Clients) driven by the route's pageScope.
export default function Clients({ pageScope = "clients" }) {
  const { user } = useAuth();
  if (user?.role === "office_admin") return <OfficeStaff />;
  return <SuperAdminPeople pageScope={pageScope} />;
}

function SuperAdminPeople({ pageScope }) {
  const { user } = useAuth();
  const isEmployees = pageScope === "employees";
  const scopeTypes = useMemo(
    () => (isEmployees ? EMPLOYEE_PAGE_TYPES : CLIENT_PAGE_TYPES),
    [isEmployees]
  );
  const defaultType = isEmployees ? "staff" : "sub_agent_associate";
  const allowEdit = canEdit(user, "clients");
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty, client_type: defaultType });
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = async () => { setList((await api.get("/clients")).data); };
  useEffect(() => { load(); }, []);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);

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
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Upload failed");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const visibleTypes = useMemo(
    () => CLIENT_TYPES.filter((t) => scopeTypes.includes(t.value)),
    [scopeTypes]
  );

  const filtered = useMemo(() => {
    let l = list.filter((c) => scopeTypes.includes(c.client_type));
    if (filter !== "all") l = l.filter((c) => c.client_type === filter);
    return l;
  }, [list, filter, scopeTypes]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...empty, client_type: defaultType });
    setOpen(true);
  };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name,
      client_type: c.client_type || defaultType,
      email: c.email || "",
      phone: c.phone || "",
      company: c.company || "",
      office: c.office || "",
      eligible_incentive: c.eligible_incentive ?? "",
      date_of_birth: c.date_of_birth || "",
      employee_id: c.employee_id || "",
      address: c.address || "",
      place: c.place || "",
      photo_url: c.photo_url || "",
      home_office: c.home_office || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.client_type) { toast.error("Type is required"); return; }
    const payload = {
      ...form,
      office: form.office || null,
      eligible_incentive: form.eligible_incentive === "" ? null : Number(form.eligible_incentive),
      date_of_birth: form.date_of_birth || null,
      home_office: form.home_office || null,
    };
    try {
      if (editing) await api.patch(`/clients/${editing.id}`, payload);
      else await api.post("/clients", payload);
      toast.success(editing ? "Saved" : "Added");
      setOpen(false); load();
    } catch { toast.error("Failed"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this entry?")) return;
    await api.delete(`/clients/${id}`);
    toast.success("Deleted"); load();
  };

  const isStaff = form.client_type === "staff";

  return (
    <div className="space-y-6 animate-fade-in" data-testid="clients-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">People</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">
            {isEmployees ? "Employees" : "Clients"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEmployees ? "Staff & KM office accounts." : "Sub-agents & associate consultants."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-10 w-56" data-testid="cli-filter-type">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {visibleTypes.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            {allowEdit && (
            <DialogTrigger asChild>
              <Button onClick={openCreate} data-testid="add-client-btn" className="h-10 btn-amber border-0">
                <Plus size={16} className="mr-1.5" /> {isEmployees ? "Add employee" : "Add client"}
              </Button>
            </DialogTrigger>
            )}
            <DialogContent className="bg-card">
              <DialogHeader>
                <DialogTitle className="font-display">{editing ? "Edit" : "Add"} {isStaff ? "staff" : "entry"}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {isStaff ? "Onboard a staff member with their birthday and incentive eligibility." : "Enrol a routing partner."}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submit} className="space-y-4">
                <div><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="cli-name" /></div>
                <div>
                  <Label>Type *</Label>
                  <Select value={form.client_type} onValueChange={(v) => setForm({ ...form, client_type: v })}>
                    <SelectTrigger data-testid="cli-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {visibleTypes.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="cli-email" /></div>
                  <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="cli-phone" /></div>
                </div>
                {isStaff ? (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0 border border-border">
                        {form.photo_url ? (
                          <img src={photoSrc(form.photo_url)} alt="staff" className="w-full h-full object-cover" data-testid="cli-photo-preview" />
                        ) : (
                          <UserCircle size={38} className="text-muted-foreground" weight="thin" />
                        )}
                      </div>
                      <div>
                        <input ref={photoInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif" onChange={uploadPhoto} className="hidden" data-testid="cli-photo-input" />
                        <Button type="button" variant="outline" size="sm" disabled={uploadingPhoto} onClick={() => photoInputRef.current?.click()} data-testid="cli-photo-btn">
                          <Camera size={14} className="mr-1.5" /> {uploadingPhoto ? "Uploading…" : (form.photo_url ? "Change photo" : "Upload photo")}
                        </Button>
                        <p className="text-[11px] text-muted-foreground mt-1">JPG, PNG, WebP or GIF · up to 2MB</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>Employee ID</Label>
                        <Input value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder={editing ? "" : "Auto-generated"} data-testid="cli-empid" />
                        {!editing && <p className="text-[11px] text-muted-foreground mt-1">Leave blank to auto-generate (e.g. EMP-BLR-001).</p>}
                      </div>
                      <div>
                        <Label>Date of birth</Label>
                        <Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} data-testid="cli-dob" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>Office</Label>
                        <Select value={form.office || ""} onValueChange={(v) => setForm({ ...form, office: v })}>
                          <SelectTrigger data-testid="cli-office"><SelectValue placeholder="Pick office" /></SelectTrigger>
                          <SelectContent>
                            {OFFICES.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Place</Label>
                        <Input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="e.g. Bangalore" data-testid="cli-place" />
                      </div>
                    </div>
                    <div>
                      <Label>Address</Label>
                      <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Residential address" data-testid="cli-address" />
                    </div>
                    <div>
                      <Label>Eligible incentive (₹ per admission)</Label>
                      <Input type="number" min="0" step="50" value={form.eligible_incentive} onChange={(e) => setForm({ ...form, eligible_incentive: e.target.value })} placeholder="e.g. 500" data-testid="cli-incentive" />
                      <p className="text-[11px] text-muted-foreground mt-1">Paid out once the staff hits 3+ admissions in a month.</p>
                    </div>
                  </>
                ) : (
                  <div><Label>Company</Label><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} data-testid="cli-company" /></div>
                )}
                <div data-testid="cli-home-office-row">
                  <Label>
                    Visible to office{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      (Super Admin scoping — leave blank to keep private)
                    </span>
                  </Label>
                  <Select
                    value={form.home_office || "_none"}
                    onValueChange={(v) =>
                      setForm({ ...form, home_office: v === "_none" ? "" : v })
                    }
                  >
                    <SelectTrigger data-testid="cli-home-office">
                      <SelectValue placeholder="Private to me (default)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Private to me (default)</SelectItem>
                      {HOME_OFFICE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" className="btn-amber border-0" data-testid="cli-save">{editing ? "Save" : "Add"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground border border-border shadow-none" data-testid="empty-clients">
          {list.filter((c) => scopeTypes.includes(c.client_type)).length === 0
            ? (isEmployees ? "No employees yet. Add your first." : "No clients yet.")
            : "No entries match this filter."}
        </Card>
      ) : (
        <GroupedClients filter={filter} scopeTypes={scopeTypes} clients={filtered} allowEdit={allowEdit} openEdit={openEdit} remove={remove} />
      )}
    </div>
  );
}

// ---- Helpers ----

const OFFICE_OPTIONS = [
  { value: "KM_BLR", label: "KM BLR" },
  { value: "KM_TCR", label: "KM TCR" },
  { value: "KM_KMLY", label: "KM KMLY" },
  { value: "_none", label: "No office set" },
];

function ClientCard({ c, allowEdit, openEdit, remove }) {
  const nav = useNavigate();
  const goDetail = () => nav(`/clients/${c.id}`);
  const onKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      goDetail();
    }
  };
  return (
    <Card
      key={c.id}
      role="button"
      tabIndex={0}
      onClick={goDetail}
      onKeyDown={onKey}
      className="p-6 border border-border bg-card rounded-lg shadow-none cursor-pointer hover:border-orange-300 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-orange-400/40"
      data-testid={`client-card-${c.id}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-md bg-muted text-foreground flex items-center justify-center font-medium overflow-hidden shrink-0">
            {c.photo_url ? <img src={photoSrc(c.photo_url)} alt={c.name} className="w-full h-full object-cover" /> : c.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="font-medium">{c.name}</p>
            {c.company && <p className="text-xs text-muted-foreground flex items-center gap-1"><Buildings size={12} /> {c.company}</p>}
            {c.client_type === "staff" && c.office && <p className="text-xs text-muted-foreground flex items-center gap-1"><Buildings size={12} /> {c.office.replace("KM_", "KM ")}</p>}
          </div>
        </div>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {allowEdit && <button onClick={(e) => { e.stopPropagation(); openEdit(c); }} data-testid={`edit-cli-${c.id}`} className="text-muted-foreground hover:text-foreground p-1.5"><PencilSimple size={16} /></button>}
          {allowEdit && <button onClick={(e) => { e.stopPropagation(); remove(c.id); }} data-testid={`delete-cli-${c.id}`} className="text-muted-foreground hover:text-rose-700 dark:text-rose-400 p-1.5"><Trash size={16} /></button>}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${TYPE_BADGE[c.client_type] || "bg-muted text-foreground"}`}>
          {clientTypeLabel(c.client_type)}
        </span>
        {c._creator_office && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-orange-100/60 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400" data-testid={`cli-creator-${c.id}`}>
            <Buildings size={11} weight="duotone" /> {c._creator_office.replace("KM_", "KM ")}
          </span>
        )}
      </div>
      <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
        {c.email && <p className="flex items-center gap-2"><EnvelopeSimple size={14} /> {c.email}</p>}
        {c.phone && <p className="flex items-center gap-2"><Phone size={14} /> {c.phone}</p>}
        {c.client_type === "staff" && c.employee_id && (
          <p className="flex items-center gap-2"><IdentificationBadge size={14} /> {c.employee_id}</p>
        )}
        {c.client_type === "staff" && c.place && (
          <p className="flex items-center gap-2"><MapPin size={14} /> {c.place}</p>
        )}
        {c.client_type === "staff" && c.date_of_birth && (
          <p className="flex items-center gap-2"><Cake size={14} /> {new Date(c.date_of_birth).toLocaleDateString()}</p>
        )}
        {c.client_type === "staff" && c.eligible_incentive != null && (
          <p className="flex items-center gap-2"><CurrencyInr size={14} /> ₹{c.eligible_incentive}/admission</p>
        )}
      </div>
    </Card>
  );
}

function ClientGrid({ clients, allowEdit, openEdit, remove }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {clients.map((c) => (
        <ClientCard key={c.id} c={c} allowEdit={allowEdit} openEdit={openEdit} remove={remove} />
      ))}
    </div>
  );
}

function CategoryHeader({ label, count }) {
  return (
    <div className="flex items-center gap-3 mt-2" data-testid={`cat-header-${label.replace(/\W+/g, "_").toLowerCase()}`}>
      <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">{label}</h2>
      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-foreground text-[11px] font-medium">{count}</span>
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

function GroupedClients({ filter, scopeTypes, clients, allowEdit, openEdit, remove }) {
  // When a specific type filter is selected, just show that category (with Staff sub-grouping)
  const groups = CLIENT_TYPES
    .filter((t) => scopeTypes.includes(t.value))
    .map((t) => ({ ...t, items: clients.filter((c) => c.client_type === t.value) }))
    .filter((g) => (filter === "all" ? g.items.length > 0 : g.value === filter));

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.value} className="space-y-4" data-testid={`cat-section-${g.value}`}>
          <CategoryHeader label={g.label} count={g.items.length} />
          {g.value === "staff" ? (
            // Sub-group staff by office
            <div className="space-y-6">
              {OFFICE_OPTIONS.map((o) => {
                const sub = g.items.filter((c) =>
                  (o.value === "_none" ? !c.office : c.office === o.value)
                );
                if (sub.length === 0) return null;
                return (
                  <div key={o.value} className="space-y-3" data-testid={`office-section-${o.value}`}>
                    <div className="flex items-center gap-2 pl-1">
                      <Buildings size={14} className="text-orange-600 dark:text-orange-400" />
                      <span className="text-xs uppercase tracking-[0.16em] font-semibold text-muted-foreground">{o.label}</span>
                      <span className="text-[10px] text-muted-foreground/70">· {sub.length}</span>
                    </div>
                    <ClientGrid clients={sub} allowEdit={allowEdit} openEdit={openEdit} remove={remove} />
                  </div>
                );
              })}
            </div>
          ) : (
            <ClientGrid clients={g.items} allowEdit={allowEdit} openEdit={openEdit} remove={remove} />
          )}
        </section>
      ))}
    </div>
  );
}

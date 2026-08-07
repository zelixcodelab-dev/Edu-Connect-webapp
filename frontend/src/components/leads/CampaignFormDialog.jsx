/**
 * Create + Edit dialog for a campaign.
 *
 * Create mode: 3-step wizard (Details → Assignment → Review & Launch) matching
 * the CRM spec. Users can either "Save as Draft" (keeps status='draft', no
 * lead distribution) or "Launch Campaign" (status='active', immediately runs
 * the CSV import + distribution the operator configured).
 *
 * Edit mode: flat form. Office is NOT editable (moving a campaign across
 * offices would orphan every assignment). CSV / distribution are done later
 * from the Campaign detail view.
 */
import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CaretLeft, CaretRight, FloppyDisk, Rocket, UploadSimple, Sparkle } from "@phosphor-icons/react";

const OFFICES = [["KM_BLR", "KM BLR"], ["KM_TCR", "KM TCR"], ["KM_KMLY", "KM KMLY"]];
const TAG_TYPES = [["none", "No tag"], ["course", "Course"], ["place", "Place"], ["source", "Source"]];
const STATUSES = [
  ["draft", "Draft"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["completed", "Completed"],
];
const SOURCE_TYPES = [
  ["walk_in", "Walk-in"],
  ["referral", "Referral"],
  ["social", "Social"],
  ["website", "Website"],
  ["csv", "CSV Import"],
  ["other", "Other"],
];
const DISTRIBUTE_METHODS = [
  ["equal", "Round Robin", "Split evenly across selected staff"],
  ["count", "By Count", "Give each selected staff a fixed number of leads"],
  ["percentage", "By Percentage", "Split by percentage share per staff"],
];

const empty = {
  name: "",
  status: "draft",
  source_type: "other",
  description: "",
  start_date: "",
  end_date: "",
  tag_type: "none",
  tag_value: "",
  office: "KM_BLR",
  owner_user_id: "",
  distribute_method: "equal",
  employee_ids: [],
  counts: {},        // employee_id -> number   (used when method=count)
  percentages: {},   // employee_id -> number   (used when method=percentage)
};

function StepCrumbs({ step, isEdit }) {
  if (isEdit) return null;
  const items = [
    ["Details", 1],
    ["Assignment", 2],
    ["Review & Launch", 3],
  ];
  return (
    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-medium mb-4" data-testid="campaign-wizard-steps">
      {items.map(([label, n], i) => (
        <React.Fragment key={n}>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors ${
            step === n
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30"
              : step > n ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
          }`}>
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
              step === n ? "bg-amber-500 text-white" : step > n ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
            }`}>{n}</span>
            <span>{label}</span>
          </div>
          {i < items.length - 1 && <CaretRight size={11} className="text-muted-foreground" />}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function CampaignFormDialog({ open, onOpenChange, onSaved, user, campaign }) {
  const isSuper = user?.role === "super_admin";
  const isEdit = !!campaign?.id;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [admins, setAdmins] = useState([]);        // owner picker options
  const [employees, setEmployees] = useState([]);  // per-office staff for assignment

  // Reset whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setCsvFile(null);
    if (isEdit) {
      setForm({
        ...empty,
        name: campaign.name || "",
        status: campaign.status || "draft",
        source_type: campaign.source_type || "other",
        description: campaign.description || "",
        start_date: campaign.start_date || "",
        end_date: campaign.end_date || "",
        tag_type: campaign.tag_type || "none",
        tag_value: campaign.tag_value || "",
        office: campaign.office || "KM_BLR",
        owner_user_id: campaign.owner_user_id || "",
        distribute_method: campaign.distribute_method || "equal",
        employee_ids: campaign.distribute_employee_ids || [],
      });
    } else {
      setForm({
        ...empty,
        office: isSuper ? "KM_BLR" : (user?.office || "KM_BLR"),
        owner_user_id: user?.id || "",
      });
    }
  }, [open, isEdit, campaign, isSuper, user?.office, user?.id]);

  // Load admins (owner picker) once dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    api.get("/users/admins").then(({ data }) => {
      if (!cancel) setAdmins(Array.isArray(data) ? data : []);
    }).catch((e) => {
      console.error("[campaign] load admins:", e);
      if (!cancel) setAdmins([]);
    });
    return () => { cancel = true; };
  }, [open]);

  // Reload employees whenever the target office changes (Step 2).
  useEffect(() => {
    if (!open || !form.office) { setEmployees([]); return; }
    let cancel = false;
    api.get("/users/assignable").then(({ data }) => {
      if (cancel) return;
      const rows = (data || []).filter(
        (u) => u.office === form.office && (u.role === "staff" || u.role === "office_admin"),
      );
      setEmployees(rows);
    }).catch((e) => {
      console.error("[campaign] load employees:", e);
      if (!cancel) setEmployees([]);
    });
    return () => { cancel = true; };
  }, [open, form.office]);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  const toggleEmployee = (id) => {
    setForm((f) => {
      const has = f.employee_ids.includes(id);
      const next = has ? f.employee_ids.filter((x) => x !== id) : [...f.employee_ids, id];
      // Clean up counts/percentages when removed
      const counts = { ...f.counts };
      const percentages = { ...f.percentages };
      if (has) { delete counts[id]; delete percentages[id]; }
      return { ...f, employee_ids: next, counts, percentages };
    });
  };

  // ---------- validation per step ----------
  const stepValid = useMemo(() => {
    if (step === 1) {
      if (!form.name.trim()) return "Campaign name is required";
      if (!form.source_type) return "Pick a campaign source";
      if (form.start_date && form.end_date && form.start_date > form.end_date) {
        return "End date must be after start date";
      }
      return null;
    }
    if (step === 2) {
      if (!form.office) return "Pick a target office";
      // Employees + method only matter when the operator is going to launch.
      // We validate hard on Launch, but Step-2 forward is soft: pick at least one when
      // a distribute method is chosen.
      if (form.employee_ids.length > 0 && !form.distribute_method) {
        return "Pick a distribution method";
      }
      return null;
    }
    return null;
  }, [step, form]);

  const goNext = () => {
    if (stepValid) { toast.error(stepValid); return; }
    setStep((s) => Math.min(3, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  // ---------- persistence ----------
  const buildPayload = (statusOverride) => ({
    name: form.name.trim(),
    description: form.description.trim(),
    tag_type: form.tag_type === "none" ? null : form.tag_type,
    tag_value: form.tag_type === "none" ? "" : form.tag_value.trim(),
    status: statusOverride || form.status || "draft",
    source_type: form.source_type || null,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    owner_user_id: form.owner_user_id || null,
    distribute_method: form.distribute_method || null,
    distribute_employee_ids: form.employee_ids || [],
    ...((!isEdit && isSuper) ? { office: form.office } : {}),
  });

  const uploadCsvIfNeeded = async (campaignId) => {
    if (!csvFile) return { imported: 0 };
    const fd = new FormData();
    fd.append("file", csvFile);
    fd.append("campaign_id", campaignId);
    const { data } = await api.post("/leads/bulk", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return { imported: data?.count ?? data?.created ?? 0 };
  };

  const distributeIfNeeded = async (campaignId) => {
    if (!form.employee_ids.length) return { assigned: 0 };
    const payload = {
      method: form.distribute_method || "equal",
      employee_ids: form.employee_ids,
      scope: "unassigned",
    };
    if (payload.method === "count") payload.counts = form.counts;
    if (payload.method === "percentage") payload.percentages = form.percentages;
    try {
      const { data } = await api.post(`/campaigns/${campaignId}/distribute`, payload);
      return { assigned: data?.assigned ?? 0 };
    } catch (err) {
      // Non-fatal: campaign was created + CSV imported, but distribution
      // failed (e.g. no leads yet). Surface but don't crash the flow.
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Distribution skipped");
      return { assigned: 0 };
    }
  };

  const submit = async (mode /* "draft" | "launch" */) => {
    if (!form.name.trim()) { toast.error("Campaign name is required"); setStep(1); return; }
    if (mode === "launch" && form.employee_ids.length && !form.distribute_method) {
      toast.error("Pick a distribution method to launch");
      setStep(2);
      return;
    }
    setSaving(true);
    try {
      const status = mode === "launch" ? "active" : "draft";
      const payload = buildPayload(status);
      const { data: created } = isEdit
        ? await api.patch(`/campaigns/${campaign.id}`, payload)
        : await api.post("/campaigns", payload);
      let msg = isEdit ? "Campaign updated" : (mode === "launch" ? "Campaign launched" : "Draft saved");

      // Only run CSV/distribution on CREATE + LAUNCH — never on edit, never on draft.
      if (!isEdit && mode === "launch") {
        const { imported } = await uploadCsvIfNeeded(created.id);
        const { assigned } = await distributeIfNeeded(created.id);
        const bits = [];
        if (imported) bits.push(`${imported} leads imported`);
        if (assigned) bits.push(`${assigned} assigned`);
        if (bits.length) msg += ` — ${bits.join(", ")}`;
      } else if (!isEdit && mode === "draft" && csvFile) {
        // Drafts still import CSVs (so the operator can preview + tweak) but
        // don't run distribution.
        const { imported } = await uploadCsvIfNeeded(created.id);
        if (imported) msg += ` — ${imported} leads imported`;
      }
      toast.success(msg);
      onSaved?.(created);
      onOpenChange(false);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : (isEdit ? "Could not update campaign" : "Could not create campaign"));
    } finally { setSaving(false); }
  };

  const selectedEmployees = employees.filter((e) => form.employee_ids.includes(e.id));
  const ownerLabel = admins.find((a) => a.id === form.owner_user_id)?.name || "—";

  // ============================================================
  // EDIT MODE: flat form (no wizard, no CSV, no distribution)
  // ============================================================
  if (isEdit) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-card max-w-lg" data-testid="campaign-form-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Edit campaign</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Rename, re-tag or update the schedule. Office can&apos;t be changed after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="camp-name">Campaign name</Label>
                <Input id="camp-name" data-testid="campaign-name-input" value={form.name} onChange={(e) => update({ name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => update({ status: v })}>
                  <SelectTrigger data-testid="campaign-status-select" className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Source / Type</Label>
                <Select value={form.source_type} onValueChange={(v) => update({ source_type: v })}>
                  <SelectTrigger data-testid="campaign-source-select" className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="camp-desc">Description</Label>
                <Textarea id="camp-desc" data-testid="campaign-desc-input" value={form.description} onChange={(e) => update({ description: e.target.value })} rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" data-testid="campaign-start-input" value={form.start_date || ""} onChange={(e) => update({ start_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" data-testid="campaign-end-input" value={form.end_date || ""} onChange={(e) => update({ end_date: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Owner</Label>
                <Select value={form.owner_user_id || "__none"} onValueChange={(v) => update({ owner_user_id: v === "__none" ? "" : v })}>
                  <SelectTrigger data-testid="campaign-owner-select" className="bg-card"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No owner assigned</SelectItem>
                    {admins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} · {a.role === "super_admin" ? "Super Admin" : (a.office || "").replace("KM_", "KM ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tag type</Label>
                <Select value={form.tag_type} onValueChange={(v) => update({ tag_type: v })}>
                  <SelectTrigger data-testid="campaign-tagtype-select" className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TAG_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.tag_type !== "none" && (
                <div className="space-y-1.5">
                  <Label>Tag value</Label>
                  <Input data-testid="campaign-tagvalue-input" value={form.tag_value} onChange={(e) => update({ tag_value: e.target.value })} placeholder="e.g. B.Tech" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Office: <span className="text-foreground font-medium">{(form.office || "").replace("KM_", "KM ")}</span>
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" onClick={() => submit("draft")} disabled={saving} data-testid="campaign-save-btn" className="btn-amber border-0">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ============================================================
  // CREATE MODE: 3-step wizard
  // ============================================================
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="campaign-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Create campaign</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Group leads, distribute them to staff, and go live in three quick steps.
          </DialogDescription>
        </DialogHeader>

        <StepCrumbs step={step} isEdit={false} />

        {/* -------- STEP 1: Campaign Details -------- */}
        {step === 1 && (
          <div className="space-y-4" data-testid="campaign-wizard-step1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="camp-name">Campaign name <span className="text-rose-500">*</span></Label>
                <Input id="camp-name" data-testid="campaign-name-input" value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. June Engineering Drive" />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => update({ status: v })}>
                  <SelectTrigger data-testid="campaign-status-select" className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Source / Type <span className="text-rose-500">*</span></Label>
                <Select value={form.source_type} onValueChange={(v) => update({ source_type: v })}>
                  <SelectTrigger data-testid="campaign-source-select" className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="camp-desc">Description</Label>
                <Textarea id="camp-desc" data-testid="campaign-desc-input" value={form.description} onChange={(e) => update({ description: e.target.value })} placeholder="Optional notes about this campaign" rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" data-testid="campaign-start-input" value={form.start_date} onChange={(e) => update({ start_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" data-testid="campaign-end-input" value={form.end_date} onChange={(e) => update({ end_date: e.target.value })} />
              </div>
            </div>

            {/* CSV upload */}
            <div className="rounded-lg border border-dashed border-border p-3 bg-muted/30" data-testid="campaign-csv-block">
              <Label className="flex items-center gap-1.5">
                <UploadSimple size={14} weight="duotone" className="text-orange-500" />
                Upload lead data (CSV) <span className="text-muted-foreground font-normal">— optional</span>
              </Label>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  data-testid="campaign-csv-input"
                  className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-amber-500/10 file:px-2.5 file:py-1 file:text-amber-700 dark:file:text-amber-300 file:font-medium"
                />
                {csvFile && (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                    {csvFile.name}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Columns: <code>name,phone,email,course,place,source,notes</code>. Leads are imported when you save the draft or launch the campaign.
              </p>
            </div>

            {/* Tag block */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tag type</Label>
                <Select value={form.tag_type} onValueChange={(v) => update({ tag_type: v })}>
                  <SelectTrigger data-testid="campaign-tagtype-select" className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TAG_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.tag_type !== "none" && (
                <div className="space-y-1.5">
                  <Label>Tag value</Label>
                  <Input data-testid="campaign-tagvalue-input" value={form.tag_value} onChange={(e) => update({ tag_value: e.target.value })} placeholder="e.g. B.Tech" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* -------- STEP 2: Lead Assignment -------- */}
        {step === 2 && (
          <div className="space-y-4" data-testid="campaign-wizard-step2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Target office <span className="text-rose-500">*</span></Label>
                {isSuper ? (
                  <Select value={form.office} onValueChange={(v) => update({ office: v, employee_ids: [] })}>
                    <SelectTrigger data-testid="campaign-office-select" className="bg-card"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OFFICES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={(form.office || "").replace("KM_", "KM ")} disabled className="bg-muted" data-testid="campaign-office-locked" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Campaign owner</Label>
                <Select value={form.owner_user_id || "__none"} onValueChange={(v) => update({ owner_user_id: v === "__none" ? "" : v })}>
                  <SelectTrigger data-testid="campaign-owner-select" className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No owner</SelectItem>
                    {admins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} · {a.role === "super_admin" ? "Super Admin" : (a.office || "").replace("KM_", "KM ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Select staff to distribute leads to</Label>
              {employees.length === 0 ? (
                <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border py-4 text-center" data-testid="campaign-no-staff">
                  No staff in this office yet. Add staff via the Employees page first.
                </p>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border max-h-52 overflow-y-auto" data-testid="campaign-staff-list">
                  {employees.map((e) => {
                    const checked = form.employee_ids.includes(e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/60 cursor-pointer" data-testid={`campaign-staff-row-${e.id}`}>
                        <Checkbox checked={checked} onCheckedChange={() => toggleEmployee(e.id)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">{e.name}</p>
                          <p className="text-[11px] text-muted-foreground">{e.role === "office_admin" ? "Office Admin" : "Staff"}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
              {form.employee_ids.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-1.5" data-testid="campaign-staff-count">
                  {form.employee_ids.length} selected
                </p>
              )}
            </div>

            <div>
              <Label className="mb-1.5 block">Distribution method</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="campaign-dist-methods">
                {DISTRIBUTE_METHODS.map(([v, l, sub]) => (
                  <button
                    key={v}
                    type="button"
                    data-testid={`campaign-dist-${v}`}
                    onClick={() => update({ distribute_method: v })}
                    className={`text-left rounded-lg border p-3 transition-all ${
                      form.distribute_method === v
                        ? "border-amber-500 bg-amber-500/10 shadow-sm ring-1 ring-amber-500/30"
                        : "border-border bg-card hover:border-orange-500/50"
                    }`}
                  >
                    <p className="text-sm font-medium text-foreground">{l}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Method-specific tuning */}
            {form.distribute_method === "count" && selectedEmployees.length > 0 && (
              <div className="rounded-md border border-border p-3 space-y-2" data-testid="campaign-count-block">
                <p className="text-xs font-medium">How many leads per staff?</p>
                {selectedEmployees.map((e) => (
                  <div key={e.id} className="flex items-center gap-2">
                    <span className="text-sm text-foreground flex-1 truncate">{e.name}</span>
                    <Input
                      type="number"
                      min={0}
                      value={form.counts[e.id] ?? ""}
                      onChange={(ev) => update({ counts: { ...form.counts, [e.id]: Number(ev.target.value || 0) } })}
                      className="w-24"
                      data-testid={`campaign-count-${e.id}`}
                    />
                  </div>
                ))}
              </div>
            )}
            {form.distribute_method === "percentage" && selectedEmployees.length > 0 && (
              <div className="rounded-md border border-border p-3 space-y-2" data-testid="campaign-pct-block">
                <p className="text-xs font-medium">Percentage per staff (sum should be 100%)</p>
                {selectedEmployees.map((e) => (
                  <div key={e.id} className="flex items-center gap-2">
                    <span className="text-sm text-foreground flex-1 truncate">{e.name}</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={form.percentages[e.id] ?? ""}
                      onChange={(ev) => update({ percentages: { ...form.percentages, [e.id]: Number(ev.target.value || 0) } })}
                      className="w-24"
                      data-testid={`campaign-pct-${e.id}`}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* -------- STEP 3: Review & Launch -------- */}
        {step === 3 && (
          <div className="space-y-4" data-testid="campaign-wizard-step3">
            {/* Communication template — placeholder */}
            <div className="rounded-lg border border-dashed border-border p-3 bg-muted/20">
              <Label className="flex items-center gap-1.5">
                <Sparkle size={14} weight="duotone" className="text-orange-500" />
                Communication template
              </Label>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">WhatsApp / SMS / Email templates for this campaign.</p>
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" data-testid="campaign-template-coming-soon">
                  Coming soon
                </Badge>
              </div>
            </div>

            {/* Summary card */}
            <div className="rounded-lg border border-border p-4 space-y-2 bg-card" data-testid="campaign-review-summary">
              <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-1">Summary</p>
              <SummaryRow label="Name" value={form.name || "—"} />
              <SummaryRow label="Status" value={STATUSES.find((s) => s[0] === form.status)?.[1] || form.status} />
              <SummaryRow label="Source" value={SOURCE_TYPES.find((s) => s[0] === form.source_type)?.[1] || "—"} />
              {form.description && <SummaryRow label="Description" value={form.description} />}
              {(form.start_date || form.end_date) && (
                <SummaryRow label="Schedule" value={`${form.start_date || "—"} → ${form.end_date || "—"}`} />
              )}
              <SummaryRow label="Office" value={(form.office || "").replace("KM_", "KM ")} />
              <SummaryRow label="Owner" value={ownerLabel} />
              <SummaryRow label="Distribution" value={`${DISTRIBUTE_METHODS.find((m) => m[0] === form.distribute_method)?.[1] || "—"} · ${form.employee_ids.length} staff`} />
              {csvFile && <SummaryRow label="CSV file" value={csvFile.name} />}
              {form.tag_type !== "none" && form.tag_value && (
                <SummaryRow label="Tag" value={`${form.tag_type}: ${form.tag_value}`} />
              )}
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              Save as draft to come back later, or launch to import leads &amp; distribute them now.
            </p>
          </div>
        )}

        {/* -------- Footer -------- */}
        <DialogFooter className="gap-2 flex-col-reverse sm:flex-row">
          {step > 1 ? (
            <Button type="button" variant="outline" onClick={goBack} disabled={saving} data-testid="campaign-back-btn">
              <CaretLeft size={14} className="mr-1" /> Back
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          )}
          {step < 3 ? (
            <Button type="button" onClick={goNext} className="btn-amber border-0" data-testid="campaign-next-btn">
              Next <CaretRight size={14} className="ml-1" />
            </Button>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <Button type="button" variant="outline" onClick={() => submit("draft")} disabled={saving} data-testid="campaign-save-draft-btn">
                <FloppyDisk size={14} className="mr-1.5" />
                {saving ? "Saving…" : "Save as draft"}
              </Button>
              <Button type="button" onClick={() => submit("launch")} disabled={saving} className="btn-amber border-0" data-testid="campaign-launch-btn">
                <Rocket size={14} className="mr-1.5" />
                {saving ? "Launching…" : "Launch campaign"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground break-words">{value}</span>
    </div>
  );
}

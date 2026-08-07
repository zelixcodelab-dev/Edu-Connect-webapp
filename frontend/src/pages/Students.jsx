import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canEdit } from "@/lib/perm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ArrowRight, Student as StudentIcon, FileXls, MagnifyingGlass, Buildings, UserCircle, ShareNetwork, ClipboardText, MapPin, SquaresFour, Rows } from "@phosphor-icons/react";
import { toast } from "sonner";
import { downloadStudentsXlsx } from "@/lib/studentExports";
import FeesPlanFields, { emptyFeesPlan, normalizeFeesPlanForApi } from "@/components/FeesPlanFields";
import StudentCard from "@/components/students/StudentCard";
import StudentsTable from "@/components/students/StudentsTable";
import ClientPickerDialog from "@/components/students/ClientPickerDialog";
import CollegeSelect from "@/components/CollegeSelect";
import { COLLEGE_PLACES, normalizePlace } from "@/lib/places";
import { navigateToApply, buildApplyUrl, linkedUserRef } from "@/lib/applyUrl";
import PasteApplicationDialog from "@/components/students/PasteApplicationDialog";

const STATUS_OPTIONS = [
  { value: "inquiry", label: "Inquiry" },
  { value: "enrolled", label: "Enrolled" },
  { value: "cancelled", label: "Cancelled" },
];

const emptyForm = () => ({
  name: "", course: "", college: "", reference: "",
  sc_out_fixed: 0, status: "inquiry", enrollment_date: "", notes: "",
  fees_plan: emptyFeesPlan(),
  home_office: "",
  collegeCourses: [],
});

const HOME_OFFICE_OPTIONS = [
  { value: "KM_BLR", label: "KM BLR" },
  { value: "KM_TCR", label: "KM TCR" },
  { value: "KM_KMLY", label: "KM KMLY" },
  { value: "ALL", label: "Shared (all offices)" },
];

function recentRank(s) {
  // Sort: enrollment_date desc, then created_at desc
  return s.enrollment_date || s.created_at || "";
}

// Helpers for the sortable Home district / Hometown column. We use the
// communication.city captured during the public application step — this is
// the student's hometown, distinct from their college's city.
export function hometownOf(s) {
  const comm = s?.application?.communication;
  if (!comm) return "";
  return String(comm.city || comm.state || "").trim();
}

export default function Students() {
  const { user } = useAuth();
  const nav = useNavigate();
  const allowEdit = canEdit(user, "students");
  const isSuper = user?.role === "super_admin";
  const role = user?.role;
  const currency = user?.currency || "USD";
  const [list, setList] = useState([]);
  const [clients, setClients] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());

  // Filters
  const [qName, setQName] = useState("");
  const [qCollege, setQCollege] = useState("");
  const [qRef, setQRef] = useState("");
  const [qCity, setQCity] = useState("_all"); // "_all" | one of COLLEGE_PLACES | "_other"
  const [view, setView] = useState(() => {
    try { return localStorage.getItem("students-view") || "card"; }
    catch { return "card"; }
  });
  // Linked users only ever see the card grid — their list-view toggle is
  // hidden, so make sure a stale localStorage value doesn't force them onto
  // an empty list view.
  const effectiveView = role === "user" ? "card" : view;
  const switchView = (next) => {
    setView(next);
    try { localStorage.setItem("students-view", next); } catch (e) { void e; }
  };

  // Super admin: client picker dialog before opening the student form
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  // Paste-application dialog (super admin only)
  const [pasteOpen, setPasteOpen] = useState(false);
  const openAddStudent = () => {
    // Linked user (sub-agent / consultant): they don't have direct write access
    // to /api/students. Route them through their referral on the public form,
    // which creates an inquiry that super-admin can later approve. Same UX as
    // their Quick Entry button — consistent across the app.
    if (role === "user" && user?.linked_client_id) {
      navigateToApply(nav, linkedUserRef(user));
      return;
    }
    // Reset form to blank
    setForm({ ...emptyForm(), reference: "" });
    // Both super_admin (full client picker) AND office_admin (staff-only picker)
    // pick a reference FIRST, then the student form opens with it pre-filled.
    setPickerSearch("");
    setPickerOpen(true);
  };
  const pickClientAndEnrol = (client) => {
    setForm((f) => ({ ...f, reference: client?.name || "" }));
    setPickerOpen(false);
    setOpen(true);
  };
  const skipPicker = () => {
    setForm((f) => ({ ...f, reference: "" }));
    setPickerOpen(false);
    setOpen(true);
  };

  const load = useCallback(async () => {
    const [s, c, col] = await Promise.all([
      api.get("/students"),
      api.get("/clients"),
      api.get("/colleges"),
    ]);
    setList(s.data); setClients(c.data); setColleges(col.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Auto-open the Add dialog when arriving with ?new=1 (from Quick Entry hub or Add-an-admission flow)
  const [searchParams, setSearchParams] = useSearchParams();
  const newFlag = searchParams.get("new");
  const staffParam = searchParams.get("staff");
  const action = searchParams.get("action");
  const pasteFlag = searchParams.get("paste");
  useEffect(() => {
    if (pasteFlag === "1" && isSuper) {
      setPasteOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("paste");
      setSearchParams(next, { replace: true });
      return;
    }
    if (newFlag === "1") {
      if (role === "user" && user?.linked_client_id) {
        // Linked user: there is no inline add-student flow for them. Redirect
        // to the public application form with their referral so the inquiry is
        // attributed correctly.
        navigateToApply(nav, linkedUserRef(user), { replace: true });
        return;
      }
      if (staffParam) {
        // Came from "Add an admission" with a pre-selected staff → open form direct
        setForm((f) => ({ ...f, reference: decodeURIComponent(staffParam) }));
        setOpen(true);
      } else {
        // Plain ?new=1 from Quick Entry → open the reference picker first
        setForm((f) => ({ ...emptyForm(), reference: "" }));
        setPickerSearch("");
        setPickerOpen(true);
      }
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      next.delete("staff");
      setSearchParams(next, { replace: true });
    }
  }, [newFlag, staffParam, pasteFlag, isSuper, role, user, nav, searchParams, setSearchParams]);

  // Map college name → canonical place (lowercased keys for tolerant lookup).
  const collegePlaceByName = useMemo(() => {
    const map = new Map();
    for (const c of colleges) {
      if (c?.name) map.set(String(c.name).toLowerCase(), normalizePlace(c.place || ""));
    }
    return map;
  }, [colleges]);

  const cityOfStudent = useCallback((s) => {
    if (!s?.college) return "";
    return collegePlaceByName.get(String(s.college).toLowerCase()) || "";
  }, [collegePlaceByName]);

  // Per-city enrollment counts (computed on the *unfiltered* list so the
  // dropdown always shows the same totals regardless of other filters).
  const cityCounts = useMemo(() => {
    const counts = { _all: list.length, _other: 0 };
    for (const p of COLLEGE_PLACES) counts[p] = 0;
    for (const s of list) {
      const c = cityOfStudent(s);
      if (!c) continue;
      if (COLLEGE_PLACES.includes(c)) counts[c] += 1;
      else counts._other += 1;
    }
    return counts;
  }, [list, cityOfStudent]);

  const filtered = useMemo(() => {
    const m = (v, q) => !q || String(v || "").toLowerCase().includes(q.toLowerCase());
    return [...list]
      .filter((s) => m(s.name, qName) && m(s.college, qCollege) && m(s.reference, qRef))
      .filter((s) => {
        if (qCity === "_all") return true;
        const c = cityOfStudent(s);
        if (qCity === "_other") return c && !COLLEGE_PLACES.includes(c);
        return c === qCity;
      })
      .sort((a, b) => String(recentRank(b)).localeCompare(String(recentRank(a))));
  }, [list, qName, qCollege, qRef, qCity, cityOfStudent]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        sc_out_fixed: parseFloat(form.sc_out_fixed) || 0,
        fees_plan: normalizeFeesPlanForApi(form.fees_plan),
        home_office: form.home_office || null,
      };
      delete payload.collegeCourses; // local-only field, not part of the API schema
      await api.post("/students", payload);
      toast.success("Student added");
      setOpen(false); setForm(emptyForm()); load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="students-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">Pipeline</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Students</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {effectiveView === "list"
              ? "Spreadsheet view — click any column header to sort, type under the title to filter that column."
              : "Recent enrollments — search by name, college, or reference."}
          </p>
          {action === "log_payment" && (
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-gradient-soft border border-amber-500/30 text-sm text-foreground" data-testid="log-payment-banner">
              <ArrowRight size={14} className="text-amber-700 dark:text-amber-400" />
              <span><strong>Log Payment:</strong> click a student card below to open their fees ledger.</span>
            </div>
          )}
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(emptyForm()); }}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Card / List view toggle — hidden for linked users (their dashboard
                already shows totals and they only need the card grid here). */}
            {role !== "user" && (
              <div
                className="inline-flex items-center rounded-md border border-border bg-card p-0.5 h-10"
                data-testid="students-view-toggle"
                role="tablist"
                aria-label="Students view"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "card"}
                  onClick={() => switchView("card")}
                  data-testid="students-view-card"
                  className={`px-3 h-9 rounded-[6px] inline-flex items-center gap-1.5 text-sm font-medium transition-colors ${
                    view === "card"
                      ? "bg-amber-gradient text-white shadow-sm shadow-orange-500/25"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <SquaresFour size={15} weight={view === "card" ? "fill" : "regular"} />
                  <span className="hidden sm:inline">Card</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "list"}
                  onClick={() => switchView("list")}
                  data-testid="students-view-list"
                  className={`px-3 h-9 rounded-[6px] inline-flex items-center gap-1.5 text-sm font-medium transition-colors ${
                    view === "list"
                      ? "bg-amber-gradient text-white shadow-sm shadow-orange-500/25"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Rows size={15} weight={view === "list" ? "fill" : "regular"} />
                  <span className="hidden sm:inline">List</span>
                </button>
              </div>
            )}
            {/* Share-application-link is moved to the User dashboard for linked
                users (where the URL includes their referral code). */}
            {role !== "user" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const url = buildApplyUrl();
                  navigator.clipboard.writeText(url).then(
                    () => toast.success(`Public form link copied · ${url}`),
                    () => { window.prompt("Copy the application link:", url); }
                  );
                }}
                className="h-10"
                data-testid="share-apply-link-btn"
                title="Copy the public admission form link"
              >
                <ShareNetwork size={16} className="mr-1.5" /> Share application link
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!list.length) { toast.error("No students to export"); return; }
                try {
                  downloadStudentsXlsx({ students: list, currency });
                  toast.success("Exported XLSX");
                } catch (err) {
                  console.error(err);
                  toast.error("Export failed");
                }
              }}
              className="h-10"
              data-testid="export-students-xlsx-btn"
            >
              <FileXls size={16} className="mr-1.5" /> Export XLSX
            </Button>
            {allowEdit && isSuper && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setPasteOpen(true)}
                className="h-10"
                data-testid="paste-application-btn"
                title="Paste an application text to auto-fill a new student"
              >
                <ClipboardText size={16} className="mr-1.5" /> Paste application
              </Button>
            )}
            {(allowEdit || role === "user") && (
              <Button onClick={openAddStudent} data-testid="add-student-btn" className="h-10 btn-amber border-0">
                <Plus size={16} className="mr-1.5" /> Add student
              </Button>
            )}
          </div>
          <DialogContent className="bg-card max-w-2xl max-h-[92vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display">New student</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">Enrol a student and lock in the fee structure. Schedules are generated automatically.</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div><Label>Student Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="st-name" /></div>
              <div>
                <Label>Place / City</Label>
                <Select
                  value={form.collegePlace || "_all"}
                  onValueChange={(v) => {
                    const next = v === "_all" ? "" : v;
                    setForm((prev) => {
                      const out = { ...prev, collegePlace: next };
                      // Clear college if it isn't in the new place
                      return out;
                    });
                  }}
                >
                  <SelectTrigger data-testid="st-place"><SelectValue placeholder="Any city" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Any city</SelectItem>
                    {COLLEGE_PLACES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>College</Label>
                  <CollegeSelect
                    value={form.college}
                    onChange={(name) => setForm({ ...form, college: name })}
                    onCollegeMeta={(c) =>
                      setForm((prev) => ({
                        ...prev,
                        collegeCourses: c ? (c.courses || []) : [],
                        // Reset course when college changes, unless the prior
                        // value still appears in the new college's catalogue.
                        course:
                          c && (c.courses || []).includes(prev.course)
                            ? prev.course
                            : "",
                      }))
                    }
                    testid="st-college"
                    placeholder={form.collegePlace ? `Pick a college in ${form.collegePlace}` : "Pick a college"}
                    placeFilter={form.collegePlace}
                  />
                </div>
                <div>
                  <Label>Course</Label>
                  {(form.collegeCourses || []).length > 0 ? (
                    <Select
                      value={form.course || "_none"}
                      onValueChange={(v) =>
                        setForm({ ...form, course: v === "_none" ? "" : v })
                      }
                    >
                      <SelectTrigger data-testid="st-course">
                        <SelectValue placeholder="Pick a course" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— Select course —</SelectItem>
                        {(form.collegeCourses || []).map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={form.course}
                      onChange={(e) => setForm({ ...form, course: e.target.value })}
                      placeholder={form.college ? "No courses listed for this college — type one" : "Pick a college first"}
                      disabled={!form.college && !form.course}
                      data-testid="st-course"
                    />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {form.reference ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-gradient-soft px-3 py-2.5 flex items-center justify-between gap-2" data-testid="st-reference-chip">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Reference (staff)</p>
                      <p className="text-sm font-medium text-foreground truncate">{form.reference}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, reference: "" })}
                      data-testid="st-reference-clear"
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 flex items-center text-[12px] text-muted-foreground">
                    No staff reference (use &ldquo;Add an admission&rdquo; on the dashboard to attach one)
                  </div>
                )}
                <div><Label>SC Earned</Label><Input type="number" step="0.01" value={form.sc_out_fixed} onChange={(e) => setForm({ ...form, sc_out_fixed: e.target.value })} data-testid="st-sc" /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger data-testid="st-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Enrollment Date</Label><Input type="date" value={form.enrollment_date} onChange={(e) => setForm({ ...form, enrollment_date: e.target.value })} data-testid="st-enroll-date" /></div>
              </div>

              {isSuper && (
                <div data-testid="st-home-office-row">
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
                    <SelectTrigger data-testid="st-home-office">
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
              )}

              <FeesPlanFields
                fp={form.fees_plan}
                onChange={(next) => setForm({ ...form, fees_plan: next })}
                currency={currency}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="btn-amber border-0" data-testid="st-save">Add</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Reference picker dialog (opens before the student form) */}
        <ClientPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          search={pickerSearch}
          onSearchChange={setPickerSearch}
          clients={clients}
          isSuper={isSuper}
          onPick={pickClientAndEnrol}
          onSkip={skipPicker}
        />

        {/* Paste-application dialog (super admin only) */}
        {isSuper && (
          <PasteApplicationDialog
            open={pasteOpen}
            onOpenChange={setPasteOpen}
            onCreated={() => { load(); }}
          />
        )}
      </header>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="students-filters">
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={qName}
            onChange={(e) => setQName(e.target.value)}
            placeholder="Student name"
            className="pl-9 bg-card"
            data-testid="filter-name"
          />
        </div>
        <div className="relative">
          <Buildings size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={qCollege}
            onChange={(e) => setQCollege(e.target.value)}
            placeholder="College"
            className="pl-9 bg-card"
            data-testid="filter-college"
          />
        </div>
        <div className="relative">
          <UserCircle size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={qRef}
            onChange={(e) => setQRef(e.target.value)}
            placeholder="Reference"
            className="pl-9 bg-card"
            data-testid="filter-reference"
          />
        </div>
        <div className="relative">
          <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 z-10 pointer-events-none" />
          <Select value={qCity} onValueChange={setQCity}>
            <SelectTrigger className="pl-9 bg-card" data-testid="filter-city">
              <SelectValue placeholder="All cities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all" data-testid="filter-city-all">
                All cities · {cityCounts._all}
              </SelectItem>
              {COLLEGE_PLACES.map((c) => (
                <SelectItem key={c} value={c} data-testid={`filter-city-${c}`}>
                  {c} · {cityCounts[c] || 0}
                </SelectItem>
              ))}
              {cityCounts._other > 0 && (
                <SelectItem value="_other" data-testid="filter-city-other">
                  Other · {cityCounts._other}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground border border-border shadow-none" data-testid="empty-students">
          <StudentIcon size={32} className="mx-auto text-muted-foreground/50 mb-3" />
          {list.length === 0 ? "No students yet. Add one to start tracking fees." : "No students match these filters."}
        </Card>
      ) : effectiveView === "list" ? (
        <>
          <p className="label-eyebrow" data-testid="recent-eyebrow">
            {qCity === "_all"
              ? `Recent enrollments — ${filtered.length}`
              : qCity === "_other"
              ? `Other cities — ${filtered.length} enrollments`
              : `${qCity} — ${filtered.length} enrollments`}
          </p>
          <StudentsTable
            students={filtered}
            currency={currency}
            cityOfStudent={cityOfStudent}
            hometownOf={hometownOf}
          />
        </>
      ) : (
        <>
          <p className="label-eyebrow" data-testid="recent-eyebrow">
            {qCity === "_all"
              ? `Recent enrollments — ${filtered.length}`
              : qCity === "_other"
              ? `Other cities — ${filtered.length} enrollments`
              : `${qCity} — ${filtered.length} enrollments`}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="students-grid">
            {filtered.map((s) => (
              <StudentCard key={s.id} s={s} currency={currency} isSuper={isSuper} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

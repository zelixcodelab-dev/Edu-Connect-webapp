import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COLLEGE_PLACES, normalizePlace } from "@/lib/places";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];
const ADMISSION = [
  { value: "management", label: "Management" },
  { value: "government", label: "Government" },
  { value: "merit", label: "Merit" },
  { value: "lateral_entry", label: "Lateral Entry" },
  { value: "other", label: "Other" },
];

const SECTIONS = [
  { id: "basic", label: "Candidate" },
  { id: "course", label: "Course" },
  { id: "communication", label: "Parents & Address" },
  { id: "academic", label: "Academic" },
  { id: "reference", label: "Reference" },
];

const emptyApp = () => ({
  basic_info: {
    student_full_name: "", mobile_number: "", email: "", date_of_birth: "",
    gender: "male", aadhaar_number: "", nationality: "Indian", religion: "", caste: "",
  },
  course: {
    interested_course: "", preferred_college: "", academic_year: "", admission_type: "management",
  },
  communication: {
    father_name: "", father_mobile: "", father_occupation: "",
    mother_name: "", mother_mobile: "", mother_occupation: "",
    address_line_1: "", address_line_2: "", city: "", state: "", pincode: "",
  },
  academic: {
    tenth: { register_number: "", board: "", year_of_passing: "", school_name: "", school_place: "", percentage: "" },
    twelfth: { register_number: "", board: "", year_of_passing: "", school_name: "", school_place: "", percentage: "" },
  },
  reference: { name: "", relation: "", phone: "", notes: "" },
});

export default function EditApplicationDialog({ open, onOpenChange, student, onSaved }) {
  const [tab, setTab] = useState("basic");
  const [form, setForm] = useState(emptyApp());
  const [saving, setSaving] = useState(false);
  const [colleges, setColleges] = useState([]);
  const [courses, setCourses] = useState([]);
  // The "Place" filter is a UI state for narrowing the College picker — it is
  // NOT persisted on the application (the application stores the college name).
  const [place, setPlace] = useState("");

  // Fetch master college + course lists once when the dialog opens.
  // We deliberately use the SAME public endpoints the /apply form uses so the
  // shape + filtering behaviour stay in lockstep with the public application.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      api.get("/public/colleges").then((r) => r.data?.colleges || []).catch(() => []),
      api.get("/public/courses").then((r) => r.data?.courses || []).catch(() => []),
    ]).then(([cl, cr]) => {
      if (cancelled) return;
      setColleges(cl);
      setCourses(cr);
    });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (open && student?.application) {
      // Deep-clone and fill any missing sub-objects.
      const base = emptyApp();
      const a = student.application;
      setForm({
        basic_info: { ...base.basic_info, ...(a.basic_info || {}) },
        course: { ...base.course, ...(a.course || {}) },
        communication: { ...base.communication, ...(a.communication || {}) },
        academic: {
          tenth: { ...base.academic.tenth, ...(a.academic?.tenth || {}) },
          twelfth: { ...base.academic.twelfth, ...(a.academic?.twelfth || {}) },
        },
        reference: { ...base.reference, ...(a.reference || {}) },
      });
      setTab("basic");
    }
  }, [open, student]);

  // Seed the place filter from the currently-saved college so the College
  // dropdown re-opens scoped to the right city.
  useEffect(() => {
    if (!open) return;
    const collegeName = form?.course?.preferred_college;
    if (!collegeName || !colleges.length) return;
    const col = colleges.find((c) => c.name === collegeName);
    if (!col?.place) return;
    const norm = normalizePlace(col.place);
    if (COLLEGE_PLACES.includes(norm)) setPlace(norm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, colleges]);

  const set = (section, key, value) =>
    setForm((s) => ({ ...s, [section]: { ...s[section], [key]: value } }));

  const setAcademic = (level, key, value) =>
    setForm((s) => ({
      ...s,
      academic: { ...s.academic, [level]: { ...s.academic[level], [key]: value } },
    }));

  const submit = async () => {
    setSaving(true);
    try {
      const fresh = await api.patch(`/applications/${student.id}`, form);
      toast.success("Application updated. The PDF will reflect these changes.");
      onSaved?.(fresh.data);
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!student) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit application · {student?.name || "Applicant"}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Edits are written back to the application record. The next time you download the Application PDF it will use these values.
          </p>
        </DialogHeader>

        {/* Tab strip */}
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-border">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setTab(s.id)}
              data-testid={`edit-app-tab-${s.id}`}
              className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-md transition-colors ${
                tab === s.id
                  ? "bg-amber-gradient text-white font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1 py-2 space-y-3">
          {tab === "basic" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Full name" required><Input value={form.basic_info.student_full_name} onChange={(e) => set("basic_info", "student_full_name", e.target.value)} data-testid="edit-bi-name" /></Field>
              <Field label="Mobile" required><Input value={form.basic_info.mobile_number} onChange={(e) => set("basic_info", "mobile_number", e.target.value)} data-testid="edit-bi-mobile" /></Field>
              <Field label="Email"><Input type="email" value={form.basic_info.email} onChange={(e) => set("basic_info", "email", e.target.value)} data-testid="edit-bi-email" /></Field>
              <Field label="Date of birth"><Input type="date" value={form.basic_info.date_of_birth} onChange={(e) => set("basic_info", "date_of_birth", e.target.value)} data-testid="edit-bi-dob" /></Field>
              <Field label="Gender">
                <Select value={form.basic_info.gender} onValueChange={(v) => set("basic_info", "gender", v)}>
                  <SelectTrigger data-testid="edit-bi-gender"><SelectValue /></SelectTrigger>
                  <SelectContent>{GENDERS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Aadhaar"><Input value={form.basic_info.aadhaar_number} onChange={(e) => set("basic_info", "aadhaar_number", e.target.value)} data-testid="edit-bi-aadhaar" /></Field>
              <Field label="Nationality"><Input value={form.basic_info.nationality} onChange={(e) => set("basic_info", "nationality", e.target.value)} /></Field>
              <Field label="Religion"><Input value={form.basic_info.religion} onChange={(e) => set("basic_info", "religion", e.target.value)} /></Field>
              <Field label="Caste"><Input value={form.basic_info.caste} onChange={(e) => set("basic_info", "caste", e.target.value)} /></Field>
            </div>
          )}

          {tab === "course" && (() => {
            // Cascade: Place → filters Colleges → that College's courses
            const collegesInPlace = place
              ? colleges.filter((c) => normalizePlace(c.place || "").toLowerCase() === place.toLowerCase())
              : colleges;
            const selectedCollege = colleges.find((c) => c.name === form.course.preferred_college);
            const collegeCourses = (selectedCollege?.courses || []).filter(Boolean);
            const courseOptions = collegeCourses.length > 0 ? collegeCourses : courses;
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Place / City">
                  <Select
                    value={place || "_all"}
                    onValueChange={(v) => {
                      const next = v === "_all" ? "" : v;
                      setPlace(next);
                      // If the current college isn't in the new place, clear it (and the course)
                      if (next && selectedCollege) {
                        const cnorm = normalizePlace(selectedCollege.place || "");
                        if (cnorm.toLowerCase() !== next.toLowerCase()) {
                          set("course", "preferred_college", "");
                          set("course", "interested_course", "");
                        }
                      }
                    }}
                  >
                    <SelectTrigger data-testid="edit-co-place">
                      <SelectValue placeholder="Any city" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">Any city</SelectItem>
                      {COLLEGE_PLACES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Preferred College">
                  <Select
                    value={form.course.preferred_college || ""}
                    onValueChange={(name) => {
                      set("course", "preferred_college", name);
                      // If the picked college doesn't offer the current course, clear it
                      const nextCollege = colleges.find((c) => c.name === name);
                      if (
                        nextCollege &&
                        form.course.interested_course &&
                        (nextCollege.courses || []).length > 0 &&
                        !(nextCollege.courses || []).includes(form.course.interested_course)
                      ) {
                        set("course", "interested_course", "");
                      }
                    }}
                  >
                    <SelectTrigger data-testid="edit-co-college">
                      <SelectValue placeholder={place ? `Pick a college in ${place}` : "Pick a college"} />
                    </SelectTrigger>
                    <SelectContent>
                      {collegesInPlace.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          No colleges {place ? `in ${place}` : "in the catalogue"} yet.
                        </div>
                      ) : (
                        collegesInPlace.map((c) => (
                          <SelectItem key={c.id || c.name} value={c.name}>
                            {c.name}
                            {c.place ? <span className="text-muted-foreground"> · {c.place}</span> : null}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Interested course" required>
                  <Select
                    value={form.course.interested_course || ""}
                    onValueChange={(v) => set("course", "interested_course", v)}
                    disabled={courseOptions.length === 0}
                  >
                    <SelectTrigger data-testid="edit-co-course">
                      <SelectValue placeholder={
                        selectedCollege ? "Pick a course" : "Pick a college first"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {courseOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">No courses listed.</div>
                      ) : (
                        courseOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)
                      )}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Academic year">
                  <Input value={form.course.academic_year} onChange={(e) => set("course", "academic_year", e.target.value)} placeholder="e.g. 2026-2027" data-testid="edit-co-year" />
                </Field>

                <Field label="Admission type">
                  <Select value={form.course.admission_type} onValueChange={(v) => set("course", "admission_type", v)}>
                    <SelectTrigger data-testid="edit-co-admission"><SelectValue /></SelectTrigger>
                    <SelectContent>{ADMISSION.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
            );
          })()}

          {tab === "communication" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Father's name"><Input value={form.communication.father_name} onChange={(e) => set("communication", "father_name", e.target.value)} /></Field>
              <Field label="Father's mobile"><Input value={form.communication.father_mobile} onChange={(e) => set("communication", "father_mobile", e.target.value)} /></Field>
              <Field label="Mother's name"><Input value={form.communication.mother_name} onChange={(e) => set("communication", "mother_name", e.target.value)} /></Field>
              <Field label="Mother's mobile"><Input value={form.communication.mother_mobile} onChange={(e) => set("communication", "mother_mobile", e.target.value)} /></Field>
              <Field label="Address line 1" className="sm:col-span-2"><Input value={form.communication.address_line_1} onChange={(e) => set("communication", "address_line_1", e.target.value)} /></Field>
              <Field label="Address line 2" className="sm:col-span-2"><Input value={form.communication.address_line_2} onChange={(e) => set("communication", "address_line_2", e.target.value)} /></Field>
              <Field label="City"><Input value={form.communication.city} onChange={(e) => set("communication", "city", e.target.value)} /></Field>
              <Field label="State"><Input value={form.communication.state} onChange={(e) => set("communication", "state", e.target.value)} /></Field>
              <Field label="Pincode"><Input value={form.communication.pincode} onChange={(e) => set("communication", "pincode", e.target.value)} /></Field>
            </div>
          )}

          {tab === "academic" && (
            <div className="space-y-4">
              <AcademicSection title="10th Standard" record={form.academic.tenth} onChange={(k, v) => setAcademic("tenth", k, v)} idPrefix="edit-ten" />
              <AcademicSection title="12th Standard / Diploma" record={form.academic.twelfth} onChange={(k, v) => setAcademic("twelfth", k, v)} idPrefix="edit-twe" />
            </div>
          )}

          {tab === "reference" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Reference name"><Input value={form.reference.name} onChange={(e) => set("reference", "name", e.target.value)} /></Field>
              <Field label="Relation"><Input value={form.reference.relation} onChange={(e) => set("reference", "relation", e.target.value)} /></Field>
              <Field label="Phone"><Input value={form.reference.phone} onChange={(e) => set("reference", "phone", e.target.value)} /></Field>
              <Field label="Notes" className="sm:col-span-2"><Input value={form.reference.notes} onChange={(e) => set("reference", "notes", e.target.value)} /></Field>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} data-testid="edit-app-cancel">Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="edit-app-save">
            {saving ? "Saving…" : "Save & regenerate PDF data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, required, children, className = "" }) {
  return (
    <div className={className}>
      <Label className="text-xs">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function AcademicSection({ title, record, onChange, idPrefix }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="label-eyebrow mb-2">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Register no."><Input value={record.register_number} onChange={(e) => onChange("register_number", e.target.value)} data-testid={`${idPrefix}-reg`} /></Field>
        <Field label="Board"><Input value={record.board} onChange={(e) => onChange("board", e.target.value)} placeholder="CBSE / State" /></Field>
        <Field label="Year of passing"><Input value={record.year_of_passing} onChange={(e) => onChange("year_of_passing", e.target.value)} placeholder="2024" /></Field>
        <Field label="School name" className="sm:col-span-2"><Input value={record.school_name} onChange={(e) => onChange("school_name", e.target.value)} /></Field>
        <Field label="School place"><Input value={record.school_place} onChange={(e) => onChange("school_place", e.target.value)} /></Field>
        <Field label="Percentage"><Input value={record.percentage} onChange={(e) => onChange("percentage", e.target.value)} placeholder="92.5" /></Field>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast, Toaster } from "sonner";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { API as ROOT_API } from "@/lib/api";
import {
  User, GraduationCap, Phone, Books, Receipt, UserCircle,
  ArrowRight, ArrowLeft, CheckCircle, Sparkle, Copy, LockSimple,
} from "@phosphor-icons/react";
import {
  STEPS, GENDERS, PARTNER_COLLEGES, ADMISSION_TYPES, BOARDS,
  INDIAN_STATES, emptyApplication, validateStep, renderDeclaration,
} from "@/lib/applicationSchema";
import CollegeSelect from "@/components/CollegeSelect";
import { COLLEGE_PLACES, normalizePlace } from "@/lib/places";

const ICONS = { User, GraduationCap, Phone, Books, Receipt, UserCircle };
// Reuse the normalised base URL from lib/api so any missing `https://` scheme
// in REACT_APP_BACKEND_URL is recovered consistently across the app.
const API = `${ROOT_API}/public`;

export default function PublicApplication() {
  const [searchParams] = useSearchParams();
  // Referral ref arrives either as a query (`/apply?ref=john-doe`) or, on the
  // dedicated apply domain, as a short path (`apply.example.com/ref=john-doe`).
  const pathRef = useMemo(() => {
    if (typeof window === "undefined") return null;
    const m = window.location.pathname.match(/(?:^|\/)ref=([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }, []);
  const referrerId = searchParams.get("ref") || pathRef;
  const [step, setStep] = useState(0);
  const [app, setApp] = useState(() => emptyApplication());
  const [courses, setCourses] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [referrer, setReferrer] = useState(null);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Student Application Form";
    // Swap the favicon → application-form icon on /apply, restore on unmount.
    const iconEl = document.querySelector('link[rel="icon"]');
    const appleEl = document.querySelector('link[rel="apple-touch-icon"]');
    const prevIcon = iconEl?.getAttribute("href");
    const prevApple = appleEl?.getAttribute("href");
    const applyIcon = "/application-form-icon.png";
    if (iconEl) iconEl.setAttribute("href", applyIcon);
    if (appleEl) appleEl.setAttribute("href", applyIcon);
    // Force light theme on the public /apply route regardless of the
    // caller's stored preference or OS setting — an admin who left the
    // portal in dark mode shouldn't leak that theme into a student's
    // application form. Restore whatever theme was active on unmount.
    // Because ThemeProvider (a parent) reapplies the class in its own
    // effect after mount, we observe the root element and strip `dark`
    // any time it's re-added while /apply is mounted.
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    // Also override the browser-level color-scheme so native form controls
    // (date pickers, scrollbars) render in light mode too.
    const prevColorScheme = root.style.colorScheme;
    root.style.colorScheme = "light";
    const themeObserver = new MutationObserver(() => {
      if (root.classList.contains("dark")) root.classList.remove("dark");
      if (root.style.colorScheme !== "light") root.style.colorScheme = "light";
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
    axios.get(`${API}/courses`)
      .then((r) => setCourses(r.data?.courses || []))
      .catch((err) => {
        console.error("[apply] courses fetch failed:", err?.message || err);
        setCourses([]);
      });
    axios.get(`${API}/colleges`)
      .then((r) => setColleges(r.data?.colleges || []))
      .catch((err) => {
        console.error("[apply] colleges fetch failed:", err?.message || err);
        setColleges([]);
      });
    return () => {
      document.title = prevTitle;
      if (iconEl && prevIcon) iconEl.setAttribute("href", prevIcon);
      if (appleEl && prevApple) appleEl.setAttribute("href", prevApple);
      themeObserver.disconnect();
      if (wasDark) root.classList.add("dark");
      root.style.colorScheme = prevColorScheme;
    };
  }, []);

  // If the form was opened via a referral link (?ref=<client_id>), fetch the
  // referrer details and pre-fill (+ lock) the Reference section so the
  // applicant can't accidentally change attribution.
  useEffect(() => {
    if (!referrerId) return;
    let cancelled = false;
    axios.get(`${API}/referrer/${encodeURIComponent(referrerId)}`)
      .then(({ data }) => {
        if (cancelled) return;
        setReferrer(data);
        setApp((prev) => ({
          ...prev,
          reference: {
            ...prev.reference,
            name: data.name || prev.reference.name,
            contact_number: data.contact_number || prev.reference.contact_number,
          },
        }));
      })
      .catch((err) => {
        console.error("[apply] referrer fetch failed:", err?.message || err);
        // Stay silent — applicant can still fill the form manually.
      });
    return () => { cancelled = true; };
  }, [referrerId]);

  const stepKey = STEPS[step].key;
  const setField = (section, key, value) => setApp((prev) => ({
    ...prev, [section]: { ...prev[section], [key]: value },
  }));
  const setNested = (section, sub, key, value) => setApp((prev) => ({
    ...prev, [section]: { ...prev[section], [sub]: { ...prev[section][sub], [key]: value } },
  }));

  const next = () => {
    const errors = validateStep(stepKey, app);
    if (errors.length) { errors.forEach((e) => toast.error(e)); return; }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const prev = () => { setStep((s) => Math.max(s - 1, 0)); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const submit = async () => {
    // Final validation across every step (each step's own rules are re-run).
    for (const s of STEPS) {
      const errs = validateStep(s.key, app);
      if (errs.length) { errs.forEach((e) => toast.error(e)); setStep(STEPS.findIndex((x) => x.key === s.key)); return; }
    }
    setSubmitting(true);
    try {
      const payload = {
        ...app,
        referrer_id: referrer?.id || referrerId || null,
        payment: {
          ...app.payment,
          registration_amount: parseFloat(app.payment.registration_amount) || 0,
        },
      };
      const { data } = await axios.post(`${API}/applications`, payload);
      setSubmitted(data);
      toast.success("Application submitted!");
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Submission failed";
      toast.error(typeof msg === "string" ? msg : "Submission failed");
      console.error("[apply] submit failed:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) return <SubmittedView submitted={submitted} app={app} onAgain={() => { setSubmitted(null); setApp(emptyApplication()); setStep(0); }} />;

  const submitDisabled = submitting || !app.declaration?.agreement_accepted;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50/40 to-white dark:from-stone-950 dark:via-stone-950 dark:to-stone-900 py-6 sm:py-8 px-3 sm:px-4">
      <Toaster position="top-center" richColors />
      <div className="max-w-3xl mx-auto" data-testid="public-apply-page">
        <header className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 text-xs font-medium mb-3">
            <Sparkle size={12} weight="fill" /> Online Admission · 2026 intake
          </div>
          <h1 className="font-display text-2xl sm:text-4xl tracking-tight text-foreground leading-tight">Student Application Form</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-2 px-2">Six quick steps · about 5 minutes</p>
        </header>

        {referrer && (
          <div
            data-testid="referrer-banner"
            className="mb-4 rounded-lg border border-amber-200/70 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 p-3 flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-full bg-amber-gradient text-white text-sm font-semibold flex items-center justify-center shrink-0">
              {(referrer.name || "?")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400 font-semibold">Referred by</p>
              <p className="text-sm font-medium text-foreground truncate">{referrer.name}</p>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-card text-muted-foreground shrink-0">
              <LockSimple size={11} weight="duotone" /> auto-tagged
            </span>
          </div>
        )}

        <Stepper step={step} setStep={setStep} app={app} />

        <Card className="p-5 sm:p-8 border border-border bg-card rounded-xl shadow-lg shadow-amber-500/5">
          {stepKey === "basic_info" && <StepBasic app={app} setField={setField} />}
          {stepKey === "course" && <StepCourse app={app} setField={setField} courses={courses} colleges={colleges} />}
          {stepKey === "communication" && <StepCommunication app={app} setField={setField} />}
          {stepKey === "academic" && <StepAcademic app={app} setNested={setNested} />}
          {stepKey === "payment" && <StepPayment app={app} setField={setField} referrer={referrer} />}
          {stepKey === "declaration" && <StepDeclaration app={app} setField={setField} />}

          <div className="mt-8 flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
            <Button type="button" variant="outline" onClick={prev} disabled={step === 0} data-testid="apply-prev" className="w-full sm:w-auto">
              <ArrowLeft size={14} className="mr-1.5" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={next} className="btn-amber border-0 w-full sm:w-auto" data-testid="apply-next">
                Continue <ArrowRight size={14} className="ml-1.5" />
              </Button>
            ) : (
              <Button type="button" onClick={submit} disabled={submitDisabled} className="btn-amber border-0 w-full sm:w-auto" data-testid="apply-submit">
                {submitting ? "Submitting…" : "Submit application"}
                <CheckCircle size={14} className="ml-1.5" />
              </Button>
            )}
          </div>
        </Card>

        <p className="text-[11px] sm:text-xs text-center text-muted-foreground mt-6 px-4">
          Your details are private and will only be reviewed by the admissions team.
        </p>
      </div>
    </div>
  );
}

// ---- Stepper ----
function Stepper({ step, setStep }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-0.5 sm:gap-2" data-testid="apply-stepper">
        {STEPS.map((s, i) => {
          const Icon = ICONS[s.icon];
          const done = i < step;
          const active = i === step;
          return (
            <React.Fragment key={s.key}>
              <button
                type="button"
                onClick={() => i <= step && setStep(i)}
                disabled={i > step}
                data-testid={`stepper-${s.key}`}
                className={`flex flex-col items-center gap-1 group min-w-0 shrink-0 ${i > step ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all border-2 ${
                  active ? "bg-amber-gradient text-white border-amber-500 shadow-md shadow-amber-500/30 scale-110"
                  : done ? "bg-emerald-500 text-white border-emerald-500"
                  : "bg-card text-muted-foreground border-border"
                }`}>
                  {done ? <CheckCircle size={14} weight="fill" /> : <Icon size={14} weight="duotone" />}
                </div>
                <span className={`text-[9px] sm:text-xs leading-tight text-center max-w-[60px] sm:max-w-none truncate ${
                  active ? "text-foreground font-medium" : "text-muted-foreground"
                }`}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mb-5 ${i < step ? "bg-emerald-500" : "bg-border"}`} />}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ---- Step 1: Basic ----
function StepBasic({ app, setField }) {
  const f = app.basic_info;
  return (
    <div>
      <SectionTitle eyebrow="Section A" title="Candidate Details" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Student Full Name" required>
          <Input value={f.student_full_name} onChange={(e) => setField("basic_info", "student_full_name", e.target.value)} placeholder="As per Aadhaar / school records" data-testid="bi-name" />
        </Field>
        <Field label="Mobile Number" required>
          <Input value={f.mobile_number} onChange={(e) => setField("basic_info", "mobile_number", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile" data-testid="bi-mobile" />
        </Field>
        <Field label="Email ID" required>
          <Input type="email" value={f.email} onChange={(e) => setField("basic_info", "email", e.target.value)} placeholder="you@example.com" data-testid="bi-email" />
        </Field>
        <Field label="Date of Birth" required>
          <Input type="date" value={f.date_of_birth} onChange={(e) => setField("basic_info", "date_of_birth", e.target.value)} data-testid="bi-dob" />
        </Field>
        <Field label="Gender" required>
          <Select value={f.gender} onValueChange={(v) => setField("basic_info", "gender", v)}>
            <SelectTrigger data-testid="bi-gender"><SelectValue /></SelectTrigger>
            <SelectContent>{GENDERS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Aadhaar Number">
          <Input value={f.aadhaar_number} onChange={(e) => setField("basic_info", "aadhaar_number", e.target.value)} placeholder="XXXX-XXXX-XXXX" data-testid="bi-aadhaar" />
        </Field>
        <Field label="Nationality">
          <Input value={f.nationality} onChange={(e) => setField("basic_info", "nationality", e.target.value)} data-testid="bi-nationality" />
        </Field>
        <Field label="Religion">
          <Input value={f.religion} onChange={(e) => setField("basic_info", "religion", e.target.value)} placeholder="Optional" data-testid="bi-religion" />
        </Field>
        <Field label="Caste">
          <Input value={f.caste} onChange={(e) => setField("basic_info", "caste", e.target.value)} placeholder="Optional" data-testid="bi-caste" />
        </Field>
      </div>
    </div>
  );
}

// ---- Step 2: Course ----
function StepCourse({ app, setField, courses, colleges }) {
  const f = app.course;
  // Strict 3-step cascade: City → College → Course.
  //   • City must be picked first; the College dropdown is locked until then.
  //   • College must be picked next; the Course dropdown is locked until then.
  //   • Course list comes from the selected college's catalogue ONLY.
  const collegesAvailable = (colleges?.length || 0) > 0;
  const selectedCollege = (colleges || []).find((c) => c.name === f.preferred_college);
  const collegeCourses = (selectedCollege?.courses || []).filter(Boolean);
  // Fallback path (unauthenticated /api/colleges/public returned empty):
  // there is no per-college catalogue to enforce, so allow the global list and
  // skip the city/college locks (we don't have the data to enforce them).
  const courseOptions = collegesAvailable ? collegeCourses : courses;
  // Place filter narrows the College dropdown to one city.
  const [place, setPlace] = React.useState(() => {
    if (!selectedCollege?.place) return "";
    const norm = normalizePlace(selectedCollege.place);
    return COLLEGE_PLACES.includes(norm) ? norm : "";
  });
  const collegeLocked = collegesAvailable && !place;
  const courseLocked = collegesAvailable && !selectedCollege;
  return (
    <div>
      <SectionTitle eyebrow="Section B" title="Course & Admission" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Place / City" required={collegesAvailable}>
          <Select
            value={place}
            onValueChange={(next) => {
              setPlace(next);
              // If current college isn't in the new place, clear college + course
              if (next && selectedCollege) {
                const cnorm = normalizePlace(selectedCollege.place || "");
                if (cnorm.toLowerCase() !== next.toLowerCase()) {
                  setField("course", "preferred_college", "");
                  setField("course", "interested_course", "");
                }
              }
            }}
          >
            <SelectTrigger data-testid="co-place"><SelectValue placeholder="Select a city" /></SelectTrigger>
            <SelectContent>
              {COLLEGE_PLACES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Preferred College" required={collegesAvailable}>
          {collegesAvailable ? (
            <CollegeSelect
              value={f.preferred_college}
              onChange={(name) => {
                setField("course", "preferred_college", name);
                // Reset the course if the new college doesn't offer it
                const nextCollege = (colleges || []).find((c) => c.name === name);
                if (nextCollege && f.interested_course && !(nextCollege.courses || []).includes(f.interested_course)) {
                  setField("course", "interested_course", "");
                }
              }}
              testid="co-college"
              placeholder={collegeLocked ? "Select a city first" : `Pick a college in ${place}`}
              colleges={colleges}
              placeFilter={place}
              disabled={collegeLocked}
            />
          ) : (
            <Select value={f.preferred_college} onValueChange={(v) => setField("course", "preferred_college", v)}>
              <SelectTrigger data-testid="co-college"><SelectValue /></SelectTrigger>
              <SelectContent>{PARTNER_COLLEGES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Interested Course" required>
          <Select
            value={f.interested_course}
            onValueChange={(v) => setField("course", "interested_course", v)}
            disabled={courseLocked}
          >
            <SelectTrigger data-testid="co-course">
              <SelectValue placeholder={courseLocked ? "Select a college first" : "Pick a course"} />
            </SelectTrigger>
            <SelectContent>
              {courseOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground" data-testid="co-course-empty">
                  {collegesAvailable && selectedCollege
                    ? "No courses listed for this college yet."
                    : "No courses available."}
                </div>
              ) : (
                courseOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)
              )}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Academic Year">
          <Input value={f.academic_year} onChange={(e) => setField("course", "academic_year", e.target.value)} placeholder="e.g. 2026-2027" data-testid="co-year" />
        </Field>
        <Field label="Admission Type">
          <Select value={f.admission_type} onValueChange={(v) => setField("course", "admission_type", v)}>
            <SelectTrigger data-testid="co-type"><SelectValue /></SelectTrigger>
            <SelectContent>{ADMISSION_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
    </div>
  );
}

// ---- Step 3: Communication ----
function StepCommunication({ app, setField }) {
  const f = app.communication;
  return (
    <div>
      <SectionTitle eyebrow="Section C" title="Parents & Address" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Father's Name" required>
          <Input value={f.father_name} onChange={(e) => setField("communication", "father_name", e.target.value)} data-testid="cm-fname" />
        </Field>
        <Field label="Father's Mobile" required>
          <Input value={f.father_mobile} onChange={(e) => setField("communication", "father_mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile" data-testid="cm-fmob" />
        </Field>
        <Field label="Mother's Name">
          <Input value={f.mother_name} onChange={(e) => setField("communication", "mother_name", e.target.value)} data-testid="cm-mname" />
        </Field>
        <Field label="Mother's Mobile">
          <Input value={f.mother_mobile} onChange={(e) => setField("communication", "mother_mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile" data-testid="cm-mmob" />
        </Field>
        <Field label="Address Line 1" required wide>
          <Input value={f.address_line_1} onChange={(e) => setField("communication", "address_line_1", e.target.value)} placeholder="Door no, street" data-testid="cm-addr1" />
        </Field>
        <Field label="Address Line 2" wide>
          <Input value={f.address_line_2} onChange={(e) => setField("communication", "address_line_2", e.target.value)} placeholder="Area, landmark" data-testid="cm-addr2" />
        </Field>
        <Field label="City" required>
          <Input value={f.city} onChange={(e) => setField("communication", "city", e.target.value)} data-testid="cm-city" />
        </Field>
        <Field label="State" required>
          <Select value={f.state} onValueChange={(v) => setField("communication", "state", v)}>
            <SelectTrigger data-testid="cm-state"><SelectValue /></SelectTrigger>
            <SelectContent>{INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Pincode" required>
          <Input value={f.pincode} onChange={(e) => setField("communication", "pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit" data-testid="cm-pincode" />
        </Field>
      </div>
    </div>
  );
}

// ---- Step 4: Academic ----
function StepAcademic({ app, setNested }) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Section D" title="Academic Qualifications" subtitle="12th Standard Register Number is mandatory." />
      <QualificationBlock title="10th Standard" rec={app.academic.tenth} onChange={(k, v) => setNested("academic", "tenth", k, v)} prefix="ac-10" />
      <QualificationBlock title="12th Standard / Diploma" rec={app.academic.twelfth} onChange={(k, v) => setNested("academic", "twelfth", k, v)} prefix="ac-12" registerRequired />
    </div>
  );
}
function QualificationBlock({ title, rec, onChange, prefix, registerRequired }) {
  return (
    <div className="rounded-lg border border-border p-4 sm:p-5 bg-muted/20" data-testid={`${prefix}-block`}>
      <h3 className="font-display text-base mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Register Number" required={registerRequired}>
          <Input value={rec.register_number} onChange={(e) => onChange("register_number", e.target.value)} data-testid={`${prefix}-reg`} />
        </Field>
        <Field label="School Name"><Input value={rec.school_name} onChange={(e) => onChange("school_name", e.target.value)} data-testid={`${prefix}-school`} /></Field>
        <Field label="School Place"><Input value={rec.school_place} onChange={(e) => onChange("school_place", e.target.value)} data-testid={`${prefix}-place`} /></Field>
        <Field label="Board">
          <Select value={rec.board} onValueChange={(v) => onChange("board", v)}>
            <SelectTrigger data-testid={`${prefix}-board`}><SelectValue /></SelectTrigger>
            <SelectContent>{BOARDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Year of Passing"><Input value={rec.year_of_passing} onChange={(e) => onChange("year_of_passing", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="YYYY" data-testid={`${prefix}-year`} /></Field>
        <Field label="Percentage / CGPA"><Input value={rec.percentage} onChange={(e) => onChange("percentage", e.target.value)} placeholder="e.g. 92%" data-testid={`${prefix}-pct`} /></Field>
      </div>
    </div>
  );
}

// ---- Step 5: Payment & Reference ----
function StepPayment({ app, setField, referrer }) {
  const f = app.payment;
  const r = app.reference;
  const locked = !!referrer; // /apply?ref=<id> → reference is fixed
  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Section E"
        title="Registration Payment"
        subtitle="Optional — pay later by visiting the office. Status stays Pending until the accounts team verifies."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Registration Amount (₹)">
          <Input type="number" step="0.01" value={f.registration_amount} onChange={(e) => setField("payment", "registration_amount", e.target.value)} placeholder="0.00" data-testid="pa-amount" />
        </Field>
        <Field label="Payment Date">
          <Input type="date" value={f.payment_date} onChange={(e) => setField("payment", "payment_date", e.target.value)} data-testid="pa-date" />
        </Field>
      </div>

      <div className="pt-2 border-t border-border">
        <SectionTitle
          title="Reference / How did you hear about us?"
          subtitle={locked
            ? `Your application is attributed to ${referrer.name}.`
            : "Optional — helps us route your application faster."}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Reference Name">
            <Input
              value={r.name}
              onChange={(e) => setField("reference", "name", e.target.value)}
              placeholder="Person / office name"
              readOnly={locked}
              data-testid="rf-name"
              className={locked ? "bg-muted/40 cursor-not-allowed" : ""}
            />
          </Field>
          <Field label="Contact Number">
            <Input
              value={r.contact_number}
              onChange={(e) => setField("reference", "contact_number", e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit (optional)"
              readOnly={locked && !!r.contact_number}
              data-testid="rf-contact"
              className={locked && r.contact_number ? "bg-muted/40 cursor-not-allowed" : ""}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

// ---- Step 6: Declaration ----
function StepDeclaration({ app, setField }) {
  const collegeName = (app.course?.preferred_college || "").trim();
  const text = renderDeclaration(collegeName);
  const paragraphs = text.split("\n\n");
  return (
    <div>
      <SectionTitle eyebrow="Section F" title="Declaration" subtitle="Please read carefully and tick the box to submit." />
      <div className="rounded-lg border border-border bg-muted/20 p-4 sm:p-5 text-sm leading-relaxed text-foreground" data-testid="declaration-text">
        {paragraphs.map((p, i) => (
          <p key={`para-${p.slice(0, 24)}-${i}`} className={i > 0 ? "mt-3" : ""}>{p}</p>
        ))}
        {!collegeName && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            Tip · Go back to Section B and pick your preferred college so the declaration includes its name automatically.
          </p>
        )}
      </div>
      <label className="mt-5 flex items-start gap-3 cursor-pointer select-none" data-testid="declaration-checkbox-row">
        <Checkbox
          checked={!!app.declaration?.agreement_accepted}
          onCheckedChange={(v) => setField("declaration", "agreement_accepted", !!v)}
          data-testid="declaration-checkbox"
          className="mt-0.5"
        />
        <span className="text-sm leading-relaxed text-foreground">
          <span className="font-semibold">I Agree</span>
          <span className="text-muted-foreground"> — I have read the declaration and confirm that all details I provided are true to the best of my knowledge.</span>
        </span>
      </label>
      {!app.declaration?.agreement_accepted && (
        <p className="mt-3 text-xs text-muted-foreground">Submit will be enabled once you tick the I Agree box.</p>
      )}
    </div>
  );
}

// ---- Submitted view ----
function SubmittedView({ submitted, app, onAgain }) {
  const copy = () => { navigator.clipboard.writeText(submitted.reference_code); toast.success("Reference code copied"); };
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-amber-50/40 to-white dark:from-stone-950 dark:via-stone-950 dark:to-stone-900 flex items-center px-4 py-12">
      <Toaster position="top-center" richColors />
      <Card className="max-w-md mx-auto p-8 text-center border border-border bg-card rounded-xl shadow-xl" data-testid="apply-success">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mb-4">
          <CheckCircle size={32} weight="fill" />
        </div>
        <h2 className="font-display text-2xl">Application received!</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          Thanks {app.basic_info.student_full_name.split(" ")[0]} — our admissions team will reach out at <span className="text-foreground font-medium">{app.basic_info.mobile_number}</span> within 1–2 working days.
        </p>
        <div className="mt-5 p-3 rounded-lg bg-muted/40 border border-border" data-testid="apply-ref-code">
          <p className="label-eyebrow">Your reference code</p>
          <div className="flex items-center justify-center gap-2 mt-1">
            <span className="font-display text-xl tabular-nums tracking-wider">{submitted.reference_code}</span>
            <button onClick={copy} className="text-muted-foreground hover:text-foreground"><Copy size={14} /></button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">Quote this on any follow-up call.</p>
        </div>
        <Button variant="outline" className="mt-6" onClick={onAgain} data-testid="apply-again">Submit another application</Button>
      </Card>
    </div>
  );
}

// ---- Helpers ----
function SectionTitle({ eyebrow, title, subtitle }) {
  return (
    <div className="mb-5">
      {eyebrow && <p className="label-eyebrow">{eyebrow}</p>}
      <h2 className="font-display text-lg sm:text-2xl mt-1 leading-tight">{title}</h2>
      {subtitle && <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{subtitle}</p>}
    </div>
  );
}
function Field({ label, required, wide, children }) {
  return (
    <div className={wide ? "sm:col-span-2 min-w-0" : "min-w-0"}>
      <Label className="text-xs">{label}{required && <span className="text-rose-600 ml-0.5">*</span>}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

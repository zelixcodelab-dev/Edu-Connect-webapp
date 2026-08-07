import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, CheckCircle, User, Books, Phone, GraduationCap, Sparkle,
} from "@phosphor-icons/react";
import CollegeSelect from "@/components/CollegeSelect";
import { COLLEGE_PLACES } from "@/lib/places";

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

function Field({ label, children, required, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {label} {required && <span className="text-rose-500">*</span>}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SectionHead({ icon: Icon, title, eyebrow }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="w-8 h-8 rounded-md bg-amber-gradient-soft border border-amber-500/30 flex items-center justify-center">
        <Icon size={15} className="text-amber-700 dark:text-amber-400" />
      </span>
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">{eyebrow}</p>
        <h3 className="font-display text-base font-semibold leading-tight">{title}</h3>
      </div>
    </div>
  );
}

/** Multi-section editable review form for parsed application data.
 * The parent dialog owns `parsed` and the field setters; this component
 * just renders the 4 sections + footer with Back / Cancel / Save.
 */
export default function PasteReviewStep({
  parsed, setBI, setCO, setCM, setAC,
  pastePlace, setPastePlace,
  fieldCount, unmatched, saving,
  onBack, onCancel, onSave,
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-500/30 bg-amber-gradient-soft p-3 flex items-start gap-2.5">
        <Sparkle size={16} weight="fill" className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="text-xs text-foreground">
          <strong>{fieldCount} fields auto-detected.</strong> Review each section, edit anything that looks off, then click <strong>Save as Inquiry</strong>.
          The student will land in the Students page with full application data — you can convert to Enrolled later.
        </div>
      </div>

      {/* Section A — Basic info */}
      <div>
        <SectionHead icon={User} eyebrow="Section A" title="Candidate" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Student name" required wide>
            <Input value={parsed.basic_info.student_full_name} onChange={(e) => setBI("student_full_name", e.target.value)} data-testid="pa-name" />
          </Field>
          <Field label="Mobile" required>
            <Input value={parsed.basic_info.mobile_number} onChange={(e) => setBI("mobile_number", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit" data-testid="pa-mobile" />
          </Field>
          <Field label="Email" required>
            <Input type="email" value={parsed.basic_info.email} onChange={(e) => setBI("email", e.target.value)} data-testid="pa-email" />
          </Field>
          <Field label="Date of birth" required>
            <Input type="date" value={parsed.basic_info.date_of_birth} onChange={(e) => setBI("date_of_birth", e.target.value)} data-testid="pa-dob" />
          </Field>
          <Field label="Gender">
            <Select value={parsed.basic_info.gender || "male"} onValueChange={(v) => setBI("gender", v)}>
              <SelectTrigger data-testid="pa-gender"><SelectValue /></SelectTrigger>
              <SelectContent>{GENDERS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Aadhaar number">
            <Input value={parsed.basic_info.aadhaar_number} onChange={(e) => setBI("aadhaar_number", e.target.value)} data-testid="pa-aadhaar" />
          </Field>
          <Field label="Nationality">
            <Input value={parsed.basic_info.nationality} onChange={(e) => setBI("nationality", e.target.value)} data-testid="pa-nationality" />
          </Field>
          <Field label="Religion">
            <Input value={parsed.basic_info.religion} onChange={(e) => setBI("religion", e.target.value)} data-testid="pa-religion" />
          </Field>
          <Field label="Caste">
            <Input value={parsed.basic_info.caste} onChange={(e) => setBI("caste", e.target.value)} data-testid="pa-caste" />
          </Field>
        </div>
      </div>

      {/* Section B — Course */}
      <div>
        <SectionHead icon={Books} eyebrow="Section B" title="Course" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Place / City">
            <Select
              value={pastePlace || "_all"}
              onValueChange={(v) => setPastePlace(v === "_all" ? "" : v)}
            >
              <SelectTrigger data-testid="pa-place"><SelectValue placeholder="Any city" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Any city</SelectItem>
                {COLLEGE_PLACES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Preferred college">
            <CollegeSelect
              value={parsed.course.preferred_college}
              onChange={(name) => setCO("preferred_college", name)}
              testid="pa-college"
              placeholder={pastePlace ? `Pick a college in ${pastePlace}` : "Pick a college"}
              placeFilter={pastePlace}
            />
          </Field>
          <Field label="Interested course" required>
            <Input value={parsed.course.interested_course} onChange={(e) => setCO("interested_course", e.target.value)} data-testid="pa-course" />
          </Field>
          <Field label="Academic year">
            <Input value={parsed.course.academic_year} onChange={(e) => setCO("academic_year", e.target.value)} placeholder="e.g. 2026-2027" data-testid="pa-year" />
          </Field>
          <Field label="Admission type">
            <Select value={parsed.course.admission_type || "management"} onValueChange={(v) => setCO("admission_type", v)}>
              <SelectTrigger data-testid="pa-admtype"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="management">Management</SelectItem>
                <SelectItem value="government">Government</SelectItem>
                <SelectItem value="merit">Merit</SelectItem>
                <SelectItem value="lateral_entry">Lateral Entry</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      {/* Section C — Parents & Address */}
      <div>
        <SectionHead icon={Phone} eyebrow="Section C" title="Parents & Address" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Father's name" required>
            <Input value={parsed.communication.father_name} onChange={(e) => setCM("father_name", e.target.value)} data-testid="pa-fname" />
          </Field>
          <Field label="Father's mobile" required>
            <Input value={parsed.communication.father_mobile} onChange={(e) => setCM("father_mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} data-testid="pa-fmob" />
          </Field>
          <Field label="Mother's name">
            <Input value={parsed.communication.mother_name} onChange={(e) => setCM("mother_name", e.target.value)} data-testid="pa-mname" />
          </Field>
          <Field label="Mother's mobile">
            <Input value={parsed.communication.mother_mobile} onChange={(e) => setCM("mother_mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} data-testid="pa-mmob" />
          </Field>
          <Field label="Address line 1" required wide>
            <Input value={parsed.communication.address_line_1} onChange={(e) => setCM("address_line_1", e.target.value)} data-testid="pa-addr1" />
          </Field>
          <Field label="Address line 2" wide>
            <Input value={parsed.communication.address_line_2} onChange={(e) => setCM("address_line_2", e.target.value)} data-testid="pa-addr2" />
          </Field>
          <Field label="City" required>
            <Input value={parsed.communication.city} onChange={(e) => setCM("city", e.target.value)} data-testid="pa-city" />
          </Field>
          <Field label="State">
            <Input value={parsed.communication.state} onChange={(e) => setCM("state", e.target.value)} data-testid="pa-state" />
          </Field>
          <Field label="Pincode" required>
            <Input value={parsed.communication.pincode} onChange={(e) => setCM("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} data-testid="pa-pincode" />
          </Field>
        </div>
      </div>

      {/* Section D — Academic */}
      <div>
        <SectionHead icon={GraduationCap} eyebrow="Section D" title="Academic" />
        <div className="space-y-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">10th Standard</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Register no.">
                <Input value={parsed.academic.tenth.register_number} onChange={(e) => setAC("tenth", "register_number", e.target.value)} data-testid="pa-10-reg" />
              </Field>
              <Field label="School name" wide>
                <Input value={parsed.academic.tenth.school_name} onChange={(e) => setAC("tenth", "school_name", e.target.value)} data-testid="pa-10-school" />
              </Field>
              <Field label="Percentage">
                <Input value={parsed.academic.tenth.percentage} onChange={(e) => setAC("tenth", "percentage", e.target.value)} placeholder="e.g. 80" data-testid="pa-10-mark" />
              </Field>
              <Field label="Board">
                <Input value={parsed.academic.tenth.board} onChange={(e) => setAC("tenth", "board", e.target.value)} data-testid="pa-10-board" />
              </Field>
              <Field label="Year of passing">
                <Input value={parsed.academic.tenth.year_of_passing} onChange={(e) => setAC("tenth", "year_of_passing", e.target.value)} data-testid="pa-10-year" />
              </Field>
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">+2 / 12th Standard</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Register no.">
                <Input value={parsed.academic.twelfth.register_number} onChange={(e) => setAC("twelfth", "register_number", e.target.value)} data-testid="pa-12-reg" />
              </Field>
              <Field label="School name" wide>
                <Input value={parsed.academic.twelfth.school_name} onChange={(e) => setAC("twelfth", "school_name", e.target.value)} data-testid="pa-12-school" />
              </Field>
              <Field label="Percentage">
                <Input value={parsed.academic.twelfth.percentage} onChange={(e) => setAC("twelfth", "percentage", e.target.value)} data-testid="pa-12-mark" />
              </Field>
              <Field label="Board">
                <Input value={parsed.academic.twelfth.board} onChange={(e) => setAC("twelfth", "board", e.target.value)} data-testid="pa-12-board" />
              </Field>
              <Field label="Year of passing">
                <Input value={parsed.academic.twelfth.year_of_passing} onChange={(e) => setAC("twelfth", "year_of_passing", e.target.value)} data-testid="pa-12-year" />
              </Field>
            </div>
          </div>
        </div>
      </div>

      {unmatched.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 p-3 text-xs" data-testid="paste-unmatched">
          <p className="font-semibold text-amber-800 dark:text-amber-300 mb-1.5">Could not auto-map these lines:</p>
          <ul className="space-y-0.5 text-foreground/80">
            {unmatched.slice(0, 6).map((u, i) => <li key={`um-${i}`}>• {u}</li>)}
            {unmatched.length > 6 && <li className="text-muted-foreground">…and {unmatched.length - 6} more</li>}
          </ul>
        </div>
      )}

      <DialogFooter className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          data-testid="paste-back-btn"
        >
          <ArrowLeft size={14} className="mr-1.5" /> Back to paste
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="btn-amber border-0"
          data-testid="paste-save-btn"
        >
          <CheckCircle size={14} className="mr-1.5" /> {saving ? "Saving…" : "Save as Inquiry"}
        </Button>
      </DialogFooter>
    </div>
  );
}

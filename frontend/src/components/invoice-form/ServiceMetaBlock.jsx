import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link as LinkIcon, CaretDown, MagnifyingGlass, Student as StudentIcon, Check, X } from "@phosphor-icons/react";
import { formatMoney, formatDate } from "@/lib/format";

// Derive an Indian-style academic year ("2026-27") from an enrollment date.
// Admissions from June onwards belong to the year that starts that June.
function deriveAcademicYear(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const start = d.getMonth() >= 5 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function StudentPicker({ value, onChange, onPick, students, clientName }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = (q || "").trim().toLowerCase();
    if (!term) return students;
    return students.filter((s) =>
      (s.name || "").toLowerCase().includes(term)
      || (s.course || "").toLowerCase().includes(term)
      || (s.college || "").toLowerCase().includes(term)
    );
  }, [students, q]);

  const clear = (e) => { e.stopPropagation(); onChange(""); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="inv-student"
          className="w-full h-10 px-3 rounded-md border border-input bg-card text-sm flex items-center justify-between gap-2 hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0 flex-1">
            <StudentIcon size={14} className="text-muted-foreground/70 shrink-0" />
            <span className={`truncate ${value ? "text-foreground" : "text-muted-foreground"}`}>
              {value || "Pick or type a student"}
            </span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {value && (
              <span
                role="button"
                tabIndex={0}
                onClick={clear}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") clear(e); }}
                className="text-muted-foreground hover:text-foreground p-0.5"
                aria-label="Clear"
                data-testid="inv-student-clear"
              >
                <X size={12} />
              </span>
            )}
            <CaretDown size={14} className="text-muted-foreground/70" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[260px]" align="start">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => { setQ(e.target.value); onChange(e.target.value); }}
              placeholder="Search or type a name…"
              className="pl-8 h-8 text-sm"
              data-testid="inv-student-search"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto" data-testid="inv-student-list">
          {!clientName ? (
            <p className="px-3 py-5 text-xs text-muted-foreground text-center">Select a client first to see their referred students.</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-5 text-xs text-muted-foreground text-center">
              {students.length === 0 ? `No students referred by ${clientName} yet.` : "No matches."}
            </p>
          ) : (
            filtered.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => { onPick(s); setOpen(false); setQ(""); }}
                data-testid={`inv-student-opt-${s.id}`}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-orange-500/10 hover:text-orange-700 dark:hover:text-orange-300 transition-colors flex items-start gap-2 ${value === s.name ? "bg-orange-50/60 dark:bg-orange-500/10" : ""}`}
              >
                <StudentIcon size={14} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{s.name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {[s.course, s.college].filter(Boolean).join(" · ") || "No course / college on file"}
                  </span>
                </span>
                {value === s.name && <Check size={14} className="text-orange-600 shrink-0 mt-0.5" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function ServiceMetaBlock({ form, setForm, openCredits, currency, referredStudents = [], clientName = "" }) {
  const linkedVisit = openCredits.find((v) => v.id === form.linked_visit_invoice_id);

  const pickStudent = (s) => {
    setForm({
      ...form,
      student_name: s.name || "",
      course: s.course || form.course,
      college: s.college || form.college,
      academic_year: deriveAcademicYear(s.enrollment_date) || form.academic_year,
    });
  };

  return (
    <div className="rounded-md border border-border p-4 space-y-3" data-testid="service-meta">
      <p className="label-eyebrow">Service Charge towards</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Student Name</Label>
          <StudentPicker
            value={form.student_name}
            onChange={(v) => setForm({ ...form, student_name: v })}
            onPick={pickStudent}
            students={referredStudents}
            clientName={clientName}
          />
        </div>
        <div><Label>Course</Label><Input value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} placeholder="e.g. B.Tech CSE" data-testid="inv-course" /></div>
        <div><Label>College</Label><Input value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} placeholder="e.g. IIT Delhi" data-testid="inv-college" /></div>
        <div><Label>Academic Year</Label><Input value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} placeholder="e.g. 2026-27" data-testid="inv-academic-year" /></div>
      </div>

      <div className="border-t border-border pt-3 mt-2">
        <Label className="flex items-center gap-1.5"><LinkIcon size={14} /> Link to a campus visit (optional)</Label>
        {openCredits.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1.5" data-testid="no-open-credits">
            {form.client_id ? "No campus-visit invoices with open balance for this client." : "Pick a client to see their open campus visits."}
          </p>
        ) : (
          <>
            <Select
              value={form.linked_visit_invoice_id || "_none"}
              onValueChange={(v) => {
                if (v === "_none") {
                  setForm({ ...form, linked_visit_invoice_id: null });
                } else {
                  const picked = openCredits.find((c) => c.id === v);
                  setForm({
                    ...form,
                    linked_visit_invoice_id: v,
                    credit_amount: picked ? picked.remaining_credit : form.credit_amount,
                  });
                }
              }}
            >
              <SelectTrigger data-testid="inv-linked-visit"><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">None — no linked visit</SelectItem>
                {openCredits.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.invoice_number}
                    {v.student_name ? ` · ${v.student_name}` : ""}
                    {" · "}remaining {formatMoney(v.remaining_credit, currency)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {linkedVisit && (
              <p className="text-xs text-muted-foreground mt-1.5" data-testid="linked-visit-hint">
                {linkedVisit.invoice_number} · {formatDate(linkedVisit.issue_date)} · pending {formatMoney(linkedVisit.remaining_credit, currency)} of {formatMoney(linkedVisit.total, currency)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

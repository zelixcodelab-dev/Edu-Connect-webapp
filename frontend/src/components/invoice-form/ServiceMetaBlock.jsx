import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link as LinkIcon } from "@phosphor-icons/react";
import { formatMoney, formatDate } from "@/lib/format";

export default function ServiceMetaBlock({ form, setForm, openCredits, currency }) {
  const linkedVisit = openCredits.find((v) => v.id === form.linked_visit_invoice_id);
  return (
    <div className="rounded-md border border-border p-4 space-y-3" data-testid="service-meta">
      <p className="label-eyebrow">Service Charge towards</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>Student Name</Label><Input value={form.student_name} onChange={(e) => setForm({ ...form, student_name: e.target.value })} placeholder="Full name" data-testid="inv-student" /></div>
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

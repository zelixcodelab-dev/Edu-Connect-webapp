import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, GraduationCap, Coins, HourglassMedium, Student as StudentIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const STATUS_META = {
  inquiry: { label: "Inquiry", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  enrolled: { label: "Enrolled", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  completed: { label: "Completed", cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  cancelled: { label: "Cancelled", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
};

const STATUS_OPTIONS = [
  { value: "inquiry", label: "Inquiry" },
  { value: "enrolled", label: "Enrolled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const emptyForm = { name: "", course: "", college: "", status: "inquiry" };

function Tile({ icon: Icon, label, value, tone }) {
  return (
    <Card className="p-5 border border-border bg-card rounded-lg shadow-none" data-testid={`staff-tile-${label.replace(/\W+/g, "-").toLowerCase()}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={16} weight="duotone" className={tone} />
        <p className="label-eyebrow">{label}</p>
      </div>
      <p className={`font-display text-2xl mt-2 tabular-nums ${tone}`}>{value}</p>
    </Card>
  );
}

export default function StaffStudents() {
  const [data, setData] = useState({ students: [], totals: {}, incentive_amount: 0 });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/students/me/referral-summary");
      setData(data);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not load your students");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("add") === "1") {
      setForm(emptyForm);
      setOpen(true);
      params.delete("add");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Student name is required"); return; }
    setSaving(true);
    try {
      await api.post("/students/me/quick-add", {
        name: form.name.trim(),
        course: form.course.trim(),
        college: form.college.trim(),
        status: form.status,
      });
      toast.success("Student added");
      setOpen(false); setForm(emptyForm); load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not add student");
    } finally { setSaving(false); }
  };

  const t = data.totals || {};
  const students = data.students || [];

  return (
    <div className="space-y-6 animate-fade-in" data-testid="staff-students-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">My referrals</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Students</h1>
          <p className="text-sm text-muted-foreground mt-1">Everyone you've referred or enrolled.</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setOpen(true); }} data-testid="staff-add-student-btn" className="h-10 btn-amber border-0">
          <Plus size={16} className="mr-1.5" /> Add student
        </Button>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile icon={GraduationCap} label="Students admitted" value={t.students_count ?? 0} tone="text-orange-600 dark:text-orange-400" />
        <Tile icon={Coins} label="Incentive earned" value={inr(t.incentive_earned)} tone="text-emerald-600 dark:text-emerald-400" />
        <Tile icon={HourglassMedium} label="Incentive pending" value={inr(t.incentive_pending)} tone="text-amber-600 dark:text-amber-400" />
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Incentive of {inr(data.incentive_amount)}/admission is unlocked once you hit 3+ admissions in a calendar month.
      </p>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
      ) : students.length === 0 ? (
        <Card className="py-16 text-center border border-border shadow-none" data-testid="staff-students-empty">
          <StudentIcon size={40} className="mx-auto text-muted-foreground mb-3" weight="duotone" />
          <p className="text-foreground font-medium">No students yet</p>
          <p className="text-sm text-muted-foreground mt-1">Use “Add student” to enroll your first one.</p>
        </Card>
      ) : (
        <Card className="border border-border bg-card rounded-lg shadow-none overflow-hidden" data-testid="staff-students-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Course</th>
                  <th className="px-4 py-3 font-medium">College</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Enrolled</th>
                  <th className="px-4 py-3 font-medium text-right">Incentive</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const meta = STATUS_META[s.status] || STATUS_META.inquiry;
                  return (
                    <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40" data-testid={`staff-student-${s.id}`}>
                      <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.course || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.college || "—"}</td>
                      <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span></td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">{s.enrollment_date ? new Date(s.enrollment_date).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        {s.incentive_eligible ? (
                          s.incentive_paid
                            ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Paid {inr(s.incentive_amount)}</span>
                            : <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">Due {inr(s.incentive_amount)}</span>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card max-w-md" data-testid="staff-add-student-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Add student</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">This student is credited to you.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div><Label>Student name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="qa-name" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Course</Label><Input value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} placeholder="e.g. BBA" data-testid="qa-course" /></div>
              <div><Label>College</Label><Input value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} placeholder="e.g. KM College" data-testid="qa-college" /></div>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="qa-status"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="btn-amber border-0" data-testid="qa-save">{saving ? "Adding…" : "Add student"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

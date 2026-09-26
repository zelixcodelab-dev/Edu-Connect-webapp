import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarPlus, Check, X, ArrowsClockwise, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AttendanceCalendar from "@/components/attendance/AttendanceCalendar";

const KIND_LABEL = { weekoff: "Week-off", leave: "Leave" };
const LEAVE_TYPES = ["casual", "sick", "earned"];

const STATUS_META = {
  pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  approved: { label: "Approved", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  rejected: { label: "Rejected", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
};

const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
const yesterdayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const thisMonthISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function ReqCard({ r, canDecide, onDecide, busy }) {
  const meta = STATUS_META[r.status] || STATUS_META.pending;
  return (
    <Card className="p-4" data-testid={`reg-card-${r.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {canDecide && <p className="font-medium text-foreground truncate">{r.user_name} <span className="text-xs text-muted-foreground">· {r.user_role === "office_admin" ? "Office Admin" : "Staff"}</span></p>}
          <p className={`text-sm ${canDecide ? "text-muted-foreground" : "text-foreground font-medium"}`}>
            {fmtDate(r.date)} → <span className="font-semibold">{KIND_LABEL[r.kind] || r.kind}{r.leave_type ? ` (${r.leave_type})` : ""}</span>
          </p>
          {r.reason && <p className="text-xs text-muted-foreground mt-1.5 bg-muted/40 rounded p-2">{r.reason}</p>}
          {r.status !== "pending" && r.approver_name && (
            <p className="text-[11px] text-muted-foreground mt-1.5">{meta.label} by {r.approver_name}{r.decision_note ? ` · "${r.decision_note}"` : ""}</p>
          )}
        </div>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${meta.cls}`} data-testid={`reg-status-${r.id}`}>{meta.label}</span>
      </div>
      {r.status === "pending" && canDecide && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" className="h-8 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy} onClick={() => onDecide(r, "approved")} data-testid={`reg-approve-${r.id}`}>
            <Check size={14} className="mr-1" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="h-8 flex-1 text-rose-600 hover:text-rose-700" disabled={busy} onClick={() => onDecide(r, "rejected")} data-testid={`reg-reject-${r.id}`}>
            <X size={14} className="mr-1" /> Reject
          </Button>
        </div>
      )}
    </Card>
  );
}

const CONVERT_LEAVE_TYPES = ["casual", "sick", "paid", "earned"];
const shiftMonth = (month, delta) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

// Admin-only: pick an employee, view their month-wise attendance, and convert
// any past day (e.g. a forgotten check-in shown as Absent) into Present /
// Week-off / Leave. Applied instantly and counts as paid.
function AdminEmployeeAttendance({ user, onChanged }) {
  const [staff, setStaff] = useState([]);
  const [uid, setUid] = useState("");
  const [month, setMonth] = useState(thisMonthISO());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState(null); // { date, rec, status, leave_type }

  useEffect(() => {
    api.get("/attendance/staff")
      .then(({ data }) => { setStaff(data); if (data.length && !uid) setUid(data[0].user_id); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRecords = useCallback(async () => {
    if (!uid) { setRecords([]); return; }
    setLoading(true);
    try {
      const { data } = await api.get(`/attendance?month=${month}&user_id=${uid}`);
      setRecords(data.records || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [uid, month]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const openConvert = (date, rec) => setDlg({ date, rec, status: "weekoff", leave_type: "casual" });

  const applyConvert = async () => {
    setBusy(true);
    try {
      await api.post("/attendance/admin/upsert", {
        user_id: uid,
        date: dlg.date,
        status: dlg.status,
        leave_type: dlg.status === "leave" ? dlg.leave_type : null,
      });
      toast.success("Day updated");
      setDlg(null);
      loadRecords();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const selected = staff.find((s) => s.user_id === uid);

  return (
    <Card className="p-5" data-testid="admin-emp-attendance">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground">Employee attendance</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Pick an employee, then tap any past day to convert it to Present, Week-off or Leave. Applied instantly — counts as paid.</p>
        </div>
        <Select value={uid} onValueChange={setUid}>
          <SelectTrigger className="w-full sm:w-64 h-10" data-testid="admin-emp-select"><SelectValue placeholder="Select employee" /></SelectTrigger>
          <SelectContent>
            {staff.map((s) => (
              <SelectItem key={s.user_id} value={s.user_id} data-testid={`admin-emp-opt-${s.user_id}`}>
                {s.name}{s.role === "office_admin" ? " · Office Admin" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-center gap-3 mb-4">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth((mo) => shiftMonth(mo, -1))} data-testid="admin-emp-prev"><CaretLeft size={15} /></Button>
        <span className="text-sm font-medium text-foreground min-w-[140px] text-center" data-testid="admin-emp-month">{monthLabel(month)}</span>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth((mo) => shiftMonth(mo, 1))} disabled={month >= thisMonthISO()} data-testid="admin-emp-next"><CaretRight size={15} /></Button>
      </div>

      {!uid ? (
        <p className="text-sm text-muted-foreground text-center py-6">No employees found.</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
      ) : (
        <AttendanceCalendar month={month} records={records} onPickDate={openConvert} />
      )}

      <Dialog open={!!dlg} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent data-testid="admin-convert-dialog">
          <DialogHeader><DialogTitle>Update {selected?.name || "employee"} · {fmtDate(dlg?.date)}</DialogTitle>
            <DialogDescription className="text-xs">Applied instantly. Week-off and paid leave count as paid days.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Mark day as</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {[["present", "Present"], ["weekoff", "Week-off"], ["leave", "Leave"], ["absent", "Absent"]].map(([k, lbl]) => (
                  <button
                    key={k}
                    onClick={() => setDlg((s) => ({ ...s, status: k }))}
                    data-testid={`admin-convert-${k}`}
                    className={`h-10 rounded-md border text-sm font-medium ${dlg?.status === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            {dlg?.status === "leave" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Leave type (paid)</label>
                <select
                  value={dlg.leave_type}
                  onChange={(e) => setDlg((s) => ({ ...s, leave_type: e.target.value }))}
                  data-testid="admin-convert-leave-type"
                  className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground capitalize"
                >
                  {CONVERT_LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button>
            <Button className="btn-amber" onClick={applyConvert} disabled={busy} data-testid="admin-convert-apply">Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Attendance regularization: staff/office-admin request a past-day fix
// (Absent → Week-off / Leave); admins approve. Approved days count as PAID.
export default function RegularizationPanel({ user }) {
  const isAdmin = user.role === "super_admin" || user.role === "office_admin";
  const canRequest = user.role === "staff" || user.role === "office_admin";
  const [rows, setRows] = useState([]);
  const [records, setRecords] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: yesterdayISO(), kind: "weekoff", leave_type: "casual", reason: "" });
  const [params, setParams] = useSearchParams();
  const month = thisMonthISO();

  // Optional deep-link: ?tab=regularize&date=YYYY-MM-DD auto-opens the dialog.
  useEffect(() => {
    const d = params.get("date");
    if (d && canRequest) {
      setForm((f) => ({ ...f, date: d }));
      setOpen(true);
      const next = new URLSearchParams(params);
      next.delete("date");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenChange = (v) => setOpen(v);

  // Clicking a past day in the calendar opens the request dialog prefilled.
  const pickDate = (date) => {
    setForm((f) => ({ ...f, date }));
    setOpen(true);
  };

  const load = useCallback(async () => {
    try {
      const reqs = { promise: api.get("/attendance/regularizations") };
      const [rq, rec] = await Promise.all([
        reqs.promise,
        canRequest ? api.get(`/attendance/me?month=${month}`) : Promise.resolve({ data: { records: [] } }),
      ]);
      setRows(rq.data.requests || []);
      setRecords(rec.data.records || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  }, [canRequest, month]);

  useEffect(() => { load(); }, [load]);

  const mine = useMemo(() => rows.filter((r) => r.user_id === user.id), [rows, user.id]);
  const inbox = useMemo(() => rows.filter((r) => r.status === "pending" && r.user_id !== user.id), [rows, user.id]);

  const submit = async () => {
    if (!form.date) return toast.error("Pick a date");
    setBusy(true);
    try {
      await api.post("/attendance/regularize", {
        date: form.date,
        kind: form.kind,
        leave_type: form.kind === "leave" ? form.leave_type : null,
        reason: form.reason,
      });
      toast.success("Request submitted for approval");
      handleOpenChange(false);
      setForm({ date: yesterdayISO(), kind: "weekoff", leave_type: "casual", reason: "" });
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (r, status) => {
    setBusy(true);
    try {
      await api.patch(`/attendance/regularizations/${r.id}`, { status });
      toast.success(status === "approved" ? "Approved — day marked paid" : "Rejected");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="regularization-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground">Fix a past day</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Convert an absent day into a Week-off or Leave. Approved days count as paid.</p>
        </div>
        {canRequest && (
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button className="btn-amber" data-testid="reg-new-btn"><CalendarPlus size={16} className="mr-1.5" /> New request</Button>
            </DialogTrigger>
            <DialogContent data-testid="reg-dialog">
              <DialogHeader><DialogTitle>Regularize a past day</DialogTitle>
                <DialogDescription className="text-xs">Convert an absent day into a Week-off or Leave. Sent for approval.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-1">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Date (past only)</label>
                  <input
                    type="date"
                    value={form.date}
                    max={yesterdayISO()}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    data-testid="reg-date"
                    className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Convert to</label>
                  <div className="mt-1 flex gap-2">
                    {["weekoff", "leave"].map((k) => (
                      <button
                        key={k}
                        onClick={() => setForm((f) => ({ ...f, kind: k }))}
                        data-testid={`reg-kind-${k}`}
                        className={`flex-1 h-10 rounded-md border text-sm font-medium ${form.kind === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                      >
                        {KIND_LABEL[k]}
                      </button>
                    ))}
                  </div>
                </div>
                {form.kind === "leave" && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Leave type</label>
                    <select
                      value={form.leave_type}
                      onChange={(e) => setForm((f) => ({ ...f, leave_type: e.target.value }))}
                      data-testid="reg-leave-type"
                      className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground capitalize"
                    >
                      {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Reason</label>
                  <Textarea
                    value={form.reason}
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="Why should this day be regularized?"
                    data-testid="reg-reason"
                    className="mt-1"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
                <Button className="btn-amber" onClick={submit} disabled={busy} data-testid="reg-submit">Submit</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isAdmin && <AdminEmployeeAttendance user={user} onChanged={load} />}

      {canRequest && (
        <Card className="p-5 sm:hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">My attendance · this month</h3>
            <span className="text-xs text-muted-foreground">{records.length} day{records.length !== 1 ? "s" : ""}</span>
          </div>
          <AttendanceCalendar month={month} records={records} onPickDate={pickDate} />
        </Card>
      )}

      {isAdmin && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1"><ArrowsClockwise size={13} /> Pending approvals</p>
          {inbox.length === 0 ? (
            <Card className="p-5 text-sm text-muted-foreground text-center">No pending regularization requests.</Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="reg-inbox">
              {inbox.map((r) => <ReqCard key={r.id} r={r} canDecide onDecide={decide} busy={busy} />)}
            </div>
          )}
        </div>
      )}

      {canRequest && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">My requests</p>
          {mine.length === 0 ? (
            <Card className="p-5 text-sm text-muted-foreground text-center">No requests yet.</Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="reg-mine">
              {mine.map((r) => <ReqCard key={r.id} r={r} canDecide={false} busy={busy} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Clock, MapPin, SignIn, SignOut, DownloadSimple, PencilSimple, Timer, BellRinging, Coffee, UploadSimple, CalendarBlank, EnvelopeSimple } from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";
import { downloadPayslipPdf, payslipBase64 } from "@/lib/payslipPdf";
import CompanyProfileDialog from "@/components/attendance/CompanyProfileDialog";
import MobileCheckIn from "@/components/attendance/MobileCheckIn";
import AttendanceCalendar from "@/components/attendance/AttendanceCalendar";
import BulkUploadDialog from "@/components/attendance/BulkUploadDialog";
import EditDaysDialog from "@/components/attendance/EditDaysDialog";
import RegularizationPanel from "@/components/attendance/RegularizationPanel";
import WhosInBoard from "@/components/attendance/WhosInBoard";
import Leave from "@/pages/Leave";

// Shift = 9h total (8h work + 1h break). Warn 5 min before completion.
const WORK_TARGET_SECONDS = 9 * 3600;
const NOTIFY_BEFORE_SECONDS = 5 * 60;

function fmtDuration(secs) {
  const s = Math.max(0, Math.floor(secs));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function fireWorkAlmostDone() {
  const msg = "5 minutes left to complete your work hours (9h). Wrap up & check out.";
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Work hours almost complete", { body: msg, icon: "/km-mark.png" });
    }
  } catch (e) {
    console.error("[attendance] notification failed:", e);
  }
  toast.info(msg, { duration: 10000 });
}

const OFFICES = [
  { value: "all", label: "All offices" },
  { value: "KM_BLR", label: "KM Bangalore" },
  { value: "KM_TCR", label: "KM Thrissur" },
  { value: "KM_KMLY", label: "KM Kollam" },
];

const STATUS_META = {
  present: { label: "Present", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  late: { label: "Late", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  half_day: { label: "Half day", cls: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30" },
  absent: { label: "Absent", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
};

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";

function StatusBadge({ status, tid }) {
  const meta = STATUS_META[status] || STATUS_META.present;
  return (
    <span
      data-testid={tid}
      className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}

/* ---------------- Check-in card (staff + office admin) ---------------- */
function CheckInCard({ onRegularizeDate }) {
  const [today, setToday] = useState(null);
  const [mine, setMine] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const month = thisMonth();

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([
        api.get("/attendance/today"),
        api.get(`/attendance/me?month=${month}`),
      ]);
      setToday(t.data.record || null);
      setMine(m.data.records || []);
    } catch (e) {
      console.error("[attendance] load failed:", e);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const getPosition = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null });
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {
          toast.warning("Location unavailable — checking in without GPS");
          resolve({ lat: null, lng: null });
        },
        { enableHighAccuracy: true, timeout: 8000 },
      );
    });

  const checkIn = async () => {
    setBusy(true);
    try {
      const coords = await getPosition();
      const { data } = await api.post("/attendance/check-in", coords);
      setToday(data.record);
      toast.success(data.record.status === "late" ? "Checked in (marked late)" : "Checked in");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const checkOut = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/attendance/check-out");
      setToday(data.record);
      toast.success("Checked out");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const toggleBreak = async () => {
    setBusy(true);
    try {
      const path = today?.on_break ? "/attendance/break/end" : "/attendance/break/start";
      const { data } = await api.post(path);
      setToday(data.record);
      toast.success(today?.on_break ? "Break ended" : "Break started");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const checkedIn = !!today?.check_in;
  const checkedOut = !!today?.check_out;
  const onBreak = !!today?.on_break;

  // Live work timer + break tracking + "5 min before 9h" notification.
  const [elapsed, setElapsed] = useState(0);
  const [breakTotal, setBreakTotal] = useState(0);
  const notifiedRef = React.useRef(false);
  useEffect(() => {
    if (!checkedIn || checkedOut) return;
    const start = new Date(today.check_in).getTime();
    const dayKey = `att-notified-${today.date}`;
    notifiedRef.current = typeof localStorage !== "undefined" && localStorage.getItem(dayKey) === "1";
    const completed = (today.breaks || []).reduce((s, b) => s + (Number(b.seconds) || 0), 0);
    const openBreak = (today.breaks || []).find((b) => !b.end);
    const tick = () => {
      const e = (Date.now() - start) / 1000;
      setElapsed(e);
      const live = openBreak ? (Date.now() - new Date(openBreak.start).getTime()) / 1000 : 0;
      setBreakTotal(completed + live);
      if (!notifiedRef.current && e >= WORK_TARGET_SECONDS - NOTIFY_BEFORE_SECONDS && e < WORK_TARGET_SECONDS) {
        notifiedRef.current = true;
        try { localStorage.setItem(dayKey, "1"); } catch { /* ignore */ }
        fireWorkAlmostDone();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [checkedIn, checkedOut, today]);

  const requestNotifyPermission = () => {
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } catch { /* ignore */ }
  };
  const doCheckIn = async () => { requestNotifyPermission(); await checkIn(); };

  const netWorked = Math.max(0, elapsed - breakTotal);
  const remaining = Math.max(0, WORK_TARGET_SECONDS - elapsed);

  return (
    <div className="space-y-6" data-testid="checkin-card">
      {/* Mobile: app-style hero + big check-in dial */}
      <div className="sm:hidden">
        <MobileCheckIn
          today={today}
          elapsed={elapsed}
          netWorked={netWorked}
          breakTotal={breakTotal}
          onBreak={onBreak}
          checkedIn={checkedIn}
          checkedOut={checkedOut}
          busy={busy}
          loading={loading}
          onCheckIn={doCheckIn}
          onCheckOut={checkOut}
          onToggleBreak={toggleBreak}
        />
      </div>

      {/* Desktop card */}
      <Card className="p-6 hidden sm:block">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Today · shift 10:00 AM – 7:00 PM · 9h</p>
            <h2 className="text-2xl font-semibold text-foreground mt-1">
              {checkedIn ? (checkedOut ? "Day complete" : "You're checked in") : "Not checked in yet"}
            </h2>
            {checkedIn && (
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><SignIn size={15} /> In {fmtTime(today.check_in)}</span>
                {checkedOut && <span className="flex items-center gap-1"><SignOut size={15} /> Out {fmtTime(today.check_out)}</span>}
                {today.status && <StatusBadge status={today.status} tid="today-status" />}
              </div>
            )}
            {today?.check_in_lat != null && (
              <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                <MapPin size={12} /> {today.check_in_lat.toFixed(4)}, {today.check_in_lng?.toFixed(4)}
              </p>
            )}
          </div>

          {/* Live work timer while checked in */}
          {checkedIn && !checkedOut && (
            <div className="text-right" data-testid="work-timer">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 justify-end">
                <Timer size={13} /> Worked (net)
              </p>
              <p className="text-3xl font-bold tabular-nums text-foreground leading-tight">{fmtDuration(netWorked)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Break {fmtDuration(breakTotal)} · {remaining > 0 ? <>{fmtDuration(remaining)} to 9h</> : <span className="text-amber-600 dark:text-amber-400 inline-flex items-center gap-1"><BellRinging size={12} /> Target reached</span>}
              </p>
            </div>
          )}
        </div>

        {/* Desktop buttons */}
        <div className="flex flex-wrap gap-2 mt-5">
          {!checkedIn && (
            <Button data-testid="btn-check-in" onClick={doCheckIn} disabled={busy || loading} className="btn-amber">
              <SignIn size={18} className="mr-1.5" /> Check in
            </Button>
          )}
          {checkedIn && !checkedOut && (
            <>
              <Button
                data-testid="btn-toggle-break"
                onClick={toggleBreak}
                disabled={busy}
                variant={onBreak ? "default" : "outline"}
                className={onBreak ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
              >
                <Coffee size={18} className="mr-1.5" /> {onBreak ? "End break" : "Start break"}
              </Button>
              <Button data-testid="btn-check-out" onClick={checkOut} disabled={busy || onBreak} variant="outline">
                <SignOut size={18} className="mr-1.5" /> Check out
              </Button>
              {onBreak && <span className="self-center text-xs text-amber-600 dark:text-amber-400">On break — end it before checking out</span>}
            </>
          )}
          {checkedOut && (
            <p className="text-sm text-muted-foreground">
              Great work today — see you tomorrow. {today?.break_seconds ? `(Break: ${fmtDuration(today.break_seconds)})` : ""}
            </p>
          )}
        </div>
      </Card>

      {/* Desktop-only calendar (on mobile it lives in the Regularize tab). */}
      <Card className="p-5 hidden sm:block">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground">My attendance · this month</h3>
          <span className="text-xs text-muted-foreground">{mine.length} day{mine.length !== 1 ? "s" : ""}</span>
        </div>
        <AttendanceCalendar month={month} records={mine} onPickDate={onRegularizeDate} />
      </Card>
    </div>
  );
}

/* ---------------- Payroll (admins) ---------------- */
function SalaryEditor({ uid, current, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(current || ""));
  const save = async () => {
    try {
      await api.put(`/attendance/salary/${uid}`, { monthly_salary: Number(val) || 0 });
      toast.success("Salary updated");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };
  if (!editing) {
    return (
      <button
        data-testid={`salary-edit-${uid}`}
        onClick={() => { setVal(String(current || "")); setEditing(true); }}
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        <PencilSimple size={13} /> edit
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        data-testid={`salary-input-${uid}`}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="h-7 w-24 text-xs"
        type="number"
        autoFocus
      />
      <Button size="sm" className="h-7 px-2" data-testid={`salary-save-${uid}`} onClick={save}>Save</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(false)}>×</Button>
    </span>
  );
}

function PayrollSection({ user }) {
  const isSuper = user.role === "super_admin";
  const [month, setMonth] = useState(thisMonth());
  const [office, setOffice] = useState("all");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editStaff, setEditStaff] = useState(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [busyUid, setBusyUid] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const currency = user.currency || "INR";

  const genPayslip = useCallback(async (uid) => {
    setBusyUid(uid);
    try {
      const { data } = await api.get(`/attendance/payslip/${uid}?month=${month}`);
      await downloadPayslipPdf(data, currency);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Could not generate payslip");
    } finally {
      setBusyUid(null);
    }
  }, [month, currency]);

  const emailPayslip = useCallback(async (row) => {
    setBusyUid(row.user_id);
    try {
      const { data } = await api.get(`/attendance/payslip/${row.user_id}?month=${month}`);
      const { base64, filename } = await payslipBase64(data, currency);
      const res = await api.post(`/attendance/payslip/${row.user_id}/email`, {
        month, pdf_base64: base64, filename,
      });
      toast.success(`Payslip emailed to ${res.data.sent_to}`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Could not email payslip");
    } finally {
      setBusyUid(null);
    }
  }, [month, currency]);

  const downloadAll = useCallback(async () => {
    setDownloadingAll(true);
    try {
      for (const r of rows) {
        const { data } = await api.get(`/attendance/payslip/${r.user_id}?month=${month}`);
        await downloadPayslipPdf(data, currency);
      }
      toast.success(`Downloaded ${rows.length} payslip${rows.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Could not download all payslips");
    } finally {
      setDownloadingAll(false);
    }
  }, [rows, month, currency]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ month });
      if (isSuper && office !== "all") q.set("office", office);
      const { data } = await api.get(`/attendance/payroll?${q.toString()}`);
      setRows(data.rows || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [month, office, isSuper]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.salary += r.monthly_salary || 0;
        acc.deduction += r.deduction || 0;
        acc.net += r.net_pay || 0;
        return acc;
      },
      { salary: 0, deduction: 0, net: 0 },
    );
  }, [rows]);

  return (
    <Card className="p-0 overflow-hidden" data-testid="payroll-section">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-foreground flex items-center gap-2"><Clock size={18} /> Payroll</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-9" data-testid="company-profile-btn" onClick={() => setCompanyOpen(true)}>
            Company profile
          </Button>
          <Button variant="outline" size="sm" className="h-9" data-testid="payroll-download-all" onClick={downloadAll} disabled={downloadingAll || rows.length === 0}>
            <DownloadSimple size={15} className="mr-1.5" /> {downloadingAll ? "Preparing…" : "Download all"}
          </Button>
          <Button variant="outline" size="sm" className="h-9" data-testid="bulk-upload-btn" onClick={() => setBulkOpen(true)}>
            <UploadSimple size={15} className="mr-1.5" /> Bulk upload
          </Button>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            data-testid="payroll-month"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          />
          {isSuper && (
            <select
              value={office}
              onChange={(e) => setOffice(e.target.value)}
              data-testid="payroll-office"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              {OFFICES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <p className="p-6 text-sm text-muted-foreground text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground text-center">No staff / payroll data for this month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]" data-testid="payroll-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="px-4 py-3">Employee</th>
                <th className="px-3 py-3 text-center">Present</th>
                <th className="px-3 py-3 text-center">Half</th>
                <th className="px-3 py-3 text-center">Paid leave</th>
                <th className="px-3 py-3 text-center">Absent</th>
                <th className="px-3 py-3 text-right">Salary</th>
                <th className="px-3 py-3 text-right">Deduction</th>
                <th className="px-3 py-3 text-right">Net pay</th>
                <th className="px-3 py-3 text-center">Payslip</th>
                <th className="px-3 py-3 text-center">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.user_id} data-testid={`payroll-row-${r.user_id}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.role === "office_admin" ? "Office Admin" : "Staff"} · {r.office || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center tabular-nums">{r.present_days}</td>
                  <td className="px-3 py-3 text-center tabular-nums">{r.half_days}</td>
                  <td className="px-3 py-3 text-center tabular-nums text-emerald-600 dark:text-emerald-400">{r.leave_days}</td>
                  <td className="px-3 py-3 text-center tabular-nums text-rose-600 dark:text-rose-400">{r.absent_days}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <div
                      title={(r.salary_breakup || []).map((b) => `${b.label}: ${formatMoney(b.amount, currency)} (${b.pct}%)`).join("\n")}
                      data-testid={`payroll-salary-${r.user_id}`}
                    >
                      {formatMoney(r.monthly_salary, currency)}
                    </div>
                    <SalaryEditor uid={r.user_id} current={r.monthly_salary} onSaved={load} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-rose-600 dark:text-rose-400">
                    {r.deduction ? `- ${formatMoney(r.deduction, currency)}` : formatMoney(0, currency)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-foreground">
                    {r.salary_hold ? (
                      <span className="inline-flex flex-col items-end gap-0.5" data-testid={`payroll-hold-${r.user_id}`}>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          On hold
                        </span>
                        <span className="text-[11px] font-normal text-muted-foreground line-through">{formatMoney(r.net_before_hold, currency)}</span>
                      </span>
                    ) : formatMoney(r.net_pay, currency)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="inline-flex items-center gap-2">
                      <button
                        data-testid={`payslip-${r.user_id}`}
                        onClick={() => genPayslip(r.user_id)}
                        disabled={busyUid === r.user_id}
                        className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
                      >
                        <DownloadSimple size={15} /> PDF
                      </button>
                      <button
                        data-testid={`payslip-email-${r.user_id}`}
                        onClick={() => emailPayslip(r)}
                        disabled={busyUid === r.user_id}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                        title="Email this payslip to the employee"
                      >
                        <EnvelopeSimple size={15} /> Email
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      data-testid={`edit-days-${r.user_id}`}
                      onClick={() => setEditStaff(r)}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <CalendarBlank size={15} /> Days
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold text-foreground bg-muted/40">
                <td className="px-4 py-3" colSpan={5}>Total · {rows.length} employee{rows.length !== 1 ? "s" : ""}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(totals.salary, currency)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-rose-600 dark:text-rose-400">- {formatMoney(totals.deduction, currency)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMoney(totals.net, currency)}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="px-5 py-3 text-[11px] text-muted-foreground border-t border-border">
        Working days = all days except Sundays. Approved leave (non-unpaid) counts as paid; unapproved absence is deducted at the per-day rate.
      </p>

      <BulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} onDone={load} />
      <CompanyProfileDialog open={companyOpen} onOpenChange={setCompanyOpen} />
      <EditDaysDialog
        open={!!editStaff}
        onOpenChange={(v) => !v && setEditStaff(null)}
        staff={editStaff}
        month={month}
        onChanged={load}
      />
    </Card>
  );
}

export default function Attendance() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  if (!user) return null;
  const isAdmin = user.role === "super_admin" || user.role === "office_admin";
  const canCheckIn = user.role === "staff" || user.role === "office_admin";

  const tabs = [];
  if (canCheckIn) tabs.push({ v: "attendance", label: "Attendance" });
  if (isAdmin) tabs.push({ v: "board", label: "Who's in" });
  tabs.push({ v: "regularize", label: "Regularize" });
  tabs.push({ v: "leave", label: "Leave" });
  if (isAdmin) tabs.push({ v: "payroll", label: "Payroll" });

  const requested = params.get("tab");
  const active = tabs.some((t) => t.v === requested) ? requested : tabs[0].v;
  const setActive = (v) => setParams(v === tabs[0].v ? {} : { tab: v }, { replace: true });

  // Desktop: clicking a past day in the Attendance-tab calendar jumps to the
  // Regularize tab with the dialog prefilled.
  const openRegularize = (date) => setParams({ tab: "regularize", date }, { replace: true });

  return (
    <div className="space-y-6 max-w-6xl" data-testid="attendance-page">
      <Tabs value={active} onValueChange={setActive}>
        <TabsList data-testid="attendance-tabs" className="flex-wrap h-auto">
          {tabs.map((t) => (
            <TabsTrigger key={t.v} value={t.v} data-testid={`tab-${t.v}`}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {canCheckIn && (
          <TabsContent value="attendance" className="mt-6">
            <CheckInCard onRegularizeDate={openRegularize} />
          </TabsContent>
        )}
        <TabsContent value="regularize" className="mt-6">
          <RegularizationPanel user={user} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="board" className="mt-6">
            <WhosInBoard user={user} />
          </TabsContent>
        )}
        <TabsContent value="leave" className="mt-6">
          <Leave />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="payroll" className="mt-6">
            <PayrollSection user={user} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

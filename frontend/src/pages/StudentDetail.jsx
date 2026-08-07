import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Plus, PencilSimple, Trash, CaretDown, CaretUp } from "@phosphor-icons/react";
import { toast } from "sonner";
import { downloadStudentPdf } from "@/lib/studentExports";
import { downloadApplicationPdf } from "@/lib/applicationPdf";
import ConvertToEnrolledDialog from "@/components/student-detail/ConvertToEnrolledDialog";
import { feesPlanFromApi, normalizeFeesPlanForApi } from "@/components/FeesPlanFields";
import HeaderCard from "@/components/student-detail/HeaderCard";
import EditApplicationDialog from "@/components/student-detail/EditApplicationDialog";
import SummaryTiles from "@/components/student-detail/SummaryTiles";
import PaymentDialog from "@/components/student-detail/PaymentDialog";
import ScheduleDialog from "@/components/student-detail/ScheduleDialog";
import {
  RECEIVED_IN, FEE_TYPE_LABELS, PAYMENT_MODES, SUB_AGENT_TYPES,
  nextScheduleLabel, emptyPayment,
} from "@/components/student-detail/constants";

export default function StudentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const currency = user?.currency || "USD";
  const [s, setS] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [clients, setClients] = useState([]);
  const [editHeader, setEditHeader] = useState(false);
  const [header, setHeader] = useState({});
  const [schDlg, setSchDlg] = useState({ open: false, editing: null, form: { label: "1st Payment", amount: "", remarks: "", due_date: "" } });
  const [payDlg, setPayDlg] = useState({ open: false, editing: null, form: emptyPayment() });
  const [convertOpen, setConvertOpen] = useState(false);
  const [editAppOpen, setEditAppOpen] = useState(false);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    try {
      const [sr, a, c] = await Promise.all([
        api.get(`/students/${id}`),
        api.get("/accounts"),
        api.get("/clients"),
      ]);
      setS(sr.data); setAccounts(a.data); setClients(c.data);
      setHeader({
        name: sr.data.name, course: sr.data.course || "", college: sr.data.college || "",
        reference: sr.data.reference || "", sc_out_fixed: sr.data.sc_out_fixed || 0,
        status: sr.data.status, enrollment_date: sr.data.enrollment_date || "", notes: sr.data.notes || "",
        fees_plan: feesPlanFromApi(sr.data.fees_plan),
        home_office: sr.data.home_office || "",
        sc_from_college_override:
          sr.data.sc_from_college_override === null || sr.data.sc_from_college_override === undefined
            ? ""
            : sr.data.sc_from_college_override,
      });
    } catch {
      toast.error("Could not load student"); nav("/students");
    }
  }, [id, nav]);
  useEffect(() => { load(); }, [load]);

  // Stable PaymentDialog props — must be declared BEFORE the early-return
  // below so React hook ordering stays consistent on every render.
  const payDlgState = useMemo(
    () => ({ ...payDlg, currency }),
    [payDlg, currency],
  );
  const onPayDlgOpenChange = useCallback(
    (v) => setPayDlg((prev) => ({ ...prev, open: v })),
    [],
  );

  if (!s) return <div className="p-8 text-sm text-muted-foreground" data-testid="loading">Loading…</div>;

  const saveHeader = async () => {
    try {
      const overrideRaw = header.sc_from_college_override;
      const overrideNum = overrideRaw === "" || overrideRaw === undefined || overrideRaw === null
        ? null
        : Number(overrideRaw);
      const payload = {
        ...header,
        sc_out_fixed: parseFloat(header.sc_out_fixed) || 0,
        fees_plan: normalizeFeesPlanForApi(header.fees_plan),
        home_office: header.home_office || null,
        sc_from_college_override:
          overrideNum === null || Number.isNaN(overrideNum) ? null : overrideNum,
      };
      const { data } = await api.patch(`/students/${id}`, payload);
      setS(data); setEditHeader(false); toast.success("Saved");
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail) || "Failed"); }
  };

  const removeStudent = async () => {
    if (!confirm("Delete this student? All schedules and payments will be removed.")) return;
    await api.delete(`/students/${id}`);
    toast.success("Deleted"); nav("/students");
  };

  // ----- Schedules -----
  const openSchAdd = () => setSchDlg({ open: true, editing: null, form: { label: nextScheduleLabel(s.schedules), amount: "", remarks: "", due_date: "" } });
  const openSchEdit = (sc) => setSchDlg({ open: true, editing: sc, form: { label: sc.label, amount: sc.amount, remarks: sc.remarks || "", due_date: sc.due_date || "" } });
  const submitSch = async (e) => {
    e.preventDefault();
    const payload = { ...schDlg.form, amount: parseFloat(schDlg.form.amount) || 0, due_date: schDlg.form.due_date || null };
    try {
      const { data } = schDlg.editing
        ? await api.patch(`/students/${id}/schedules/${schDlg.editing.id}`, payload)
        : await api.post(`/students/${id}/schedules`, payload);
      setS(data); setSchDlg({ ...schDlg, open: false }); toast.success("Saved");
    } catch { toast.error("Failed"); }
  };
  const removeSch = async (sid) => {
    if (!confirm("Delete schedule?")) return;
    const { data } = await api.delete(`/students/${id}/schedules/${sid}`); setS(data);
  };

  // ----- Payments -----
  const openPayAdd = () => setPayDlg({ open: true, editing: null, form: emptyPayment() });

  const _mapAdjustmentForForm = (a) => {
    const base = {
      _key: a.id || a._key || `loaded-${a.kind}-${a.amount}-${a.payment_date}`,
      amount: String(a.amount ?? ""),
      payment_date: a.payment_date,
      payment_mode: a.payment_mode || "bank_transfer",
      account_id: a.account_id || "",
      client_id: a.client_id || "",
      sub_agent_type: a.sub_agent_type || "sub_agent",
      sub_agent_name: a.sub_agent_name || "",
      remarks: a.remarks || "",
    };
    if (a.kind === "internal_credit") return { ...base, kind: "km_foundation" };
    if (a.kind === "sc_adjusted") {
      return {
        ...base,
        kind: a.sub_agent_type === "associate" ? "associate_consultant" : "sub_agent",
      };
    }
    // legacy paid_to_college rows — surface as KM Foundation (user can re-pick)
    if (a.kind === "paid_to_college") return { ...base, kind: "km_foundation" };
    return { ...base, kind: a.kind };
  };

  const openPayEdit = (p) => setPayDlg({
    open: true, editing: p,
    form: {
      date: p.date, amount: String(p.amount), fee_type: p.fee_type || "other_fees",
      received_in: {
        type: p.received_in?.type || "college",
        name: p.received_in?.name || "",
        account_id: p.received_in?.account_id || "",
        client_id: p.received_in?.client_id || "",
      },
      has_adjustment: !!p.has_adjustment,
      adjustments: (p.adjustments || []).map(_mapAdjustmentForForm),
      schedule_id: p.schedule_id || "",
      remarks: p.remarks || "",
    },
  });

  const validateAdjustments = (adjustments, hasAdjustment) => {
    if (!hasAdjustment) return null;
    if (!adjustments?.length) return "Add at least one adjustment row, or uncheck 'This payment has an adjustment'.";
    for (let i = 0; i < adjustments.length; i++) {
      const a = adjustments[i];
      const rowLabel = `Adjustment #${i + 1}`;
      if (!a.payment_date) return `${rowLabel}: pick a payment date.`;
      if (!(parseFloat(a.amount) > 0)) return `${rowLabel}: enter an amount greater than zero.`;
      if (a.kind === "km_foundation" && !a.account_id) {
        return `${rowLabel}: pick a KM Foundation internal account.`;
      }
      if ((a.kind === "sub_agent" || a.kind === "associate_consultant") && !a.client_id) {
        return `${rowLabel}: pick a ${a.kind === "sub_agent" ? "sub-agent" : "associate consultant"}.`;
      }
      // legacy back-compat (rows loaded from older payments may still carry sc_adjusted)
      if (a.kind === "sc_adjusted") {
        if (!a.sub_agent_type) return `${rowLabel}: pick Sub Agent / Associate / KM.`;
        if (!a.sub_agent_name?.trim()) return `${rowLabel}: name is required for SC-adjusted rows.`;
      }
    }
    return null;
  };

  const _mapAdjustmentForApi = (a) => {
    const base = {
      amount: parseFloat(a.amount) || 0,
      payment_date: a.payment_date,
      payment_mode: a.payment_mode || "bank_transfer",
      remarks: a.remarks || "",
    };
    if (a.kind === "km_foundation") {
      return { ...base, kind: "internal_credit", account_id: a.account_id || null };
    }
    if (a.kind === "sub_agent" || a.kind === "associate_consultant") {
      return {
        ...base,
        kind: "sc_adjusted",
        sub_agent_type: a.kind === "sub_agent" ? "sub_agent" : "associate",
        sub_agent_name: a.sub_agent_name || null,
        client_id: a.client_id || null,
      };
    }
    // legacy paid_to_college / sc_adjusted rows — pass through unchanged
    return {
      ...base,
      kind: a.kind,
      sub_agent_type: a.kind === "sc_adjusted" ? (a.sub_agent_type || null) : null,
      sub_agent_name: a.kind === "sc_adjusted" ? (a.sub_agent_name || null) : null,
    };
  };

  const submitPay = async (e) => {
    e.preventDefault();
    const f = payDlg.form;
    const isSc = f.fee_type === "sc_adjusted";
    if (isSc && !f.received_in.client_id) {
      toast.error("Pick the Sub-Agent / Consultant / KM Office that absorbed the SC.");
      return;
    }
    const adjErr = isSc ? null : validateAdjustments(f.adjustments, f.has_adjustment);
    if (adjErr) { toast.error(adjErr); return; }
    const payload = {
      date: f.date,
      amount: parseFloat(f.amount) || 0,
      fee_type: f.fee_type,
      received_in: {
        type: f.received_in.type,
        name: f.received_in.name || null,
        account_id: f.received_in.account_id || null,
        client_id: f.received_in.client_id || null,
      },
      has_adjustment: isSc ? false : !!f.has_adjustment,
      adjustments: (!isSc && f.has_adjustment) ? f.adjustments.map(_mapAdjustmentForApi) : [],
      schedule_id: f.schedule_id || null,
      remarks: f.remarks || "",
    };
    try {
      const { data } = payDlg.editing
        ? await api.patch(`/students/${id}/payments/${payDlg.editing.id}`, payload)
        : await api.post(`/students/${id}/payments`, payload);
      setS(data); setPayDlg({ ...payDlg, open: false }); toast.success("Saved");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Failed");
    }
  };
  const removePay = async (pid) => {
    if (!confirm("Delete payment?")) return;
    const { data } = await api.delete(`/students/${id}/payments/${pid}`); setS(data);
  };

  // ----- "Add Payment" header button — now opens the PaymentDialog directly -----
  // (replaces the legacy combined Add-Entry flow which also created schedule rows).

  const onExportPdf = () => {
    try {
      downloadStudentPdf({ student: s, user });
      toast.success("PDF generated");
    } catch (err) {
      console.error("[student-detail] export failed:", err);
      toast.error("Export failed");
    }
  };

  const onExportApplicationPdf = async () => {
    try {
      await downloadApplicationPdf({ student: s, user });
      toast.success("Application PDF generated");
    } catch (err) {
      console.error("[student-detail] application pdf failed:", err);
      toast.error(err?.message || "Export failed");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="student-detail">
      <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="back-to-list">
        <ArrowLeft size={14} /> All students
      </Link>

      <HeaderCard
        s={s}
        editing={editHeader}
        setEditing={setEditHeader}
        header={header}
        setHeader={setHeader}
        clients={clients}
        currency={currency}
        isSuperAdmin={user?.role === "super_admin"}
        onSave={saveHeader}
        onDelete={removeStudent}
        onAddEntry={openPayAdd}
        onExportPdf={onExportPdf}
        onExportApplicationPdf={onExportApplicationPdf}
        onEditApplication={user?.role === "super_admin" ? () => setEditAppOpen(true) : undefined}
        onConvertToEnrolled={() => setConvertOpen(true)}
      />

      <SummaryTiles s={s} currency={currency} />

      {/* Schedules */}
      <Card className="border border-border bg-card rounded-lg shadow-none overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-border">
          <div>
            <p className="label-eyebrow">Payment schedule</p>
            <h3 className="font-display text-lg mt-0.5">Planned installments</h3>
          </div>
        </div>
        {(!s.schedules || s.schedules.length === 0) ? (
          <div className="p-10 text-center text-sm text-muted-foreground" data-testid="empty-schedules">No schedules yet.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left bg-muted/40 border-b border-border">
                <th className="px-6 py-3 label-eyebrow">Schedule</th>
                <th className="px-6 py-3 label-eyebrow text-right">Amount</th>
                <th className="px-6 py-3 label-eyebrow">Remarks</th>
                <th className="px-6 py-3 label-eyebrow">Due</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {s.schedules.map((sc) => (
                <tr key={sc.id} className="hover:bg-muted/40" data-testid={`sch-row-${sc.id}`}>
                  <td className="px-6 py-3 font-medium">{sc.label}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{formatMoney(sc.amount, currency)}</td>
                  <td className="px-6 py-3 text-muted-foreground">{sc.remarks || "—"}</td>
                  <td className="px-6 py-3 tabular-nums text-muted-foreground">{sc.due_date ? formatDate(sc.due_date) : "—"}</td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openSchEdit(sc)} data-testid={`sch-edit-${sc.id}`} className="text-muted-foreground hover:text-foreground p-1.5"><PencilSimple size={14} /></button>
                    <button onClick={() => removeSch(sc.id)} data-testid={`sch-del-${sc.id}`} className="text-muted-foreground hover:text-rose-700 dark:text-rose-400 p-1.5"><Trash size={14} /></button>
                  </td>
                </tr>
              ))}
              <tr className="bg-muted/40 font-medium">
                <td className="px-6 py-3 text-muted-foreground label-eyebrow">Total</td>
                <td className="px-6 py-3 text-right tabular-nums" data-testid="sch-total">{formatMoney(s.scheduled_total, currency)}</td>
                <td colSpan={3}></td>
              </tr>
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {/* Payments */}
      <Card className="border border-border bg-card rounded-lg shadow-none overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-border">
          <div>
            <p className="label-eyebrow">Payments collected</p>
            <h3 className="font-display text-lg mt-0.5">Actual collections</h3>
          </div>
          <Button onClick={openPayAdd} size="sm" className="btn-amber border-0" data-testid="open-pay">
            <Plus size={14} className="mr-1.5" /> Log payment
          </Button>
        </div>
        {(!s.payments || s.payments.length === 0) ? (
          <div className="p-10 text-center text-sm text-muted-foreground" data-testid="empty-payments">No payments logged yet.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="text-left bg-muted/40 border-b border-border">
                <th className="px-6 py-3 label-eyebrow w-8"></th>
                <th className="px-6 py-3 label-eyebrow">Date credited</th>
                <th className="px-6 py-3 label-eyebrow">Schedule / Fee</th>
                <th className="px-6 py-3 label-eyebrow">Received in</th>
                <th className="px-6 py-3 label-eyebrow text-right">Amount</th>
                <th className="px-6 py-3 label-eyebrow">Remarks</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {s.payments.map((p) => {
                const ri = RECEIVED_IN[p.received_in?.type] || RECEIVED_IN.bank;
                const Icon = ri.icon;
                const sch = (s.schedules || []).find((x) => x.id === p.schedule_id);
                const isExp = !!expanded[p.id];
                const hasAdj = p.has_adjustment && (p.adjustments || []).length > 0;
                return (
                  <React.Fragment key={p.id}>
                    <tr className="hover:bg-muted/40" data-testid={`pay-row-${p.id}`}>
                      <td className="px-6 py-3">
                        {hasAdj && (
                          <button onClick={() => setExpanded({ ...expanded, [p.id]: !isExp })} className="text-muted-foreground/70 hover:text-foreground" data-testid={`pay-expand-${p.id}`}>
                            {isExp ? <CaretUp size={14} /> : <CaretDown size={14} />}
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-3 tabular-nums text-muted-foreground">{formatDate(p.date)}</td>
                      <td className="px-6 py-3">
                        <div className="font-medium">{sch ? sch.label : "Unscheduled"}</div>
                        <div className="text-xs text-muted-foreground">{FEE_TYPE_LABELS[p.fee_type] || "Other Fees"}</div>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded ${ri.color}`}>
                          <Icon size={12} /> {ri.label}
                        </span>
                        {p.received_in?.name && <div className="text-xs text-muted-foreground mt-1">{p.received_in.name}</div>}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums font-medium text-emerald-700 dark:text-emerald-400">{formatMoney(p.amount, currency)}</td>
                      <td className="px-6 py-3 text-muted-foreground">{p.remarks || "—"}</td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button onClick={() => openPayEdit(p)} data-testid={`pay-edit-${p.id}`} className="text-muted-foreground hover:text-foreground p-1.5"><PencilSimple size={14} /></button>
                        <button onClick={() => removePay(p.id)} data-testid={`pay-del-${p.id}`} className="text-muted-foreground hover:text-rose-700 dark:text-rose-400 p-1.5"><Trash size={14} /></button>
                      </td>
                    </tr>
                    {hasAdj && isExp && (
                      <tr className="bg-muted/40">
                        <td colSpan={7} className="px-6 py-3">
                          <p className="label-eyebrow mb-2">Adjustments</p>
                          <div className="space-y-1.5">
                            {p.adjustments.map((a, idx) => (
                              <div key={a.id || idx} className="flex items-center gap-2 text-xs text-foreground">
                                <span className={`px-1.5 py-0.5 rounded ${a.kind === "paid_to_college" ? "bg-sky-100 text-sky-700 dark:text-sky-400" : "bg-emerald-100 text-emerald-700 dark:text-emerald-400"}`}>
                                  {a.kind === "paid_to_college" ? "Paid to College" : "Payment adjusted towards SC"}
                                </span>
                                <span className="tabular-nums font-medium">{formatMoney(a.amount, currency)}</span>
                                <span className="text-muted-foreground">on {formatDate(a.payment_date)} · {PAYMENT_MODES.find((m) => m.value === a.payment_mode)?.label}</span>
                                {a.kind === "sc_adjusted" && a.sub_agent_name && (
                                  <span className="text-muted-foreground">· with {SUB_AGENT_TYPES.find((t) => t.value === a.sub_agent_type)?.label} {a.sub_agent_name}</span>
                                )}
                                {a.remarks && <span className="text-muted-foreground">· {a.remarks}</span>}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              <tr className="bg-muted/40 font-medium">
                <td colSpan={4} className="px-6 py-3 text-muted-foreground label-eyebrow">Total collected</td>
                <td className="px-6 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400" data-testid="pay-total">{formatMoney(s.collected_total, currency)}</td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <PaymentDialog
        open={payDlg.open}
        onOpenChange={onPayDlgOpenChange}
        state={payDlgState}
        setState={setPayDlg}
        schedules={s.schedules}
        accounts={accounts}
        clients={clients}
        onSubmit={submitPay}
      />

      <ScheduleDialog
        state={schDlg}
        setState={setSchDlg}
        onSubmit={submitSch}
      />

      <ConvertToEnrolledDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        student={s}
        currency={currency}
        onConverted={() => { load(); }}
      />

      <EditApplicationDialog
        open={editAppOpen}
        onOpenChange={setEditAppOpen}
        student={s}
        onSaved={(updated) => {
          // Update React state IMMEDIATELY from the server response so the
          // next Application PDF download uses the fresh data even if the
          // background refetch hasn't completed yet.
          if (updated && updated.id === s?.id) setS({ ...s, ...updated });
          // Also re-fetch in case schedules/payments need to refresh.
          load();
        }}
      />
    </div>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatDate } from "@/lib/format";
import { buildApplyUrl, slugifyRef } from "@/lib/applyUrl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, EnvelopeSimple, Phone, Buildings, Cake, CurrencyInr, ArrowsClockwise, Check, DownloadSimple, Link as LinkIcon, IdentificationBadge, MapPin, House, CalendarCheck, PencilSimple, Receipt, FileText, HandCoins } from "@phosphor-icons/react";
import { toast } from "sonner";
import { clientTypeLabel } from "@/pages/Clients";
import AuthedImage from "@/components/AuthedImage";
import { downloadClientStatementPDF } from "@/lib/clientStatementPdf";
import StaffQuotaDialog from "@/components/leave/StaffQuotaDialog";
import ClientTxnDialog from "@/components/ClientTxnDialog";
import InvoiceCreateDialog from "@/components/InvoiceCreateDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const TYPE_BADGE = {
  staff: "bg-orange-100/60 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400",
  sub_agent_associate: "bg-violet-100/60 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400",
  associate_consultant: "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400",
  km_blr_office: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  km_tcr_office: "bg-sky-100/60 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400",
  km_kmly_office: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const STATUS_BADGE = {
  inquiry: "bg-muted text-foreground",
  enrolled: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400",
  completed: "bg-sky-100/60 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

const SC_STATUS = {
  pending: { label: "Pending", cls: "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  cleared: { label: "Cleared", cls: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  not_earned: { label: "Not Earned", cls: "bg-muted text-muted-foreground" },
};

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const currency = user?.currency || "USD";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [txnOpen, setTxnOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [tileKey, setTileKey] = useState(null);
  const [scInvoice, setScInvoice] = useState(null); // SC-earned row being invoiced

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/clients/${id}/detail`);
      setData(data);
    } catch {
      toast.error("Client not found");
      nav("/clients");
    } finally {
      setLoading(false);
    }
  }, [id, nav]);
  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return <div className="p-8 text-sm text-muted-foreground" data-testid="loading">Loading…</div>;
  }

  const c = data.client;
  const t = data.totals;
  const isStaff = !!data.is_staff;
  const loginUser = data.staff_login_user;
  // Money trail shows BOTH credits (SC earned / amounts credited to KM
  // Foundation from this client) and debits (SC payout transactions, with
  // their transaction details).
  const trailRows = data.transactions || [];
  const creditTotal = trailRows.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + (tx.amount || 0), 0);
  const debitTotal = trailRows.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + (tx.amount || 0), 0);
  const netTotal = creditTotal - debitTotal;

  return (
    <div className="space-y-6 animate-fade-in" data-testid="client-detail">
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="back-to-clients">
        <ArrowLeft size={14} /> All clients
      </Link>

      {/* Header card */}
      <Card className="p-6 border border-border bg-card rounded-lg shadow-none">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-lg bg-muted text-foreground flex items-center justify-center font-medium text-lg overflow-hidden shrink-0">
              {isStaff && c.photo_url ? (
                <AuthedImage url={c.photo_url} alt={c.name} className="w-full h-full object-cover" testid="client-photo" fallback={(c.name || "?").slice(0, 2).toUpperCase()} />
              ) : (
                (c.name || "?").slice(0, 2).toUpperCase()
              )}
            </div>
            <div>
              <p className="label-eyebrow">{isStaff ? "Staff" : "Client"}</p>
              <h1 className="font-display text-3xl tracking-tight mt-0.5" data-testid="client-name">{c.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={`uppercase tracking-wider px-2 py-0.5 rounded ${TYPE_BADGE[c.client_type] || "bg-muted text-foreground"}`} data-testid="client-type-badge">
                  {clientTypeLabel(c.client_type)}
                </span>
                {isStaff && c.employee_id && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-100/60 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 uppercase tracking-wider" data-testid="client-employee-id">
                    <IdentificationBadge size={11} weight="duotone" /> {c.employee_id}
                  </span>
                )}
                {c._creator_office && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-100/60 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 uppercase tracking-wider">
                    <Buildings size={11} weight="duotone" /> {c._creator_office.replace("KM_", "KM ")}
                  </span>
                )}
                {isStaff && c.office && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-foreground uppercase tracking-wider">
                    <Buildings size={11} weight="duotone" /> {c.office.replace("KM_", "KM ")}
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                {c.email && <p className="flex items-center gap-2"><EnvelopeSimple size={14} /> {c.email}</p>}
                {c.phone && <p className="flex items-center gap-2"><Phone size={14} /> {c.phone}</p>}
                {c.company && <p className="flex items-center gap-2"><Buildings size={14} /> {c.company}</p>}
                {isStaff && c.place && <p className="flex items-center gap-2" data-testid="client-place"><MapPin size={14} /> {c.place}</p>}
                {isStaff && c.address && <p className="flex items-start gap-2" data-testid="client-address"><House size={14} className="mt-0.5 shrink-0" /> <span className="whitespace-pre-line">{c.address}</span></p>}
                {isStaff && c.date_of_birth && (
                  <p className="flex items-center gap-2"><Cake size={14} /> {new Date(c.date_of_birth).toLocaleDateString()}</p>
                )}
                {isStaff && c.eligible_incentive != null && (
                  <p className="flex items-center gap-2"><CurrencyInr size={14} /> ₹{c.eligible_incentive}/admission</p>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 self-start flex-wrap">
            <Button
              onClick={() => setTxnOpen(true)}
              data-testid="client-add-transaction"
              className="btn-amber border-0"
            >
              <Receipt size={14} className="mr-1.5" /> Add Transaction
            </Button>
            {user?.role === "super_admin" && (
              <Button
                variant="outline"
                onClick={() => setInvoiceOpen(true)}
                data-testid="client-new-invoice"
              >
                <FileText size={14} className="mr-1.5" /> New Invoice
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                // Prefer a human-readable slug (e.g. /ref=john-doe). Falls
                // back to the UUID if the client somehow has no name.
                const ref = slugifyRef(c.name) || c.id;
                const url = buildApplyUrl(ref);
                navigator.clipboard.writeText(url).then(
                  () => toast.success("Referral link copied", { description: url }),
                  () => window.prompt("Copy this referral link:", url),
                );
              }}
              data-testid="copy-referral-link"
            >
              <LinkIcon size={14} className="mr-1.5" /> Copy referral link
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadClientStatementPDF({ detail: data, user })}
              data-testid="download-client-pdf"
            >
              <DownloadSimple size={14} className="mr-1.5" /> Download PDF
            </Button>
            <Button variant="outline" onClick={load} data-testid="refresh-client-detail">
              <ArrowsClockwise size={14} className="mr-1.5" /> Refresh
            </Button>
          </div>
        </div>
      </Card>

      {/* Stat tiles */}
      <div className={`grid grid-cols-2 gap-3 ${isStaff ? "lg:grid-cols-3" : "lg:grid-cols-4"}`} data-testid="client-tiles">
        <Tile label="Students admitted" value={t.students_count} onClick={() => setTileKey("students")} data-testid="tile-students-admitted" />
        {isStaff ? (
          <>
            <Tile label="Incentive earned" value={formatMoney(t.incentive_earned, currency)} tone="info" onClick={() => setTileKey("incentive_earned")} data-testid="tile-incentive-earned" />
            <Tile label="Incentive pending" value={formatMoney(t.incentive_pending, currency)} tone={t.incentive_pending > 0 ? "danger" : "default"} onClick={() => setTileKey("incentive_pending")} data-testid="tile-incentive-pending" />
          </>
        ) : (
          <>
            <Tile label="SC Earned" value={formatMoney(t.sc_earned, currency)} tone="success" onClick={() => setTileKey("sc")} data-testid="tile-sc-earned" />
            <Tile label="Total credits" value={formatMoney(t.total_income, currency)} tone="success" onClick={() => setTileKey("credits")} data-testid="tile-total-credits" />
            <Tile label="Total debits" value={formatMoney(t.total_expense, currency)} tone="danger" onClick={() => setTileKey("debits")} data-testid="tile-total-debits" />
          </>
        )}
      </div>

      {/* Leave quota (staff with a linked login account) */}
      {isStaff && loginUser && (
        <Card className="p-5 border border-border bg-card rounded-lg shadow-none flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid="client-leave-quota">
          <div>
            <div className="flex items-center gap-2">
              <CalendarCheck size={18} className="text-orange-600 dark:text-orange-400" weight="duotone" />
              <p className="label-eyebrow">Leave quota (per year)</p>
              {loginUser.has_override
                ? <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300" data-testid="client-quota-custom">Custom</span>
                : <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Company policy</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-sm" data-testid="client-quota-values">
              {[["Casual", loginUser.leave_quota?.casual], ["Sick", loginUser.leave_quota?.sick], ["Earned", loginUser.leave_quota?.earned], ["Unpaid", loginUser.leave_quota?.unpaid == null ? "∞" : loginUser.leave_quota?.unpaid]].map(([k, v]) => (
                <span key={k} className="px-2 py-0.5 rounded bg-muted text-foreground tabular-nums">{k} <span className="font-medium">{v}</span></span>
              ))}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setQuotaOpen(true)} data-testid="client-edit-quota">
            <PencilSimple size={14} className="mr-1.5" /> Edit quota
          </Button>
        </Card>
      )}

      {/* Students admitted */}
      <Card className="border border-border bg-card rounded-lg shadow-none overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <p className="label-eyebrow">Admissions</p>
          <h3 className="font-display text-lg mt-0.5">
            Students {isStaff ? "they enrolled" : "they referred"}
          </h3>
        </div>
        {data.students.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground" data-testid="empty-client-students">No students linked yet.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left bg-muted/40 border-b border-border">
                <th className="px-6 py-3 label-eyebrow">Student</th>
                <th className="px-6 py-3 label-eyebrow">Course</th>
                <th className="px-6 py-3 label-eyebrow">College</th>
                <th className="px-6 py-3 label-eyebrow">Status</th>
                <th className="px-6 py-3 label-eyebrow">Enrolled</th>
                {!isStaff && <th className="px-6 py-3 label-eyebrow text-right">SC Earned</th>}
                {isStaff && <th className="px-6 py-3 label-eyebrow text-right">Incentive</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.students.map((st) => (
                <tr key={st.id} className="hover:bg-muted/40" data-testid={`client-st-row-${st.id}`}>
                  <td className="px-6 py-3">
                    <Link to={`/students/${st.id}`} className="font-medium text-foreground hover:text-orange-700 dark:text-orange-400 underline-offset-4 hover:underline" data-testid={`client-st-link-${st.id}`}>
                      {st.name}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">{st.course || "—"}</td>
                  <td className="px-6 py-3 text-muted-foreground">{st.college || "—"}</td>
                  <td className="px-6 py-3">
                    <span className={`uppercase tracking-wider px-2 py-0.5 rounded text-[10px] ${STATUS_BADGE[st.status] || "bg-muted text-foreground"}`}>{st.status}</span>
                  </td>
                  <td className="px-6 py-3 tabular-nums text-muted-foreground">{st.enrollment_date ? formatDate(st.enrollment_date) : "—"}</td>
                  {!isStaff && (
                    <td className="px-6 py-3 text-right tabular-nums">{formatMoney(st.sc_out_fixed, currency)}</td>
                  )}
                  {isStaff && (
                    <td className="px-6 py-3 text-right">
                      {st.incentive_eligible ? (
                        <div className="flex items-center justify-end gap-1.5 text-xs">
                          <span className="tabular-nums font-medium">{formatMoney(st.incentive_amount, currency)}</span>
                          {st.incentive_paid ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" data-testid={`client-st-incentive-paid-${st.id}`}>
                              <Check size={11} weight="bold" /> Paid
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" data-testid={`client-st-incentive-pending-${st.id}`}>
                              Pending
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              <tr className="bg-muted/40 font-medium">
                <td colSpan={5} className="px-6 py-3 text-muted-foreground label-eyebrow">Total</td>
                {!isStaff && (
                  <td className="px-6 py-3 text-right tabular-nums" data-testid="client-st-total-sc">{formatMoney(t.sc_earned, currency)}</td>
                )}
                {isStaff && (
                  <td className="px-6 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400" data-testid="client-st-total-incentive">
                    {formatMoney(t.incentive_earned, currency)}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {/* Transactions (non-staff clients) */}
      {!isStaff && (
        <Card className="border border-border bg-card rounded-lg shadow-none overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <p className="label-eyebrow">Money trail</p>
            <h3 className="font-display text-lg mt-0.5">Credits &amp; debits for {c.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Credits to the company from this client, plus SC payout transaction details.</p>
          </div>
          {trailRows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground" data-testid="empty-client-tx">
              No transactions for this client yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left bg-muted/40 border-b border-border">
                  <th className="px-6 py-3 label-eyebrow">Date</th>
                  <th className="px-6 py-3 label-eyebrow">Description</th>
                  <th className="px-6 py-3 label-eyebrow">Type</th>
                  <th className="px-6 py-3 label-eyebrow text-right">Amount</th>
                  <th className="px-6 py-3 label-eyebrow text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {trailRows.map((tx) => {
                  const isCredit = tx.type === "income";
                  return (
                  <tr key={tx.id} className="hover:bg-muted/40" data-testid={`client-tx-row-${tx.id}`}>
                    <td className="px-6 py-3 tabular-nums text-muted-foreground">{formatDate(tx.date)}</td>
                    <td className="px-6 py-3">{tx.description || "—"}</td>
                    <td className="px-6 py-3">
                      {isCredit ? (
                        <span className="uppercase tracking-wider text-[10px] px-2 py-0.5 rounded bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          Credit
                        </span>
                      ) : (
                        <span className="uppercase tracking-wider text-[10px] px-2 py-0.5 rounded bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400">
                          Debit
                        </span>
                      )}
                    </td>
                    <td className={`px-6 py-3 text-right tabular-nums font-medium ${isCredit ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
                      {isCredit ? "+" : "-"} {formatMoney(tx.amount, currency)}
                    </td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      {tx.is_sc_earned ? (
                        tx.sc_given ? (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" data-testid={`client-sc-given-${tx.id}`}>
                            <Check size={11} weight="bold" /> SC given
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setScInvoice(tx)}
                            data-testid={`client-pay-sc-${tx.id}`}
                          >
                            <HandCoins size={13} className="mr-1" /> Pay SC now
                          </Button>
                        )
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
                <tr className="bg-muted/40 font-medium">
                  <td colSpan={3} className="px-6 py-3 text-muted-foreground label-eyebrow">Net (credits − debits)</td>
                  <td className={`px-6 py-3 text-right tabular-nums ${netTotal >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`} data-testid="client-tx-net">
                    {netTotal < 0 ? "-" : ""}{formatMoney(Math.abs(netTotal), currency)}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </Card>
      )}
      {isStaff && loginUser && (
        <StaffQuotaDialog
          open={quotaOpen}
          onOpenChange={setQuotaOpen}
          userId={loginUser.id}
          userName={loginUser.name || c.name}
          onSaved={load}
        />
      )}
      <ClientTxnDialog open={txnOpen} onOpenChange={setTxnOpen} client={c} onSaved={load} />
      {user?.role === "super_admin" && (
        <InvoiceCreateDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} presetClientId={c.id} onCreated={load} />
      )}
      <TileListDialog
        tileKey={tileKey}
        onClose={() => setTileKey(null)}
        data={data}
        currency={currency}
      />
      <ScPayoutDialog
        row={scInvoice}
        onClose={() => setScInvoice(null)}
        clientId={c.id}
        onPaid={() => { setScInvoice(null); load(); }}
      />
    </div>
  );
}

function Tile({ label, value, tone, onClick, "data-testid": tid }) {
  const clickable = typeof onClick === "function";
  return (
    <Card
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={`p-4 border border-border bg-card rounded-lg shadow-none transition-colors ${clickable ? "cursor-pointer hover:border-orange-400/60 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60" : ""}`}
      data-testid={tid}
    >
      <p className="label-eyebrow">{label}</p>
      <p className={`font-display text-2xl mt-2 tabular-nums ${
        tone === "success" ? "text-emerald-700 dark:text-emerald-400" :
        tone === "danger" ? "text-rose-700 dark:text-rose-400" :
        tone === "info" ? "text-sky-700 dark:text-sky-400" : "text-foreground"
      }`}>{value}</p>
      {clickable && <p className="text-[11px] text-muted-foreground mt-1">Click to view list</p>}
    </Card>
  );
}

const TILE_META = {
  students: { title: "Students admitted", desc: "All students linked to this client." },
  sc: { title: "Service charge earned", desc: "Per-student service charge and clearance status." },
  credits: { title: "Total credits", desc: "Income transactions linked to this client." },
  debits: { title: "Total debits", desc: "Expense transactions linked to this client." },
  incentive_earned: { title: "Incentive earned", desc: "Admissions eligible for incentive." },
  incentive_pending: { title: "Incentive pending", desc: "Eligible admissions not yet paid." },
};

function TileListDialog({ tileKey, onClose, data, currency }) {
  const meta = tileKey ? TILE_META[tileKey] : null;
  const students = data?.students || [];
  const txs = data?.transactions || [];

  let rows = null;
  if (tileKey === "students") {
    rows = students.length ? (
      <ListTable
        head={["Student", "Course", "College", "Status", "Enrolled"]}
        body={students.map((s) => [
          s.name,
          s.course || "—",
          s.college || "—",
          <span className={`uppercase tracking-wider px-2 py-0.5 rounded text-[10px] ${STATUS_BADGE[s.status] || "bg-muted text-foreground"}`}>{s.status}</span>,
          s.enrollment_date ? formatDate(s.enrollment_date) : "—",
        ])}
        keys={students.map((s) => s.id)}
      />
    ) : <Empty text="No students linked yet." />;
  } else if (tileKey === "sc") {
    rows = students.length ? (
      <ListTable
        head={["Student", "College", "SC Earned", "SC Status"]}
        align={{ 2: "right" }}
        body={students.map((s) => [
          s.name,
          s.college || "—",
          formatMoney(s.sc_out_fixed, currency),
          <span className={`uppercase tracking-wider px-2 py-0.5 rounded text-[10px] ${(SC_STATUS[s.sc_status] || SC_STATUS.pending).cls}`}>{(SC_STATUS[s.sc_status] || SC_STATUS.pending).label}</span>,
        ])}
        keys={students.map((s) => s.id)}
      />
    ) : <Empty text="No service charge earned yet." />;
  } else if (tileKey === "credits" || tileKey === "debits") {
    const filtered = txs.filter((tx) => tx.type === (tileKey === "credits" ? "income" : "expense"));
    rows = filtered.length ? (
      <ListTable
        head={["Date", "Description", "Amount"]}
        align={{ 2: "right" }}
        body={filtered.map((tx) => [
          formatDate(tx.date),
          tx.description || "—",
          <span className={tileKey === "credits" ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-rose-700 dark:text-rose-400 font-medium"}>
            {tileKey === "credits" ? "+" : "-"} {formatMoney(tx.amount, currency)}
          </span>,
        ])}
        keys={filtered.map((tx) => tx.id)}
      />
    ) : <Empty text={tileKey === "credits" ? "No credits yet." : "No debits yet."} />;
  } else if (tileKey === "incentive_earned" || tileKey === "incentive_pending") {
    const filtered = students.filter((s) => s.incentive_eligible && (tileKey === "incentive_earned" || !s.incentive_paid));
    rows = filtered.length ? (
      <ListTable
        head={["Student", "Enrolled", "Amount", "Status"]}
        align={{ 2: "right" }}
        body={filtered.map((s) => [
          s.name,
          s.enrollment_date ? formatDate(s.enrollment_date) : "—",
          formatMoney(s.incentive_amount, currency),
          <span className={`uppercase tracking-wider px-2 py-0.5 rounded text-[10px] ${s.incentive_paid ? "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>{s.incentive_paid ? "Paid" : "Pending"}</span>,
        ])}
        keys={filtered.map((s) => s.id)}
      />
    ) : <Empty text="Nothing here yet." />;
  }

  return (
    <Dialog open={!!tileKey} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-card max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="tile-list-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">{meta?.title}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{meta?.desc}</DialogDescription>
        </DialogHeader>
        {rows}
      </DialogContent>
    </Dialog>
  );
}

function ListTable({ head, body, keys, align = {} }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left bg-muted/40 border-b border-border">
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2 label-eyebrow ${align[i] === "right" ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {body.map((cells, r) => (
            <tr key={keys?.[r] ?? r} className="hover:bg-muted/40" data-testid={`tile-list-row-${keys?.[r] ?? r}`}>
              {cells.map((cell, ci) => (
                <td key={ci} className={`px-3 py-2 ${align[ci] === "right" ? "text-right tabular-nums" : ""}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function ScPayoutDialog({ row, onClose, clientId, onPaid }) {
  // "Pay SC now" opens the Service Charge Invoice popup prefilled for the
  // student + amount. When that invoice is saved with status "paid", the
  // backend flips the matching SC adjustment to sc_given (money trail badge).
  const preset = row
    ? { invoice_type: "service_charge", student_name: row._sc_student_name, sc_amount: row.amount }
    : null;
  return (
    <InvoiceCreateDialog
      open={!!row}
      onOpenChange={(v) => { if (!v) onClose(); }}
      presetClientId={clientId}
      preset={preset}
      onCreated={onPaid}
    />
  );
}

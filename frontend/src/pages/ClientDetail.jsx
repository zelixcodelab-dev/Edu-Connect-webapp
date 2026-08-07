import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatDate } from "@/lib/format";
import { buildApplyUrl, slugifyRef } from "@/lib/applyUrl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, EnvelopeSimple, Phone, Buildings, Cake, CurrencyInr, ArrowsClockwise, Check, DownloadSimple, Link as LinkIcon, IdentificationBadge, MapPin, House, CalendarCheck, PencilSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { clientTypeLabel, photoSrc } from "@/pages/Clients";
import { downloadClientStatementPDF } from "@/lib/clientStatementPdf";
import StaffQuotaDialog from "@/components/leave/StaffQuotaDialog";

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

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const currency = user?.currency || "USD";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quotaOpen, setQuotaOpen] = useState(false);

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
                <img src={photoSrc(c.photo_url)} alt={c.name} className="w-full h-full object-cover" data-testid="client-photo" />
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
        <Tile label="Students admitted" value={t.students_count} data-testid="tile-students-admitted" />
        {isStaff ? (
          <>
            <Tile label="Incentive earned" value={formatMoney(t.incentive_earned, currency)} tone="info" data-testid="tile-incentive-earned" />
            <Tile label="Incentive pending" value={formatMoney(t.incentive_pending, currency)} tone={t.incentive_pending > 0 ? "danger" : "default"} data-testid="tile-incentive-pending" />
          </>
        ) : (
          <>
            <Tile label="SC Earned" value={formatMoney(t.sc_earned, currency)} tone="success" data-testid="tile-sc-earned" />
            <Tile label="Total credits" value={formatMoney(t.total_income, currency)} tone="success" data-testid="tile-total-credits" />
            <Tile label="Total debits" value={formatMoney(t.total_expense, currency)} tone="danger" data-testid="tile-total-debits" />
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
            <h3 className="font-display text-lg mt-0.5">Credits &amp; debits linked to {c.name}</h3>
          </div>
          {data.transactions.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground" data-testid="empty-client-tx">
              No transactions tagged to this client yet.
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
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-muted/40" data-testid={`client-tx-row-${tx.id}`}>
                    <td className="px-6 py-3 tabular-nums text-muted-foreground">{formatDate(tx.date)}</td>
                    <td className="px-6 py-3">{tx.description || "—"}</td>
                    <td className="px-6 py-3">
                      <span className={`uppercase tracking-wider text-[10px] px-2 py-0.5 rounded ${tx.type === "income" ? "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400"}`}>
                        {tx.type === "income" ? "Credit" : "Debit"}
                      </span>
                    </td>
                    <td className={`px-6 py-3 text-right tabular-nums font-medium ${tx.type === "income" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
                      {tx.type === "income" ? "+" : "-"} {formatMoney(tx.amount, currency)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-medium">
                  <td colSpan={3} className="px-6 py-3 text-muted-foreground label-eyebrow">Net</td>
                  <td className={`px-6 py-3 text-right tabular-nums ${t.net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`} data-testid="client-tx-net">
                    {formatMoney(t.net, currency)}
                  </td>
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
    </div>
  );
}

function Tile({ label, value, tone, "data-testid": tid }) {
  return (
    <Card className="p-4 border border-border bg-card rounded-lg shadow-none" data-testid={tid}>
      <p className="label-eyebrow">{label}</p>
      <p className={`font-display text-2xl mt-2 tabular-nums ${
        tone === "success" ? "text-emerald-700 dark:text-emerald-400" :
        tone === "danger" ? "text-rose-700 dark:text-rose-400" :
        tone === "info" ? "text-sky-700 dark:text-sky-400" : "text-foreground"
      }`}>{value}</p>
    </Card>
  );
}

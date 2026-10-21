import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canEdit } from "@/lib/perm";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UsersThree, Briefcase, IdentificationBadge, HandCoins, Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PAYMENT_MODES, PAYMENT_MODE_LABELS, SC_PAYOUT_CLIENT_TYPES, SC_PAYOUT_CLIENT_TYPE_LABELS } from "@/lib/paymentModes";

const TYPE_META = {
  sub_agent: { label: "Sub Agent", icon: UsersThree, color: "bg-violet-100/60 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  associate: { label: "Associate", icon: Briefcase, color: "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  km: { label: "KM", icon: IdentificationBadge, color: "bg-sky-100/60 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400" },
};

const emptyPayout = () => ({ amount: "", client_id: "", payment_mode: "", account_id: "", date: todayISO(), description: "" });

export default function Agents() {
  const { user } = useAuth();
  const currency = user?.currency || "USD";
  const allowEdit = canEdit(user, "transactions");
  const [rows, setRows] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyPayout());
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [l, p, a, c] = await Promise.all([
      api.get("/students/agent-ledger"),
      api.get("/transactions/sc-payouts"),
      api.get("/accounts"),
      api.get("/clients"),
    ]);
    setRows(l.data); setPayouts(p.data); setAccounts(a.data); setClients(c.data);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const payoutClients = useMemo(
    () => clients.filter((c) => SC_PAYOUT_CLIENT_TYPES.includes(c.client_type)),
    [clients],
  );
  const accountMap = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  const totals = rows.reduce((acc, r) => ({
    received: acc.received + r.total_received,
    paid: acc.paid + r.paid_to_college,
    sc: acc.sc + r.sc_adjusted,
    paidOut: acc.paidOut + (r.sc_paid_out || 0),
    holding: acc.holding + r.holding,
  }), { received: 0, paid: 0, sc: 0, paidOut: 0, holding: 0 });

  const openCreate = () => { setEditing(null); setForm({ ...emptyPayout(), _kind: "payout", student_name: "", account_id: accounts[0]?.id || "" }); setOpen(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ amount: String(p.amount), client_id: p.client_id || "", payment_mode: p.payment_mode || "", account_id: p.account_id || "", date: p.date || todayISO(), description: p.description || "", _kind: p._kind || "payout", student_name: p.student_name || "" });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.client_id) { toast.error("Pick a recipient"); return; }
    if (!form.account_id) { toast.error("Pick an account"); return; }
    const isCampus = form._kind === "campus_visit";
    const payload = {
      type: "expense",
      amount: parseFloat(form.amount) || 0,
      account_id: form.account_id,
      category_id: null,
      date: form.date,
      description: form.description,
      is_sc_payout: !isCampus,
      expense_of: isCampus ? "campus_visit" : null,
      client_id: form.client_id,
      payment_mode: form.payment_mode || null,
      student_name: form.student_name || null,
    };
    try {
      if (editing) {
        await api.patch(`/transactions/${editing.id}`, payload);
        toast.success("Updated");
      } else {
        await api.post("/transactions", payload);
        toast.success("Payout recorded");
      }
      setOpen(false); load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this entry?")) return;
    await api.delete(`/transactions/${id}`);
    toast.success("Deleted");
    load();
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="agents-page">
      <header>
        <p className="label-eyebrow">Network</p>
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Sub-agent ledger</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How much money has flowed through each sub-agent, associate and KM — and how much they're still holding.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="agent-totals">
        <Tile label="Routed through" value={formatMoney(totals.received, currency)} />
        <Tile label="Paid to college" value={formatMoney(totals.paid, currency)} tone="info" />
        <Tile label="SC adjusted" value={formatMoney(totals.sc, currency)} tone="success" />
        <Tile label="SC paid out" value={formatMoney(totals.paidOut, currency)} tone="warning" />
        <Tile label="Currently holding" value={formatMoney(totals.holding, currency)} tone={totals.holding > 0 ? "danger" : "default"} />
      </div>

      <Card className="border border-border bg-card rounded-lg shadow-none overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground" data-testid="loading">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground" data-testid="empty-agents">
            <UsersThree size={32} className="mx-auto text-muted-foreground/50 mb-3" />
            No sub-agent activity yet. Log a payment with a sub-agent / associate / KM route on a student to populate this view.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-muted/40 border-b border-border">
                  <th className="px-6 py-3 label-eyebrow">Agent</th>
                  <th className="px-6 py-3 label-eyebrow">Type</th>
                  <th className="px-6 py-3 label-eyebrow text-center">Students</th>
                  <th className="px-6 py-3 label-eyebrow text-center">Payments</th>
                  <th className="px-6 py-3 label-eyebrow text-right">Routed</th>
                  <th className="px-6 py-3 label-eyebrow text-right">→ College</th>
                  <th className="px-6 py-3 label-eyebrow text-right">SC Adjusted</th>
                  <th className="px-6 py-3 label-eyebrow text-right">SC Paid out</th>
                  <th className="px-6 py-3 label-eyebrow text-right">Holding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => {
                  const meta = TYPE_META[r.type] || TYPE_META.sub_agent;
                  const Icon = meta.icon;
                  return (
                    <tr key={`${r.type}-${r.name}-${i}`} className="hover:bg-muted/40" data-testid={`agent-row-${r.type}-${r.name.replace(/\W+/g, "-")}`}>
                      <td className="px-6 py-3.5 font-medium">{r.name}</td>
                      <td className="px-6 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.color}`}>
                          <Icon size={12} /> {meta.label}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-center text-muted-foreground">{r.students_count}</td>
                      <td className="px-6 py-3.5 text-center text-muted-foreground">{r.payments_count}</td>
                      <td className="px-6 py-3.5 text-right tabular-nums font-medium">{formatMoney(r.total_received, currency)}</td>
                      <td className="px-6 py-3.5 text-right tabular-nums text-sky-700 dark:text-sky-400">{formatMoney(r.paid_to_college, currency)}</td>
                      <td className="px-6 py-3.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(r.sc_adjusted, currency)}</td>
                      <td className="px-6 py-3.5 text-right tabular-nums text-amber-700 dark:text-amber-400">{(r.sc_paid_out || 0) > 0 ? formatMoney(r.sc_paid_out, currency) : "—"}</td>
                      <td className={`px-6 py-3.5 text-right tabular-nums font-medium ${r.holding > 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"}`}>{formatMoney(r.holding, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Service Charge payouts */}
      <Card className="border border-border bg-card rounded-lg shadow-none overflow-hidden" data-testid="sc-payouts-card">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-3">
          <div>
            <p className="label-eyebrow flex items-center gap-1.5"><HandCoins size={13} /> Service Charge payouts</p>
            <h3 className="font-display text-lg mt-0.5">Money paid out to sub-associates / consultants</h3>
          </div>
          {allowEdit && (
            <Button onClick={openCreate} data-testid="add-payout-btn" className="h-9 btn-amber border-0">
              <Plus size={15} className="mr-1.5" /> Add payout
            </Button>
          )}
        </div>
        {payouts.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground" data-testid="empty-payouts">
            No Service Charge payouts recorded yet. Use "Add payout" or tick "Service Charge payout" when adding a transaction.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-muted/40 border-b border-border">
                  <th className="px-6 py-3 label-eyebrow">Date</th>
                  <th className="px-6 py-3 label-eyebrow">Type</th>
                  <th className="px-6 py-3 label-eyebrow">Recipient</th>
                  <th className="px-6 py-3 label-eyebrow">Student</th>
                  <th className="px-6 py-3 label-eyebrow">Mode</th>
                  <th className="px-6 py-3 label-eyebrow">Account</th>
                  <th className="px-6 py-3 label-eyebrow text-right">Amount</th>
                  {allowEdit && <th className="px-6 py-3 label-eyebrow"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/40" data-testid={`payout-row-${p.id}`}>
                    <td className="px-6 py-3.5 tabular-nums text-muted-foreground">{formatDate(p.date)}</td>
                    <td className="px-6 py-3.5">
                      <span className={`inline-flex items-center text-[11px] px-1.5 py-0.5 rounded ${p._kind === "campus_visit" ? "bg-sky-100/70 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400" : "bg-amber-100/70 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
                        {p._kind === "campus_visit" ? "Campus Visit" : "Payout"}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="font-medium">{p._client_name || "—"}</span>
                      {p._client_type && (
                        <span className="block text-[11px] text-muted-foreground">{SC_PAYOUT_CLIENT_TYPE_LABELS[p._client_type] || p._client_type}</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-muted-foreground">{p.student_name || "—"}</td>
                    <td className="px-6 py-3.5 text-muted-foreground">{PAYMENT_MODE_LABELS[p.payment_mode] || "—"}</td>
                    <td className="px-6 py-3.5 text-muted-foreground">{p._account_name || accountMap[p.account_id]?.name || "—"}</td>
                    <td className="px-6 py-3.5 text-right tabular-nums font-medium text-amber-700 dark:text-amber-400">{formatMoney(p.amount, currency)}</td>
                    {allowEdit && (
                      <td className="px-6 py-3.5 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(p)} data-testid={`edit-payout-${p.id}`} className="text-muted-foreground hover:text-foreground p-1.5"><PencilSimple size={16} /></button>
                        <button onClick={() => remove(p.id)} data-testid={`delete-payout-${p.id}`} className="text-muted-foreground hover:text-rose-700 dark:text-rose-400 p-1.5"><Trash size={16} /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card" data-testid="payout-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing ? "Edit" : "Add"} Service Charge payout</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Recipient</Label>
                <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                  <SelectTrigger data-testid="payout-recipient"><SelectValue placeholder="Select recipient" /></SelectTrigger>
                  <SelectContent>
                    {payoutClients.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground text-center">No Sub-Associate / Associate Consultant clients yet.</div>
                    ) : payoutClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} · {SC_PAYOUT_CLIENT_TYPE_LABELS[c.client_type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="payout-amount" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Mode of transaction</Label>
                <Select value={form.payment_mode} onValueChange={(v) => setForm({ ...form, payment_mode: v })}>
                  <SelectTrigger data-testid="payout-mode"><SelectValue placeholder="Select mode" /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Account</Label>
                <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                  <SelectTrigger data-testid="payout-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="payout-date" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was this for?" data-testid="payout-notes" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="payout-cancel">Cancel</Button>
              <Button type="submit" className="btn-amber border-0" data-testid="payout-save">{editing ? "Save" : "Add"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({ label, value, tone }) {
  return (
    <Card className="p-4 border border-border bg-card rounded-lg shadow-none">
      <p className="label-eyebrow">{label}</p>
      <p className={`font-display text-2xl mt-2 tabular-nums ${
        tone === "success" ? "text-emerald-700 dark:text-emerald-400" :
        tone === "danger" ? "text-rose-700 dark:text-rose-400" :
        tone === "warning" ? "text-amber-700 dark:text-amber-400" :
        tone === "info" ? "text-sky-700 dark:text-sky-400" : "text-foreground"
      }`}>{value}</p>
    </Card>
  );
}

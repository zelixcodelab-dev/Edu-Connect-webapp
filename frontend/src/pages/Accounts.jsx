import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canEdit } from "@/lib/perm";
import { formatMoney, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, PencilSimple, Trash, Bank, Wallet, CreditCard, DownloadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { downloadAccountStatementPDF } from "@/lib/accountStatementPdf";

const TYPES = [
  { value: "bank", label: "Bank", icon: Bank },
  { value: "cash", label: "Cash", icon: Wallet },
  { value: "credit_card", label: "Credit card", icon: CreditCard },
];

const empty = { name: "", type: "bank", opening_balance: 0, color: "#10b981" };
const COLORS = ["#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#78716c"];

export default function Accounts() {
  const { user } = useAuth();
  const allowEdit = canEdit(user, "accounts");
  const currency = user?.currency || "USD";
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null); // { account, txns, loading }
  const [range, setRange] = useState({ from: "", to: "" });

  const load = async () => {
    const { data } = await api.get("/accounts");
    setList(data);
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (a) => { setEditing(a); setForm({ name: a.name, type: a.type, opening_balance: a.opening_balance, color: a.color || "#10b981" }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    const payload = { ...form, opening_balance: parseFloat(form.opening_balance) || 0 };
    try {
      if (editing) await api.patch(`/accounts/${editing.id}`, payload);
      else await api.post("/accounts", payload);
      toast.success(editing ? "Account updated" : "Account added");
      setOpen(false); load();
    } catch { toast.error("Failed"); }
  };

  const remove = async (id) => {
    if (!confirm("Delete this account?")) return;
    await api.delete(`/accounts/${id}`);
    toast.success("Deleted"); load();
  };

  const downloadStatement = async (a, fromDate = "", toDate = "") => {
    try {
      const { data } = await api.get(`/transactions?account_id=${a.id}&limit=5000`);
      downloadAccountStatementPDF({ account: a, transactions: data || [], user, currency, fromDate, toDate });
      toast.success("Statement downloaded");
    } catch {
      toast.error("Could not generate statement");
    }
  };

  const openDetail = async (a) => {
    setRange({ from: "", to: "" });
    setDetail({ account: a, txns: [], loading: true });
    try {
      const { data } = await api.get(`/transactions?account_id=${a.id}&limit=10`);
      setDetail({ account: a, txns: data || [], loading: false });
    } catch {
      setDetail({ account: a, txns: [], loading: false });
    }
  };

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const applyPreset = (key) => {
    const now = new Date();
    if (key === "this_month") {
      setRange({ from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) });
    } else if (key === "last_month") {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      setRange({ from: iso(first), to: iso(last) });
    } else if (key === "this_fy") {
      // Indian FY: Apr 1 – Mar 31
      const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      setRange({ from: iso(new Date(fyStartYear, 3, 1)), to: iso(now) });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="accounts-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">Money sources</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Accounts</h1>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          {allowEdit && (
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="add-account-btn" className="h-10 btn-amber border-0">
              <Plus size={16} className="mr-1.5" /> Add account
            </Button>
          </DialogTrigger>
          )}
          <DialogContent className="bg-card">
            <DialogHeader><DialogTitle className="font-display">{editing ? "Edit" : "Add"} account</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chase Business" data-testid="acc-name" />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="acc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Opening balance</Label>
                <Input type="number" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} data-testid="acc-balance" />
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex gap-2 mt-1">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                      className={`w-7 h-7 rounded-md border-2 ${form.color === c ? 'border-foreground' : 'border-transparent'}`}
                      style={{ background: c }} data-testid={`acc-color-${c}`} />
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="btn-amber border-0" data-testid="acc-save">{editing ? "Save" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {list.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground border border-border shadow-none">No accounts yet.</Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((a) => {
            const TypeIcon = TYPES.find(t => t.value === a.type)?.icon || Bank;
            return (
              <Card key={a.id} onClick={() => openDetail(a)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(a); } }} className="p-6 border border-border bg-card rounded-lg shadow-none lift cursor-pointer hover:border-orange-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60 transition-colors" data-testid={`account-card-${a.id}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ background: `${a.color}1a`, color: a.color }}>
                      <TypeIcon size={20} weight="regular" />
                    </div>
                    <div>
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{a.type.replace("_", " ")}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); downloadStatement(a); }} data-testid={`statement-acc-${a.id}`} className="text-muted-foreground hover:text-foreground p-1.5" title="Download credit & debit statement (PDF)"><DownloadSimple size={16} /></button>
                    {allowEdit && <button onClick={(e) => { e.stopPropagation(); openEdit(a); }} data-testid={`edit-acc-${a.id}`} className="text-muted-foreground hover:text-foreground p-1.5"><PencilSimple size={16} /></button>}
                    {allowEdit && <button onClick={(e) => { e.stopPropagation(); remove(a.id); }} data-testid={`delete-acc-${a.id}`} className="text-muted-foreground hover:text-rose-700 dark:text-rose-400 p-1.5"><Trash size={16} /></button>}
                  </div>
                </div>
                <div className="mt-5">
                  <p className="label-eyebrow">Balance</p>
                  <p className="font-display text-3xl mt-1 tabular-nums">{formatMoney(a.current_balance ?? a.opening_balance, currency)}</p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null); }}>
        <DialogContent className="bg-card max-w-lg max-h-[85vh] overflow-y-auto" data-testid="account-detail-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">{detail?.account?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 min-w-0">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="label-eyebrow">Balance</p>
                  <p className="font-display text-3xl mt-1 tabular-nums" data-testid="account-detail-balance">
                    {formatMoney(detail.account.current_balance ?? detail.account.opening_balance, currency)}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">{detail.account.type.replace("_", " ")}</p>
                </div>
              </div>
              <div className="rounded-md border border-border p-3 space-y-3">
                <p className="label-eyebrow">Statement period</p>
                <div className="flex flex-wrap gap-2">
                  {[["this_month", "This month"], ["last_month", "Last month"], ["this_fy", "This FY"]].map(([k, lbl]) => (
                    <button key={k} type="button" onClick={() => applyPreset(k)} data-testid={`statement-preset-${k}`} className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-orange-400/60 transition-colors">{lbl}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">From</Label>
                    <Input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} data-testid="statement-from-date" className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">To</Label>
                    <Input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} data-testid="statement-to-date" className="h-9" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{range.from || range.to ? "Leave a field blank for an open-ended range." : "Blank dates export the full history."}</p>
                  {(range.from || range.to) && (
                    <button type="button" onClick={() => setRange({ from: "", to: "" })} data-testid="statement-clear-range" className="text-xs text-muted-foreground hover:text-foreground underline shrink-0">Clear</button>
                  )}
                </div>
                <Button variant="outline" onClick={() => downloadStatement(detail.account, range.from, range.to)} data-testid="account-detail-statement" className="h-9 w-full">
                  <DownloadSimple size={15} className="mr-1.5" /> Download statement{range.from || range.to ? " (period)" : ""}
                </Button>
              </div>
              <div>
                <p className="label-eyebrow mb-2">Last 10 transactions</p>
                {detail.loading ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
                ) : detail.txns.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center" data-testid="account-detail-empty">No transactions in this account yet.</p>
                ) : (
                  <div className="divide-y divide-border rounded-md border border-border">
                    {detail.txns.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm" data-testid={`account-detail-txn-${t.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className="truncate">{t.description || "—"}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">{formatDate(t.date)}</p>
                        </div>
                        <span className={`tabular-nums font-medium whitespace-nowrap shrink-0 ${t.type === "income" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
                          {t.type === "income" ? "+" : "-"} {formatMoney(t.amount, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

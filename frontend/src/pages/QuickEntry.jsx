import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, todayISO } from "@/lib/format";
import { navigateToApply, linkedUserRef } from "@/lib/applyUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MoneyOutFields from "@/components/MoneyOutFields";
import { SC_PAYOUT_CLIENT_TYPES } from "@/lib/paymentModes";
import {
  HandCoins, ArrowUpRight, Plus, ArrowLeft, FileText,
  Receipt, ReceiptX, Student as StudentIcon, CurrencyInr, ClipboardText,
} from "@phosphor-icons/react";
import { toast } from "sonner";

function HubCard({ icon: Icon, palette, title, subtitle, onClick, testId }) {
  const PAL = {
    amber: "bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100/70 dark:hover:bg-amber-500/20 border-amber-200/60 dark:border-amber-500/30",
    rose: "bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100/70 dark:hover:bg-rose-500/20 border-rose-200/60 dark:border-rose-500/30",
    emerald: "bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100/70 dark:hover:bg-emerald-500/20 border-emerald-200/60 dark:border-emerald-500/30",
    violet: "bg-violet-50 dark:bg-violet-500/10 hover:bg-violet-100/70 dark:hover:bg-violet-500/20 border-violet-200/60 dark:border-violet-500/30",
  };
  const ICON_PAL = {
    amber: "bg-amber-gradient text-white",
    rose: "bg-rose-500 text-white",
    emerald: "bg-emerald-500 text-white",
    violet: "bg-violet-500 text-white",
  };
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className={`text-left p-6 rounded-2xl border-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg shadow-orange-500/0 hover:shadow-orange-500/10 ${PAL[palette]}`}>
      <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${ICON_PAL[palette]} shadow-lg`}>
        <Icon size={26} weight="duotone" />
      </div>
      <h3 className="font-display text-xl mt-5 text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </button>
  );
}

const KIND_TABS = [
  { value: "payout", label: "Payout", icon: HandCoins, active: "border-amber-500 bg-amber-100/50 dark:bg-amber-500/10 ring-2 ring-amber-200 dark:ring-amber-500/30", chip: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400" },
  { value: "expense", label: "Expense", icon: ReceiptX, active: "border-rose-500 bg-rose-100/50 dark:bg-rose-500/10 ring-2 ring-rose-200 dark:ring-rose-500/30", chip: "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400" },
  { value: "income", label: "Income", icon: ArrowUpRight, active: "border-emerald-500 bg-emerald-100/50 dark:bg-emerald-500/10 ring-2 ring-emerald-200 dark:ring-emerald-500/30", chip: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" },
];

export default function QuickEntry() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const currency = user?.currency || "USD";
  const isOfficeAdmin = user?.role === "office_admin";
  const isSuper = user?.role === "super_admin";
  const isLightUser = user?.role === "user";
  const linkedRef = linkedUserRef(user);

  useEffect(() => {
    if (isLightUser && linkedRef) navigateToApply(nav, linkedRef, { replace: true });
  }, [isLightUser, linkedRef, nav]);

  // Open straight on the form when ?view=transaction (used by the mobile FAB).
  const wantsTxView = sp.get("view") === "transaction";
  const [view, setView] = useState(isLightUser || wantsTxView ? "transaction" : "hub");

  const [kind, setKind] = useState("expense"); // "payout" | "expense" | "income"
  const [amount, setAmount] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [clients, setClients] = useState([]);
  const [students, setStudents] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [otherSpec, setOtherSpec] = useState("");
  const [saving, setSaving] = useState(false);
  // money-out fields
  const [recipientId, setRecipientId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [expenseOf, setExpenseOf] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [resetNonce, setResetNonce] = useState(0);

  useEffect(() => {
    (async () => {
      const [a, c, cl, st] = await Promise.all([
        api.get("/accounts"), api.get("/categories"), api.get("/clients"), api.get("/students"),
      ]);
      setAccounts(a.data); setCategories(c.data); setClients(cl.data); setStudents(st.data);
      if (a.data[0]) setAccountId(a.data[0].id);
    })();
  }, []);

  const payoutClients = useMemo(
    () => clients.filter((c) => SC_PAYOUT_CLIENT_TYPES.includes(c.client_type)),
    [clients],
  );
  // Preselect the recipient when arriving from a client's detail page.
  useEffect(() => {
    const cid = sp.get("client");
    if (cid && payoutClients.some((c) => c.id === cid)) setRecipientId(cid);
  }, [payoutClients, sp]);
  const recipient = payoutClients.find((c) => c.id === recipientId);
  const referredStudents = useMemo(() => {
    if (!recipient) return [];
    const t = (recipient.name || "").trim().toLowerCase();
    return students.filter((s) => (s.reference || "").trim().toLowerCase() === t);
  }, [students, recipient]);

  const isMoneyOut = kind !== "income";
  const txType = kind === "income" ? "income" : "expense";
  const filteredCats = useMemo(() => categories.filter((c) => c.type === txType), [categories, txType]);
  const selectedCat = filteredCats.find((c) => c.id === categoryId);
  const isOther = selectedCat?.name?.toLowerCase().startsWith("other");

  // Reset context-specific fields whenever the kind changes.
  useEffect(() => {
    setCategoryId(""); setOtherSpec("");
    setRecipientId(""); setStudentName(""); setExpenseOf(""); setPaymentMode("");
    setResetNonce((n) => n + 1);
  }, [kind]);

  const save = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter an amount"); return; }
    if (!accountId) { toast.error("Pick an account"); return; }
    setSaving(true);
    try {
      const desc = isOther && otherSpec
        ? `${selectedCat.name}: ${otherSpec}${description ? " — " + description : ""}`
        : description;
      const wantsStudent = kind === "payout" || (kind === "expense" && expenseOf === "campus_visit");
      await api.post("/transactions", {
        type: txType,
        amount: amt,
        account_id: accountId,
        category_id: categoryId || null,
        date,
        description: desc,
        is_sc_payout: kind === "payout",
        client_id: isMoneyOut ? (recipientId || null) : null,
        payment_mode: isMoneyOut ? (paymentMode || null) : null,
        student_name: wantsStudent ? (studentName || null) : null,
        expense_of: kind === "expense" ? (expenseOf || null) : null,
      });
      toast.success(`${KIND_TABS.find((k) => k.value === kind).label} saved`);
      setAmount(""); setCategoryId(""); setOtherSpec(""); setDescription("");
      setRecipientId(""); setStudentName(""); setExpenseOf(""); setPaymentMode("");
      setResetNonce((n) => n + 1);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const saveTone = kind === "income" ? "bg-emerald-700 hover:bg-emerald-800" : kind === "payout" ? "bg-amber-gradient" : "bg-rose-700 hover:bg-rose-800";

  // ---- HUB VIEW ----
  if (view === "hub") {
    return (
      <div className="space-y-6 animate-fade-in max-w-5xl" data-testid="quick-entry-page">
        <header>
          <p className="label-eyebrow">Quick entry</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">What would you like to do?</h1>
          <p className="text-sm text-muted-foreground mt-1">Pick an action — we'll take you straight to it.</p>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <HubCard testId="qe-add-transaction" icon={Receipt} palette="amber" title="Add Transaction" subtitle="Log a payout, expense or income" onClick={() => setView("transaction")} />
          <HubCard testId="qe-request-expense" icon={ReceiptX} palette="rose" title={isOfficeAdmin ? "Request Expense" : "New Expense Request"} subtitle={isOfficeAdmin ? "Submit for super-admin approval" : "Review office submissions"} onClick={() => nav(isOfficeAdmin ? "/expense-requests?new=1" : "/expense-requests")} />
          <HubCard testId="qe-add-student" icon={StudentIcon} palette="emerald" title="Add Student" subtitle="Enrol with fees plan & schedule" onClick={() => nav("/students?new=1")} />
          <HubCard testId="qe-log-payment" icon={CurrencyInr} palette="violet" title="Log Payment" subtitle="Record a student fee receipt" onClick={() => nav("/students?action=log_payment")} />
          {isSuper && (
            <HubCard testId="qe-paste-application" icon={ClipboardText} palette="amber" title="Paste Application" subtitle="Auto-parse a pasted student detail blob" onClick={() => nav("/students?paste=1")} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl" data-testid="quick-entry-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          {!isLightUser && (
            <button onClick={() => setView("hub")} data-testid="qe-back-to-hub" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
              <ArrowLeft size={12} /> Back to quick actions
            </button>
          )}
          <p className="label-eyebrow">Quick entry</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Add transaction</h1>
          <p className="text-sm text-muted-foreground mt-1">Log a payout, an expense or money coming in.</p>
          {!isLightUser && (
            <Button type="button" variant="outline" onClick={() => nav("/invoices")} data-testid="qe-generate-invoice-mobile" className="sm:hidden mt-3 h-10">
              <FileText size={16} className="mr-1.5" /> Generate Invoice
            </Button>
          )}
        </div>
        {!isLightUser && (
          <Button type="button" variant="outline" onClick={() => nav("/invoices")} data-testid="qe-generate-invoice" className="hidden sm:inline-flex h-10 shrink-0">
            <FileText size={16} className="mr-1.5" /> Generate Invoice
          </Button>
        )}
      </header>

      {/* Kind toggle */}
      <div className="grid grid-cols-3 gap-3" data-testid="kind-toggle">
        {KIND_TABS.map((t) => {
          const Icon = t.icon;
          const on = kind === t.value;
          return (
            <button key={t.value} onClick={() => setKind(t.value)} data-testid={`kind-${t.value}`}
              className={`p-4 rounded-lg border lift text-left ${on ? t.active : "border-border bg-card hover:bg-muted/40"}`}>
              <div className={`w-9 h-9 rounded-md flex items-center justify-center ${t.chip}`}>
                <Icon size={18} weight="bold" />
              </div>
              <p className="font-medium mt-2 text-sm">{t.label}</p>
            </button>
          );
        })}
      </div>

      <Card className="p-6 border border-border bg-card rounded-lg shadow-none">
        {/* Amount — native phone keypad */}
        <div className="text-center pb-6 border-b border-border">
          <p className="label-eyebrow">{kind === "income" ? "Amount to credit" : "Amount to deduct"}</p>
          <div className="mt-3 flex items-center justify-center gap-1">
            <span className="font-display text-4xl sm:text-5xl text-muted-foreground/70">{kind === "income" ? "+" : "−"}</span>
            <input
              type="text" inputMode="decimal" autoFocus
              value={amount}
              onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ""); if ((v.match(/\./g) || []).length <= 1) setAmount(v); }}
              placeholder="0"
              data-testid="qe-amount-input"
              className="w-[min(70vw,16rem)] bg-transparent border-0 outline-none text-center font-display text-5xl sm:text-6xl tracking-tight tabular-nums focus:ring-0 p-0"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2 tabular-nums">{formatMoney(parseFloat(amount) || 0, currency)}</p>
        </div>

        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="qe-date" />
            </div>
            <div>
              <Label>Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger data-testid="qe-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isMoneyOut && (
            <MoneyOutFields
              key={`${kind}-${resetNonce}`}
              kind={kind}
              recipientId={recipientId} onRecipientChange={setRecipientId}
              payoutClients={payoutClients}
              referredStudents={referredStudents}
              studentName={studentName} onStudentNameChange={setStudentName}
              expenseOf={expenseOf} onExpenseOfChange={setExpenseOf}
              paymentMode={paymentMode} onPaymentModeChange={setPaymentMode}
              expenseCategories={filteredCats} categoryId={categoryId} onCategoryChange={setCategoryId}
              idPrefix="qe"
            />
          )}

          {kind === "income" && (
            <div>
              <Label>Category</Label>
              <Select value={categoryId || "__none__"} onValueChange={(v) => setCategoryId(v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="qe-income-category"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {filteredCats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isOther && (
                <div className="mt-3">
                  <Label>Specify "Other"</Label>
                  <Input value={otherSpec} onChange={(e) => setOtherSpec(e.target.value)} placeholder="e.g., Parking fee, courier charges" data-testid="qe-other-spec" />
                </div>
              )}
            </div>
          )}

          <div>
            <Label>Notes (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this for?" data-testid="qe-notes" />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <Button onClick={save} disabled={saving || !amount || !accountId} data-testid="qe-save" className={`flex-1 h-12 text-white border-0 lift ${saveTone}`}>
            <Plus size={18} className="mr-1.5" />
            {saving ? "Saving…" : `Save ${KIND_TABS.find((k) => k.value === kind).label.toLowerCase()}`}
          </Button>
          <Button type="button" variant="outline" onClick={() => nav("/transactions")} data-testid="qe-view-all" className="h-12">
            View all transactions
          </Button>
        </div>
      </Card>
    </div>
  );
}

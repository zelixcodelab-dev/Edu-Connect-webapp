import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { formatMoney, formatDate } from "@/lib/format";
import {
  ArrowLeft, ArrowDown, ArrowUp, FileText, Receipt,
} from "@phosphor-icons/react";

// ============================================================================
// LinkedUserLedger — credit/debit + invoice timeline for the "user" role.
// Powered by GET /api/users/me/ledger which aggregates every invoice + tx
// posted against the linked client.
// ============================================================================

const KIND_META = {
  invoice: {
    label: "Invoice",
    icon: FileText,
    badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
    amountClass: "text-amber-700 dark:text-amber-300",
  },
  credit: {
    label: "Credit",
    icon: ArrowDown,
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
    amountClass: "text-emerald-700 dark:text-emerald-300",
  },
  debit: {
    label: "Debit",
    icon: ArrowUp,
    badge: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
    amountClass: "text-rose-700 dark:text-rose-300",
  },
};

function StatTile({ label, value, hint, accent, tid }) {
  return (
    <Card className={`card-premium p-5 ${accent || ""}`} data-testid={tid}>
      <p className="label-eyebrow">{label}</p>
      <p className="font-display text-3xl mt-2 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </Card>
  );
}

export default function LinkedUserLedger() {
  const { user } = useAuth();
  const nav = useNavigate();
  const currency = user?.currency || "INR";
  const [ledger, setLedger] = useState(null);
  const [filter, setFilter] = useState("all"); // all | invoices | credits | debits
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/users/me/ledger");
        if (!cancel) setLedger(data);
      } catch (e) {
        console.error("[my-ledger] load failed:", e?.message || e);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const totals = ledger?.totals || { credits: 0, debits: 0, invoices_total: 0, net: 0 };
  const entries = useMemo(() => ledger?.entries || [], [ledger]);

  const visible = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "invoices") return entries.filter((e) => e.kind === "invoice");
    if (filter === "credits") return entries.filter((e) => e.kind === "credit");
    if (filter === "debits") return entries.filter((e) => e.kind === "debit");
    return entries;
  }, [entries, filter]);

  const counts = useMemo(() => ({
    all: entries.length,
    invoices: entries.filter((e) => e.kind === "invoice").length,
    credits: entries.filter((e) => e.kind === "credit").length,
    debits: entries.filter((e) => e.kind === "debit").length,
  }), [entries]);

  // Hard gate: if not a linked user, show empty state with back button.
  if (user && (user.role !== "user" || !user.linked_client_id)) {
    return (
      <div className="space-y-6 animate-fade-in" data-testid="my-ledger-not-linked">
        <button
          type="button"
          onClick={() => nav(-1)}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          data-testid="my-ledger-back"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <Card className="card-premium p-12 text-center">
          <p className="text-sm text-muted-foreground">
            This page is only available for sub-agent / associate consultant accounts.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-7 animate-fade-in" data-testid="my-ledger-page">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">My ledger</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">
            Credit & Debit Details
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Linked to{" "}
            <span className="font-medium text-foreground">
              {ledger?.client_name || user?.linked_client_name || "—"}
            </span>
            {" · "}{counts.all} entries
          </p>
        </div>
      </header>

      {/* Totals */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatTile
          tid="ledger-stat-invoices"
          label="Invoices generated"
          value={formatMoney(totals.invoices_total, currency)}
          hint={`${counts.invoices} invoice${counts.invoices === 1 ? "" : "s"}`}
          accent="border-amber-200/60 dark:border-amber-500/30"
        />
        <StatTile
          tid="ledger-stat-credits"
          label="Credits received"
          value={formatMoney(totals.credits, currency)}
          hint={`${counts.credits} entries`}
          accent="border-emerald-200/60 dark:border-emerald-500/30"
        />
        <StatTile
          tid="ledger-stat-debits"
          label="Debits posted"
          value={formatMoney(totals.debits, currency)}
          hint={`${counts.debits} entries`}
          accent="border-rose-200/60 dark:border-rose-500/30"
        />
        <StatTile
          tid="ledger-stat-net"
          label="Net (Invoices + Credits − Debits)"
          value={formatMoney(totals.net, currency)}
          hint="Across all time"
        />
      </section>

      {/* Filter strip */}
      <section className="flex flex-wrap items-center gap-2" data-testid="ledger-filter-strip">
        {[
          { k: "all", label: `All · ${counts.all}` },
          { k: "invoices", label: `Invoices · ${counts.invoices}` },
          { k: "credits", label: `Credits · ${counts.credits}` },
          { k: "debits", label: `Debits · ${counts.debits}` },
        ].map((opt) => (
          <button
            key={opt.k}
            type="button"
            onClick={() => setFilter(opt.k)}
            data-testid={`ledger-filter-${opt.k}`}
            className={`px-3 h-8 rounded-full text-xs font-medium border transition-colors ${
              filter === opt.k
                ? "bg-amber-gradient text-white border-transparent shadow-md shadow-orange-500/20"
                : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </section>

      {/* Timeline */}
      <Card className="card-premium overflow-hidden" data-testid="ledger-timeline">
        {loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading ledger…</div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {entries.length === 0
              ? "No entries yet. Once the office issues an invoice or posts a credit/debit against your account it will appear here."
              : "Nothing in this filter."}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((row) => {
              const meta = KIND_META[row.kind] || KIND_META.credit;
              const Icon = meta.icon;
              return (
                <div
                  key={`${row.kind}-${row.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
                  data-testid={`ledger-row-${row.id}`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${meta.badge}`}>
                    <Icon size={16} weight="bold" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-medium border ${meta.badge}`}>
                        {meta.label}
                      </span>
                      {row.invoice_type === "service_charge" && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300 font-medium">
                          SC
                        </span>
                      )}
                      <p className="font-medium text-sm text-foreground truncate">{row.label}</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {row.date ? formatDate(row.date) : "—"}
                      {row.status && <span> · {row.status}</span>}
                    </p>
                  </div>
                  <p className={`font-display text-lg tabular-nums shrink-0 ${meta.amountClass}`}>
                    {row.kind === "debit" ? "−" : "+"}
                    {formatMoney(row.amount, currency)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

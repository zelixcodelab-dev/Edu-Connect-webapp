import React from "react";
import { Link } from "react-router-dom";
import { formatMoney, formatDate } from "@/lib/format";
import { ArrowUpRight, ArrowDownRight, GraduationCap, Notebook } from "@phosphor-icons/react";
import { Empty } from "./StatCard";
import { STATUS_BADGE, CLIENT_TYPE_LABEL, LEDGER_TYPE_LABEL, LEDGER_TYPE_COLOR } from "@/lib/dashboardUtils";

export function TxList({ items, currency }) {
  if (!items.length) return <Empty label="No transactions in this window." />;
  return (
    <ul className="divide-y divide-border/60" data-testid="tx-list">
      {items.slice(0, 10).map((t) => (
        <li key={t.id} className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/40">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${t.type === 'income' ? 'bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400'}`}>
              {t.type === 'income' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
            </div>
            <div>
              <p className="text-sm font-medium">{t.description || (t.type === 'income' ? 'Income' : 'Expense')}</p>
              <p className="text-xs text-muted-foreground">{formatDate(t.date)}</p>
            </div>
          </div>
          <span className={`tabular-nums text-sm font-medium ${t.type === 'income' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
            {t.type === 'income' ? '+' : '−'}{formatMoney(t.amount, currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StudentList({ items, currency }) {
  if (!items.length) return <Empty label="No enrollments in this window." />;
  return (
    <ul className="divide-y divide-border/60" data-testid="student-list">
      {items.slice(0, 10).map((s) => (
        <li key={s.id}>
          <Link to={`/students/${s.id}`} className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/40">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-muted text-foreground flex items-center justify-center text-xs font-medium shrink-0">
                {(s.name || "?").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5"><GraduationCap size={12} /> {[s.course, s.college, s.reference].filter(Boolean).join(" · ") || "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_BADGE[s.status] || "bg-muted text-foreground"}`}>{s.status}</span>
              <span className="tabular-nums text-sm text-foreground hidden sm:inline">{formatMoney(s.collected_total, currency)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ClientList({ items }) {
  if (!items.length) return <Empty label="No clients added in this window." />;
  return (
    <ul className="divide-y divide-border/60" data-testid="client-list">
      {items.slice(0, 10).map((c) => (
        <li key={c.id} className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-muted text-foreground flex items-center justify-center text-xs font-medium shrink-0">
              {(c.name || "?").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{c.name}</p>
              <p className="text-xs text-muted-foreground truncate">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</p>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-foreground">
            {CLIENT_TYPE_LABEL[c.client_type] || "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LedgerList({ items, currency }) {
  if (!items?.length) return <Empty label="No sub-agent activity yet." />;
  return (
    <ul className="divide-y divide-border/60" data-testid="ledger-list">
      {items.slice(0, 10).map((row, i) => (
        <li key={`${row.type}-${row.name}-${i}`}>
          <Link
            to={`/agents/detail?type=${encodeURIComponent(row.type)}&name=${encodeURIComponent(row.name)}`}
            className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/40"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${LEDGER_TYPE_COLOR[row.type] || "#7c3aed"}1A`, color: LEDGER_TYPE_COLOR[row.type] || "#7c3aed" }}>
                <Notebook size={16} weight="duotone" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{row.name}</p>
                <p className="text-xs text-muted-foreground truncate">{LEDGER_TYPE_LABEL[row.type] || row.type}</p>
              </div>
            </div>
            <span className="tabular-nums text-sm font-medium text-foreground">{formatMoney(row.total_received ?? 0, currency)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

import React from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, GraduationCap, Buildings, UserCircle, IdentificationCard, CurrencyInr } from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";

const STATUS_STYLES = {
  inquiry: "bg-muted text-foreground",
  enrolled: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400",
  completed: "bg-sky-100/60 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

const STATUS_LABEL = {
  inquiry: "Inquiry",
  enrolled: "Enrolled",
  cancelled: "Cancelled",
  completed: "Completed",
};

// Card tint per status — soft pastel background
const CARD_TINT = {
  inquiry: "bg-muted/40 border-border",
  enrolled: "bg-emerald-100/40 dark:bg-emerald-500/10 border-emerald-200/70 dark:border-emerald-500/30",
  cancelled: "bg-rose-100/40 dark:bg-rose-500/10 border-rose-200/70 dark:border-rose-500/30",
  completed: "bg-sky-100/40 dark:bg-sky-500/10 border-sky-200/70 dark:border-sky-500/30",
};

export default function StudentCard({ s, currency, isSuper, selectable, selected, onToggleSelect }) {
  const scCleared = (s.sc_earned_effective || 0) > 0 && (s.balance_vs_sc || 0) <= 0.01;
  return (
    <Link
      key={s.id}
      to={`/students/${s.id}`}
      data-testid={`st-card-${s.id}`}
      className="group block"
    >
      <Card className={`p-5 border rounded-lg shadow-none hover:shadow-sm transition-all h-full flex flex-col ${selected ? "ring-2 ring-primary border-primary/50" : "hover:border-border"} ${CARD_TINT[s.status] || "bg-card border-border"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {selectable && (
              <span
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect?.(); }}
                className="shrink-0"
                data-testid={`st-card-select-${s.id}`}
              >
                <Checkbox checked={!!selected} className="pointer-events-none" />
              </span>
            )}
            <div className="w-11 h-11 rounded-md bg-card/70 text-foreground flex items-center justify-center font-medium shrink-0 border border-border">
              {(s.name || "?").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate" data-testid={`st-card-name-${s.id}`}>{s.name}</p>
              {s.course && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><GraduationCap size={12} /> {s.course}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {scCleared && (
              <span
                className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white shadow-sm shadow-emerald-500/30"
                data-testid={`st-card-sc-cleared-${s.id}`}
                title="Service charge cleared / collected"
              >
                <CurrencyInr size={13} weight="bold" />
              </span>
            )}
            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_STYLES[s.status] || "bg-muted text-foreground"}`}>
              {STATUS_LABEL[s.status] || s.status}
            </span>
          </div>
        </div>

        {isSuper && s._creator_office && (
          <div className="mt-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider bg-orange-100/60 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 self-start" data-testid={`st-creator-${s.id}`}>
            <Buildings size={11} weight="duotone" /> {s._creator_office.replace("KM_", "KM ")} · {s._creator_name}
          </div>
        )}

        {s.referrer_name && (
          <div
            className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider bg-violet-100/60 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 self-start"
            data-testid={`st-referrer-${s.id}`}
            title={`Referred by ${s.referrer_name}`}
          >
            <IdentificationCard size={11} weight="duotone" /> Referred by · {s.referrer_name}
          </div>
        )}

        <div className="mt-4 space-y-1.5 text-sm text-muted-foreground flex-1">
          <p className="flex items-center gap-2"><Buildings size={14} className="text-muted-foreground/70" /> <span className="truncate">{s.college || "—"}</span></p>
          <p className="flex items-center gap-2"><UserCircle size={14} className="text-muted-foreground/70" /> <span className="truncate">{s.reference || "—"}</span></p>
        </div>

        <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Collected</span>
          <span className="tabular-nums font-medium text-emerald-700 dark:text-emerald-400">{formatMoney(s.collected_total, currency)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Balance</span>
          <span className={`tabular-nums font-medium ${s.balance_vs_sc > 0 ? "text-rose-700 dark:text-rose-400" : "text-foreground"}`}>{formatMoney(s.balance_vs_sc, currency)}</span>
        </div>

        <div className="mt-3 inline-flex items-center gap-1 text-xs text-foreground group-hover:text-foreground">
          Open <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
        </div>
      </Card>
    </Link>
  );
}

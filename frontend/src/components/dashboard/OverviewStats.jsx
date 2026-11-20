import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UsersThree, GraduationCap, Coins, Timer } from "@phosphor-icons/react";
import api from "@/lib/api";
import { useAcademicYear } from "@/lib/academicYear";
import { ACCENTS } from "@/pages/SectionHub";

const SYMBOLS = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED " };

export function shortMoney(n, currency) {
  const sym = SYMBOLS[currency] ?? `${currency} `;
  const v = Number(n) || 0;
  if (currency === "INR") {
    if (v >= 1e7) return `${sym}${+(v / 1e7).toFixed(1)}Cr`;
    if (v >= 1e5) return `${sym}${+(v / 1e5).toFixed(1)}L`;
    if (v >= 1e3) return `${sym}${+(v / 1e3).toFixed(1)}K`;
    return `${sym}${Math.round(v)}`;
  }
  return `${sym}${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;
}

const CARDS = [
  { k: "total_leads", label: "Total leads", Icon: UsersThree, accent: "indigo", to: "/leads" },
  { k: "admissions", label: "Admissions", Icon: GraduationCap, accent: "emerald", to: "/students" },
  { k: "collections_month", label: "Collections this month", Icon: Coins, accent: "amber", to: "/transactions", money: true },
  { k: "pending_tasks", label: "Pending tasks", Icon: Timer, accent: "coral", to: "/leads" },
];

export default function OverviewStats() {
  const [d, setD] = useState(null);
  const { year } = useAcademicYear();
  useEffect(() => { api.get("/dashboard/overview-stats").then((r) => setD(r.data)).catch(() => setD({})); }, [year]);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" data-testid="overview-stats">
      {CARDS.map(({ k, label, Icon, accent, to, money }, i) => {
        const c = ACCENTS[accent];
        const v = d?.[k];
        return (
          <Link key={k} to={to} data-testid={`overview-stat-${k}`} style={{ animationDelay: `${i * 50}ms` }}
            className="hub-tile group rounded-[20px] border border-border bg-card p-4 sm:p-5 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-20px_rgba(0,0,0,0.35)] transition-[transform,box-shadow] duration-300">
            <span className="w-9 h-9 rounded-[10px] flex items-center justify-center" style={{ background: `${c}1f`, color: c }}><Icon size={18} weight="duotone" /></span>
            <p className="font-display text-2xl sm:text-[28px] font-semibold tabular-nums mt-3 truncate" data-testid={`overview-stat-${k}-value`}>
              {d === null ? "…" : money ? shortMoney(v, d?.currency) : (v ?? 0).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground truncate">{label}</p>
          </Link>
        );
      })}
    </div>
  );
}

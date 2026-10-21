import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, Circle, ArrowRight, X, RocketLaunch } from "@phosphor-icons/react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { hasModule } from "@/lib/perm";

export default function OnboardingChecklist() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const enabled = hasModule(user, "onboarding");

  useEffect(() => {
    if (!enabled) return;
    api.get("/onboarding/checklist").then((r) => setData(r.data)).catch(() => setData(null));
  }, [enabled]);

  if (!enabled || !data || data.dismissed || data.complete || !data.total) return null;

  const hide = async () => {
    setData((d) => ({ ...d, dismissed: true }));
    try { await api.post("/onboarding/checklist/dismiss"); } catch { /* best-effort */ }
  };
  const pct = Math.round((data.done / data.total) * 100);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 animate-fade-in" data-testid="onboarding-checklist">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-amber-gradient text-white flex items-center justify-center shrink-0"><RocketLaunch size={18} weight="bold" /></span>
          <div>
            <h2 className="font-display text-base md:text-lg font-semibold tracking-tight">Getting started</h2>
            <p className="text-xs text-muted-foreground" data-testid="onboarding-progress">{data.done} of {data.total} done</p>
          </div>
        </div>
        <button type="button" onClick={hide} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="onboarding-hide-btn">
          <X size={13} /> Hide checklist
        </button>
      </div>
      <div className="mt-4 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-[hsl(var(--primary))] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 grid sm:grid-cols-2 gap-2">
        {data.items.map((it) => (
          <li key={it.key}>
            <Link
              to={it.to}
              data-testid={`onboarding-item-${it.key}`}
              data-done={it.done ? "true" : "false"}
              className={`group flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${it.done ? "border-emerald-500/30 bg-emerald-500/5" : "border-border hover:border-[hsl(var(--primary))]/40 hover:bg-muted/40"}`}
            >
              {it.done
                ? <CheckCircle size={20} weight="fill" className="text-emerald-600 shrink-0 mt-0.5" />
                : <Circle size={20} className="text-muted-foreground shrink-0 mt-0.5" />}
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${it.done ? "line-through text-muted-foreground" : ""}`}>{it.label}</span>
                <span className="block text-xs text-muted-foreground">{it.hint}</span>
              </span>
              {!it.done && <ArrowRight size={14} className="text-muted-foreground mt-1 transition-transform group-hover:translate-x-0.5" />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

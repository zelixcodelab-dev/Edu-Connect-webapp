import React, { useState } from "react";
import { Hourglass, X } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";

const ADMIN = ["super_admin", "office_admin"];
const today = () => new Date().toISOString().slice(0, 10);

export default function TrialBanner() {
  const { user } = useAuth();
  const trial = user?.trial;
  const key = `trial_banner_dismissed_${user?.tenant_id || ""}`;
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === today(); } catch { return false; }
  });
  if (!trial || !ADMIN.includes(user?.role)) return null;

  const d = trial.days_left;
  const locked = trial.expired && trial.expiry_action === "read_only";
  if (hidden && !locked) return null;

  const end = new Date(`${trial.trial_ends_at}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const tone = trial.expired || d <= 3
    ? "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300"
    : d <= 7 ? "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300"
      : "bg-sky-500/10 border-sky-500/30 text-sky-800 dark:text-sky-300";
  const msg = trial.expired
    ? (locked ? `Your trial ended on ${end}. The workspace is now read-only.` : `Your trial ended on ${end}.`)
    : d === 0 ? `Your trial ends today (${end}).` : `Your trial ends in ${d} day${d === 1 ? "" : "s"} (${end}).`;

  const dismiss = () => {
    try { localStorage.setItem(key, today()); } catch { /* no-op */ }
    setHidden(true);
  };

  return (
    <div className={`mx-4 md:mx-8 mt-4 rounded-xl border px-4 py-3 flex items-center gap-3 text-sm animate-fade-in ${tone}`} role="status" data-testid="trial-banner" data-days-left={d}>
      <Hourglass size={18} weight="bold" className="shrink-0" />
      <p className="flex-1 min-w-0"><span className="font-medium" data-testid="trial-banner-text">{msg}</span> Contact your provider to upgrade.</p>
      {!locked && (
        <button type="button" onClick={dismiss} className="opacity-70 hover:opacity-100 transition-opacity" aria-label="Dismiss for today" data-testid="trial-banner-dismiss"><X size={16} /></button>
      )}
    </div>
  );
}

import React from "react";
import { Card } from "@/components/ui/card";
import { CaretUp, CaretDown, ArrowRight } from "@phosphor-icons/react";
import { PALETTES } from "@/lib/dashboardUtils";

/**
 * Reusable dashboard stat card.
 *
 * Now supports a subtle click affordance:
 *   - Pass ``onClick`` to make the card interactive.
 *   - When interactive, the card is rendered as a native <button> for a11y
 *     (proper focus ring, Space/Enter key support, screen-reader semantics).
 *   - A right-arrow chevron slides in on hover so operators discover the
 *     drill-down without cluttering the resting state.
 *
 * Non-clickable usage (no onClick) is byte-for-byte the previous layout.
 */
export function StatCard({ eyebrow, value, trend, hint, palette, icon: Icon, testId, onClick, ariaLabel }) {
  const p = PALETTES[palette] || PALETTES.amber;
  const positive = trend != null && trend >= 0;
  const clickable = typeof onClick === "function";

  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${p.icon}`}>
          {Icon && <Icon size={18} weight="duotone" />}
        </div>
        <div className="flex items-center gap-2">
          {trend != null && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${positive ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
              {positive ? <CaretUp size={12} weight="fill" /> : <CaretDown size={12} weight="fill" />}
              {Math.abs(trend).toFixed(0)}%
            </span>
          )}
          {clickable && (
            <span
              aria-hidden="true"
              className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-all text-muted-foreground"
            >
              <ArrowRight size={14} weight="bold" />
            </span>
          )}
        </div>
      </div>
      <p className="font-display text-2xl mt-4 text-foreground tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{eyebrow}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </>
  );

  const baseClasses = `p-5 rounded-xl shadow-none border-0 ${p.bg}`;
  if (!clickable) {
    return (
      <Card className={baseClasses} data-testid={testId}>{inner}</Card>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={ariaLabel || eyebrow}
      className={`group text-left w-full ${baseClasses} cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:ring-2 hover:ring-orange-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`}
    >
      {inner}
    </button>
  );
}

export function ChartHeader({ eyebrow, title, right }) {
  return (
    <div className="flex items-start justify-between mb-3 gap-3">
      <div>
        <p className="label-eyebrow">{eyebrow}</p>
        <h3 className="font-display text-xl mt-1">{title}</h3>
      </div>
      {right}
    </div>
  );
}

export function Empty({ label }) {
  return <div className="p-10 text-center text-sm text-muted-foreground" data-testid="tile-empty">{label}</div>;
}

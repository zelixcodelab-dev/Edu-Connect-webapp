import React from "react";
import { Card } from "@/components/ui/card";
import { PencilSimple, Trash, Buildings, User, Lock, CurrencyInr } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";

const COLLAPSED_COUNT = 6;

/** Single college row in the catalogue grid. Renders name/place/deal-with header
 * + capped course chips (collapses past 6 with a "+ N more" toggle).
 */
export default function CollegeCard({ c, onEdit, onDelete }) {
  const { user } = useAuth();
  const currency = user?.currency || "INR";
  const isSuper = user?.role === "super_admin";
  const courses = c.courses || [];
  const [showAll, setShowAll] = React.useState(false);
  const [showSc, setShowSc] = React.useState(false);
  const visible = showAll ? courses : courses.slice(0, COLLAPSED_COUNT);
  const hidden = Math.max(0, courses.length - visible.length);
  const scRates = c.sc_rates && typeof c.sc_rates === "object" ? c.sc_rates : {};
  const scCount = Object.keys(scRates).length;

  return (
    <Card
      className="p-5 border border-border bg-card rounded-lg shadow-none hover:border-orange-500/40 transition-colors flex flex-col"
      data-testid={`col-card-${c.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-lg bg-amber-gradient-soft border border-amber-500/30 flex items-center justify-center shrink-0">
            <Buildings size={18} className="text-amber-700 dark:text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-semibold truncate" data-testid={`col-name-${c.id}`}>
              {c.name}
            </h3>
            <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {c.place && <span data-testid={`col-place-${c.id}`}>{c.place}</span>}
              {c.deal_with && (
                <>
                  {c.place && <span className="text-muted-foreground/40">·</span>}
                  <span className="flex items-center gap-1" data-testid={`col-dealwith-${c.id}`}>
                    <User size={11} weight="duotone" />
                    {c.deal_with}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => onEdit(c)}
            data-testid={`edit-col-${c.id}`}
            className="text-muted-foreground hover:text-foreground p-1.5"
            title="Edit"
          >
            <PencilSimple size={16} />
          </button>
          <button
            onClick={() => onDelete(c)}
            data-testid={`delete-col-${c.id}`}
            className="text-muted-foreground hover:text-rose-700 dark:text-rose-400 p-1.5"
            title="Delete"
          >
            <Trash size={16} />
          </button>
        </div>
      </div>
      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
          Courses · {courses.length}
        </p>
        {courses.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No courses listed</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 items-center">
            {visible.map((course, idx) => (
              <span
                key={`${c.id}-course-${idx}`}
                className="px-2 py-0.5 rounded-full text-[11px] bg-orange-100/60 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/20"
                title={course}
              >
                {course}
              </span>
            ))}
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                data-testid={`col-show-more-${c.id}`}
                className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-card border border-border text-muted-foreground hover:border-orange-500/40 hover:text-foreground transition-colors"
              >
                + {hidden} more
              </button>
            )}
            {showAll && courses.length > COLLAPSED_COUNT && (
              <button
                type="button"
                onClick={() => setShowAll(false)}
                data-testid={`col-show-less-${c.id}`}
                className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-card border border-border text-muted-foreground hover:border-orange-500/40 hover:text-foreground transition-colors"
              >
                Show less
              </button>
            )}
          </div>
        )}
      </div>

      {/* Confidential SC rates — super admin only */}
      {isSuper && scCount > 0 && (
        <div className="mt-3 pt-3 border-t border-border" data-testid={`col-sc-${c.id}`}>
          <button
            type="button"
            onClick={() => setShowSc((v) => !v)}
            className="w-full flex items-center justify-between text-left group"
            data-testid={`col-sc-toggle-${c.id}`}
          >
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-amber-800 dark:text-amber-400">
              <Lock size={11} weight="fill" />
              SC rates · {scCount}
            </span>
            <span className="text-[10px] text-muted-foreground group-hover:text-foreground">
              {showSc ? "Hide" : "Show"}
            </span>
          </button>
          {showSc && (
            <div className="mt-2 space-y-1">
              {Object.entries(scRates).map(([course, amount]) => (
                <div
                  key={course}
                  className="flex items-center justify-between text-xs"
                  data-testid={`col-sc-row-${c.id}-${course.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <span className="truncate text-foreground/80 mr-2" title={course}>
                    {course}
                  </span>
                  <span className="flex items-center gap-0.5 font-medium tabular-nums text-amber-800 dark:text-amber-300">
                    <CurrencyInr size={11} />
                    {formatMoney(amount, currency).replace(/^[₹$€£¥]\s?/, "")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

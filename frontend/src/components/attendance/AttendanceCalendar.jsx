import React, { useMemo } from "react";

const WD = ["S", "M", "T", "W", "T", "F", "S"];

const STATUS_DOT = {
  present: "bg-emerald-500",
  late: "bg-amber-500",
  half_day: "bg-orange-500",
  leave: "bg-sky-500",
  weekoff: "bg-violet-500",
  absent: "bg-rose-500",
};

const STATUS_CELL = {
  present: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  late: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  half_day: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
  leave: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  weekoff: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  absent: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

const STATUS_SHORT = { present: "P", late: "L", half_day: "½", leave: "LV", weekoff: "WO", absent: "A" };

// Monthly calendar grid for the signed-in user's own attendance.
// Clicking a PAST day (when onPickDate is provided) starts a regularization request.
export default function AttendanceCalendar({ month, records, onPickDate }) {
  const [y, m] = month.split("-").map(Number);
  const byDate = useMemo(() => {
    const map = {};
    (records || []).forEach((r) => { map[r.date] = r; });
    return map;
  }, [records]);

  const cells = useMemo(() => {
    const first = new Date(y, m - 1, 1);
    const lead = first.getDay(); // 0=Sun
    const daysInMonth = new Date(y, m, 0).getDate();
    const out = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ d, ds, rec: byDate[ds] || null });
    }
    return out;
  }, [y, m, byDate]);

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div data-testid="attendance-calendar">
      <div className="grid grid-cols-7 gap-1.5 mb-2">
        {WD.map((w, i) => (
          <div key={i} className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c, i) => {
          if (!c) return <div key={`b${i}`} />;
          const isToday = c.ds === todayIso;
          const isPast = c.ds < todayIso;
          // Rotational week-off: a past day with no record = a forgotten
          // check-in, shown as Absent (and convertible by an admin).
          const status = c.rec?.status || (isPast ? "absent" : null);
          const cellCls = status ? (STATUS_CELL[status] || "bg-muted border-border") : "border-transparent";
          const clickable = !!onPickDate && isPast;
          return (
            <div
              key={c.ds}
              data-testid={`cal-day-${c.ds}`}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onPickDate(c.ds, c.rec) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") onPickDate(c.ds, c.rec); } : undefined}
              title={clickable ? "Regularize this day" : undefined}
              className={`aspect-square rounded-lg border flex flex-col items-center justify-center text-xs relative ${cellCls} ${isToday ? "ring-2 ring-primary" : ""} ${clickable ? "cursor-pointer hover:border-primary/60 hover:bg-primary/5" : ""}`}
            >
              <span className={`tabular-nums ${status ? "font-semibold" : "text-muted-foreground"}`}>{c.d}</span>
              {status ? (
                <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] || "bg-muted-foreground"}`} title={STATUS_SHORT[status]} />
              ) : (
                <span className="mt-0.5 h-1.5 w-1.5" />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Present</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Late</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" /> Half day</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> Leave</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" /> Week-off</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Absent</span>
      </div>
      {onPickDate && (
        <p className="text-[11px] text-muted-foreground mt-2">Tip: tap any past day to request a Week-off or Leave regularization.</p>
      )}
    </div>
  );
}

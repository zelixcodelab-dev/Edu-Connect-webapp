import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { LEAVE_TYPES } from "./LeaveRequestDialog";

const TYPE_COLOR = {
  casual: "bg-sky-500", sick: "bg-rose-500", earned: "bg-emerald-500", unpaid: "bg-stone-500",
};
const OFFICES = [
  { value: "KM_BLR", label: "KM BLR" },
  { value: "KM_TCR", label: "KM TCR" },
  { value: "KM_KMLY", label: "KM KMLY" },
];
const pad = (n) => String(n).padStart(2, "0");

export default function LeaveCalendar() {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";
  const canFilterTeam = isSuper || user?.role === "office_admin";
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const [items, setItems] = useState([]);
  const [office, setOffice] = useState("all");
  const [member, setMember] = useState("all");
  const [people, setPeople] = useState([]);

  // Load the people the current user can filter by (staff + office admins, scoped).
  useEffect(() => {
    if (!canFilterTeam) return;
    api.get("/users/assignable").then(({ data }) => setPeople(data || [])).catch(() => setPeople([]));
  }, [canFilterTeam]);

  useEffect(() => {
    const month = `${cursor.y}-${pad(cursor.m)}`;
    const params = { month };
    if (isSuper && office !== "all") params.office = office;
    if (member !== "all") params.member = member;
    api.get("/leave/calendar", { params }).then(({ data }) => setItems(data)).catch(() => setItems([]));
  }, [cursor, office, member, isSuper]);

  const peopleOptions = isSuper && office !== "all"
    ? people.filter((p) => p.office === office)
    : people;

  const first = new Date(cursor.y, cursor.m - 1, 1);
  const daysInMonth = new Date(cursor.y, cursor.m, 0).getDate();
  const startWeekday = first.getDay();
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const dayLeaves = (day) => {
    const d = `${cursor.y}-${pad(cursor.m)}-${pad(day)}`;
    return items.filter((it) => it.from_date <= d && it.to_date >= d);
  };
  const prev = () => setCursor((c) => (c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 }));
  const next = () => setCursor((c) => (c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 }));

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div data-testid="leave-calendar" className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold" data-testid="cal-month-label">{monthLabel}</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {canFilterTeam && (
            <>
              {isSuper && (
                <Select value={office} onValueChange={(v) => { setOffice(v); setMember("all"); }}>
                  <SelectTrigger className="h-8 w-36 bg-card text-sm" data-testid="cal-filter-office"><SelectValue placeholder="All offices" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All offices</SelectItem>
                    {OFFICES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={member} onValueChange={setMember}>
                <SelectTrigger className="h-8 w-44 bg-card text-sm" data-testid="cal-filter-member"><SelectValue placeholder="Everyone" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {peopleOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.role === "office_admin" ? " · Admin" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={prev} data-testid="cal-prev"><CaretLeft size={16} /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={next} data-testid="cal-next"><CaretRight size={16} /></Button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-1 font-medium">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => (
          <div key={i} className={`min-h-[64px] rounded-lg border p-1 ${day ? "border-border bg-card" : "border-transparent"}`}>
            {day && (
              <>
                <span className="text-xs text-foreground">{day}</span>
                <div className="space-y-0.5 mt-0.5">
                  {dayLeaves(day).slice(0, 3).map((it) => (
                    <div key={it.id + "-" + day} className="flex items-center gap-1 truncate" title={`${it.requester_name} · ${it.leave_type}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_COLOR[it.leave_type] || "bg-stone-400"}`} />
                      <span className="text-[9px] text-muted-foreground truncate">{(it.requester_name || "").split(" ")[0]}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground pt-1">
        {LEAVE_TYPES.map((t) => (
          <span key={t.value} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${TYPE_COLOR[t.value]}`} />{t.label}</span>
        ))}
      </div>
    </div>
  );
}

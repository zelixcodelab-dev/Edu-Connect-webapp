import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CaretUp, CaretDown, ArrowsDownUp, ArrowSquareOut } from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";
import { COLLEGE_PLACES } from "@/lib/places";

// Status presentation
const STATUS_TONE = {
  enrolled: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  inquiry: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

// Click-to-sort priority for status: enrolled → inquiry → cancelled (ascending).
const STATUS_RANK = { enrolled: 0, inquiry: 1, cancelled: 2 };

const COLUMNS = [
  { key: "sl",         label: "#",          sortable: false, filter: null,    align: "left",  width: "w-12"  },
  { key: "date",       label: "Date",       sortable: true,  filter: "text",  align: "left",  width: "w-28"  },
  { key: "name",       label: "Name",       sortable: true,  filter: "text",  align: "left",  width: "min-w-[10rem]" },
  { key: "course",     label: "Course",     sortable: true,  filter: "text",  align: "left",  width: "min-w-[9rem]" },
  { key: "college",    label: "College",    sortable: true,  filter: "text",  align: "left",  width: "min-w-[12rem]" },
  { key: "city",       label: "City",       sortable: true,  filter: "city",  align: "left",  width: "w-32"  },
  { key: "hometown",   label: "Hometown",   sortable: true,  filter: "text",  align: "left",  width: "w-32"  },
  { key: "reference",  label: "Reference",  sortable: true,  filter: "text",  align: "left",  width: "min-w-[10rem]" },
  { key: "status",     label: "Status",     sortable: true,  filter: "status",align: "left",  width: "w-28"  },
  { key: "collected",  label: "Collected",  sortable: true,  filter: null,    align: "right", width: "w-28"  },
  { key: "balance",    label: "Balance",    sortable: true,  filter: null,    align: "right", width: "w-28"  },
  { key: "actions",    label: "",           sortable: false, filter: null,    align: "right", width: "w-12"  },
];

// Cell-value accessor for sorting/filtering.
function cellValue(s, key, ctx) {
  switch (key) {
    case "date":      return s.enrollment_date || s.created_at || "";
    case "name":      return s.name || "";
    case "course":    return s.course || "";
    case "college":   return s.college || "";
    case "city":      return ctx.cityOfStudent(s) || "";
    case "hometown":  return ctx.hometownOf(s) || "";
    case "reference": return s.reference || "";
    case "status":    return s.status || "";
    case "collected": return Number(s.collected_total || 0);
    case "balance":   return Number(s.balance_vs_scheduled ?? s.balance_vs_sc ?? 0);
    default:          return "";
  }
}

// Numeric vs string comparator helpers
const cmpNumber = (a, b) => (a === b ? 0 : (a < b ? -1 : 1));
const cmpString = (a, b) => String(a).localeCompare(String(b));

function SortIcon({ active, dir }) {
  if (!active) return <ArrowsDownUp size={11} weight="bold" className="opacity-40" />;
  return dir === "asc"
    ? <CaretUp size={11} weight="bold" className="text-primary" />
    : <CaretDown size={11} weight="bold" className="text-primary" />;
}

export default function StudentsTable({ students, currency, cityOfStudent, hometownOf }) {
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const [colFilters, setColFilters] = useState({
    date: "", name: "", course: "", college: "",
    city: "_all", hometown: "", reference: "", status: "_all",
  });

  const setCF = (key, val) => setColFilters((f) => ({ ...f, [key]: val }));

  const toggleSort = (key, sortable) => {
    if (!sortable) return;
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  };

  const visible = useMemo(() => {
    const ctx = { cityOfStudent, hometownOf };
    const matches = (val, q) => !q || String(val || "").toLowerCase().includes(q.toLowerCase());
    const isNumeric = sort.key === "collected" || sort.key === "balance";
    const arr = students.filter((s) => {
      if (!matches(cellValue(s, "date", ctx),      colFilters.date)) return false;
      if (!matches(cellValue(s, "name", ctx),      colFilters.name)) return false;
      if (!matches(cellValue(s, "course", ctx),    colFilters.course)) return false;
      if (!matches(cellValue(s, "college", ctx),   colFilters.college)) return false;
      if (!matches(cellValue(s, "hometown", ctx),  colFilters.hometown)) return false;
      if (!matches(cellValue(s, "reference", ctx), colFilters.reference)) return false;
      if (colFilters.city !== "_all") {
        const c = cityOfStudent(s);
        if (colFilters.city === "_other") {
          if (!c || COLLEGE_PLACES.includes(c)) return false;
        } else if (c !== colFilters.city) return false;
      }
      if (colFilters.status !== "_all" && s.status !== colFilters.status) return false;
      return true;
    });

    arr.sort((a, b) => {
      let va, vb;
      if (sort.key === "status") {
        va = STATUS_RANK[a.status] ?? 99;
        vb = STATUS_RANK[b.status] ?? 99;
        return sort.dir === "asc" ? cmpNumber(va, vb) : cmpNumber(vb, va);
      }
      va = cellValue(a, sort.key, ctx);
      vb = cellValue(b, sort.key, ctx);
      const c = isNumeric ? cmpNumber(va, vb) : cmpString(va, vb);
      return sort.dir === "asc" ? c : -c;
    });

    return arr;
  }, [students, sort, colFilters, cityOfStudent, hometownOf]);

  return (
    <div
      className="rounded-xl border border-border bg-card overflow-hidden"
      data-testid="students-table"
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            {/* Title row — click to sort */}
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2.5 text-${c.align} font-medium text-[11px] uppercase tracking-wider text-muted-foreground ${c.width} ${c.sortable ? "cursor-pointer hover:text-foreground select-none" : ""}`}
                  onClick={() => toggleSort(c.key, c.sortable)}
                  data-testid={c.sortable ? `col-sort-${c.key}` : undefined}
                >
                  <div className={`inline-flex items-center gap-1.5 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                    {c.label}
                    {c.sortable && <SortIcon active={sort.key === c.key} dir={sort.dir} />}
                  </div>
                </th>
              ))}
            </tr>
            {/* Filter row — per-column input directly under the header */}
            <tr className="bg-card border-b border-border">
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-1.5">
                  {c.filter === "text" && (
                    <Input
                      value={colFilters[c.key]}
                      onChange={(e) => setCF(c.key, e.target.value)}
                      placeholder={c.key === "date" ? "YYYY-MM-DD" : "Filter"}
                      className="h-7 text-xs bg-background"
                      data-testid={`col-filter-${c.key}`}
                    />
                  )}
                  {c.filter === "city" && (
                    <Select value={colFilters.city} onValueChange={(v) => setCF("city", v)}>
                      <SelectTrigger className="h-7 text-xs bg-background" data-testid="col-filter-city">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_all">All</SelectItem>
                        {COLLEGE_PLACES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        <SelectItem value="_other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {c.filter === "status" && (
                    <Select value={colFilters.status} onValueChange={(v) => setCF("status", v)}>
                      <SelectTrigger className="h-7 text-xs bg-background" data-testid="col-filter-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_all">All</SelectItem>
                        <SelectItem value="enrolled">Enrolled</SelectItem>
                        <SelectItem value="inquiry">Inquiry</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-sm text-muted-foreground" data-testid="students-table-empty">
                  No students match these column filters.
                </td>
              </tr>
            ) : (
              visible.map((s, i) => {
                const date = (s.enrollment_date || s.created_at || "").slice(0, 10);
                const tone = STATUS_TONE[s.status] || STATUS_TONE.cancelled;
                const collected = Number(s.collected_total || 0);
                const balance = Number(s.balance_vs_scheduled ?? s.balance_vs_sc ?? 0);
                return (
                  <tr
                    key={s.id}
                    data-testid={`student-row-${s.id}`}
                    className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                  >
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{date || "—"}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{s.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.course || "—"}</td>
                    <td className="px-3 py-2">{s.college || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{cityOfStudent(s) || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{hometownOf(s) || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <div>{s.reference || "—"}</div>
                      {s.referrer_name && (
                        <div
                          className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider bg-violet-100/60 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300"
                          data-testid={`student-row-referrer-${s.id}`}
                          title={`Referred by ${s.referrer_name}`}
                        >
                          ref · {s.referrer_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border ${tone}`}>
                        {s.status || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMoney(collected, currency)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${balance > 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"}`}>
                      {formatMoney(balance, currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/students/${s.id}`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                        data-testid={`student-row-open-${s.id}`}
                        aria-label="Open student"
                      >
                        <ArrowSquareOut size={14} weight="bold" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 bg-muted/30 border-t border-border text-[11px] text-muted-foreground text-right" data-testid="students-table-count">
        {visible.length} of {students.length} students
      </div>
    </div>
  );
}

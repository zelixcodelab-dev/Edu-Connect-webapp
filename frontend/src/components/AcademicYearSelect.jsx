import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarBlank } from "@phosphor-icons/react";
import { useAcademicYear } from "@/lib/academicYear";

/** Format a calendar year into an academic-year range label, e.g. 2026 → "2026-27". */
export function academicYearLabel(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return String(y);
  const next = String((n + 1) % 100).padStart(2, "0");
  return `${n}-${next}`;
}

/**
 * Global Academic Year selector shown in the top header. The data window stays
 * the calendar year (Jan → Dec); only the label is shown as a "2026-27" range.
 * Choosing a year re-scopes every page's data; "All years" removes the filter.
 */
export default function AcademicYearSelect() {
  const { year, setYear, years } = useAcademicYear();
  const value = year || "all";

  return (
    <Select value={value} onValueChange={(v) => setYear(v === "all" ? "all" : v)}>
      <SelectTrigger
        data-testid="academic-year-select"
        className="h-9 w-auto min-w-[120px] gap-1.5 rounded-full bg-muted/60 border-transparent px-3 text-xs font-medium hover:bg-muted focus:ring-2 focus:ring-primary/30"
        title="Academic year — scopes the whole app to an academic year"
      >
        <CalendarBlank size={14} className="text-muted-foreground shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" data-testid="academic-year-all">All years</SelectItem>
        {years.map((y) => (
          <SelectItem key={y} value={String(y)} data-testid={`academic-year-${y}`}>
            {academicYearLabel(y)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

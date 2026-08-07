import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CaretDown, MagnifyingGlass, Buildings, Check, X } from "@phosphor-icons/react";

/**
 * Searchable college dropdown that loads /api/colleges once on mount.
 *
 * Props:
 *   value         current selected name (string)
 *   onChange      (name) => void
 *   onCollegeMeta optional (collegeObj|null) => void — fires when picking from list
 *   placeholder   string
 *   testid        test id for trigger
 *   colleges      optional pre-loaded list (skips internal fetch when provided)
 */
export default function CollegeSelect({
  value,
  onChange,
  onCollegeMeta,
  placeholder = "Pick a college",
  testid = "college-select",
  colleges: presetList,
  placeFilter,
  disabled = false,
}) {
  const [list, setList] = useState(presetList || []);
  const [loading, setLoading] = useState(!presetList);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (presetList) { setList(presetList); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.get("/colleges")
      .then((r) => { if (!cancelled) setList(r.data || []); })
      .catch((err) => { console.error("[college-select] load:", err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [presetList]);

  const filtered = useMemo(() => {
    let pool = list;
    // Narrow by place if a filter is supplied. "Other" means "anything that
    // isn't one of the 10 canonical cities" — but we keep it strict on equality
    // for canonical names. The caller can pass an empty/null value to disable.
    if (placeFilter) {
      const target = placeFilter.toLowerCase();
      pool = pool.filter((c) => (c.place || "").trim().toLowerCase() === target);
    }
    let result = pool;
    if (q) {
      const term = q.toLowerCase();
      result = pool.filter((c) =>
        (c.name || "").toLowerCase().includes(term)
        || (c.place || "").toLowerCase().includes(term)
        || (c.courses || []).some((co) => co.toLowerCase().includes(term))
      );
    }
    // Pre-compute the subtitle once per college so the JSX render stays cheap.
    return result.map((c) => {
      const courses = c.courses || [];
      const head = courses.slice(0, 3).join(" · ");
      const subtitle = [c.place, head].filter(Boolean).join(" · ");
      const extra = courses.length > 3 ? ` +${courses.length - 3}` : "";
      return { ...c, _subtitle: subtitle + extra };
    });
  }, [list, q, placeFilter]);

  const pick = (c) => {
    onChange?.(c.name);
    onCollegeMeta?.(c);
    setOpen(false);
    setQ("");
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange?.("");
    onCollegeMeta?.(null);
  };

  return (
    <Popover open={open && !disabled} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          disabled={disabled}
          className="w-full h-10 px-3 rounded-md border border-input bg-card text-sm flex items-center justify-between gap-2 hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="flex items-center gap-2 min-w-0 flex-1">
            <Buildings size={14} className="text-muted-foreground/70 shrink-0" />
            <span className={`truncate ${value ? "text-foreground" : "text-muted-foreground"}`}>
              {value || placeholder}
            </span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {value && (
              <span
                role="button"
                tabIndex={0}
                onClick={clear}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") clear(e); }}
                className="text-muted-foreground hover:text-foreground p-0.5"
                aria-label="Clear"
                data-testid={`${testid}-clear`}
              >
                <X size={12} />
              </span>
            )}
            <CaretDown size={14} className="text-muted-foreground/70" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[260px]"
        align="start"
      >
        <div className="p-2 border-b border-border">
          <div className="relative">
            <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search colleges…"
              className="pl-8 h-8 text-sm"
              data-testid={`${testid}-search`}
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto" data-testid={`${testid}-list`}>
          {loading ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-5 text-xs text-muted-foreground text-center">
              {list.length === 0
                ? "No colleges yet. Add one in the Colleges page."
                : "No matches."}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                type="button"
                key={c.id || c.name}
                onClick={() => pick(c)}
                data-testid={`${testid}-opt-${c.id || c.name}`}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-orange-500/10 hover:text-orange-700 dark:hover:text-orange-300 transition-colors flex items-start gap-2 ${
                  value === c.name ? "bg-orange-50/60 dark:bg-orange-500/10" : ""
                }`}
              >
                <Buildings size={14} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{c.name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {c._subtitle}
                  </span>
                </span>
                {value === c.name && (
                  <Check size={14} className="text-orange-600 shrink-0 mt-0.5" />
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

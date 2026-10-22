import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MagnifyingGlass, CaretRight, CircleNotch } from "@phosphor-icons/react";

// Searchable student list; calls onPick(student) when one is chosen.
export function StudentPickerDialog({ open, onOpenChange, onPick, currency, title = "Select a student" }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    setQ("");
    api.get("/students").then(({ data }) => setList(data)).catch(() => setList([]));
  }, [open]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!list) return [];
    return list.filter((s) => !t || [s.name, s.college, s.course, s.reference, s.phone]
      .some((v) => (v || "").toLowerCase().includes(t)));
  }, [list, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden" data-testid="student-picker-dialog">
        <DialogHeader className="px-5 pt-5 pb-3 text-left">
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          <DialogDescription>Pick who the payment is for.</DialogDescription>
        </DialogHeader>
        <div className="px-5 pb-3">
          <div className="relative">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, college, course…"
              className="pl-9 h-11 rounded-xl" data-testid="student-picker-search" />
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto border-t border-border" data-testid="student-picker-list">
          {list === null && (
            <div className="py-10 flex justify-center text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
          )}
          {list !== null && shown.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground" data-testid="student-picker-empty">
              {list.length ? "No students match your search." : "No students yet."}
            </p>
          )}
          {shown.map((s) => (
            <button key={s.id} type="button" onClick={() => onPick(s)} data-testid={`student-picker-item-${s.id}`}
              className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted/60 transition-colors border-b border-border/60 last:border-0">
              <span className="w-9 h-9 shrink-0 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] flex items-center justify-center text-sm font-semibold">
                {(s.name || "?").charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{s.name}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {[s.college, s.course].filter(Boolean).join(" · ") || s.reference || "—"}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-[11px] text-muted-foreground">Due</span>
                <span className="block text-xs font-semibold tabular-nums">{formatMoney(s.balance_vs_scheduled || 0, currency)}</span>
              </span>
              <CaretRight size={14} className="text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

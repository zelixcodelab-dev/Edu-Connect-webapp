import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Calendar, MagnifyingGlass, ArrowRight } from "@phosphor-icons/react";

const OFFICE_LABEL = { KM_BLR: "KM BLR", KM_TCR: "KM TCR", KM_KMLY: "KM KMLY" };

export default function StaffPickerDialog({ open, onOpenChange, search, onSearchChange, staff, onPick }) {
  const filtered = useMemo(() => {
    if (!search) return staff;
    const q = search.toLowerCase();
    return staff.filter((s) =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.office || "").toLowerCase().includes(q)
    );
  }, [staff, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden" data-testid="staff-picker-dialog">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Calendar size={18} weight="duotone" className="text-orange-600 dark:text-orange-400" />
            Add an admission
          </DialogTitle>
          <DialogDescription>Pick the staff this student is being enrolled under.</DialogDescription>
        </DialogHeader>
        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search staff…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 h-10"
              data-testid="staff-picker-search"
            />
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto" data-testid="staff-picker-list">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground" data-testid="staff-picker-empty">
              {staff.length === 0 ? (
                <>
                  No staff yet.{" "}
                  <Link to="/clients" onClick={() => onOpenChange(false)} className="text-orange-600 dark:text-orange-400 underline">
                    Add your first
                  </Link>.
                </>
              ) : "No staff matches your search."}
            </div>
          ) : (
            filtered.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => onPick(s)}
                data-testid={`staff-pick-${s.id}`}
                className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-muted/40 transition-colors border-b border-border/40"
              >
                <div className="w-9 h-9 rounded-full bg-amber-gradient text-white text-sm font-semibold flex items-center justify-center shrink-0">
                  {(s.name || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.office ? (OFFICE_LABEL[s.office] || s.office) : "—"}
                    {s.eligible_incentive != null ? ` · ₹${s.eligible_incentive}/admission` : ""}
                  </p>
                </div>
                <ArrowRight size={14} className="text-muted-foreground shrink-0" />
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

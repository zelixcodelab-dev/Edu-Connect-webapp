import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowRight, MagnifyingGlass, UserCircle, X } from "@phosphor-icons/react";
import { CLIENT_TYPES, clientTypeLabel } from "@/pages/Clients";

export default function ClientPickerDialog({
  open,
  onOpenChange,
  search,
  onSearchChange,
  clients,
  isSuper,
  onPick,
  onSkip,
}) {
  const filtered = useMemo(() => {
    // Defense-in-depth: office admins only ever pick from staff. Their /clients data
    // is staff-only today, but if that invariant ever breaks the filter still holds.
    let base = isSuper ? clients : clients.filter((c) => c.client_type === "staff");
    if (!search) return base;
    const q = search.toLowerCase();
    return base.filter((c) =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.company || "").toLowerCase().includes(q) ||
      (c.office || "").toLowerCase().includes(q)
    );
  }, [clients, search, isSuper]);

  const groups = useMemo(() => {
    return CLIENT_TYPES
      .map((t) => ({ ...t, items: filtered.filter((c) => c.client_type === t.value) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" data-testid="client-picker-dialog">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <UserCircle size={18} weight="duotone" className="text-orange-600 dark:text-orange-400" />
            {isSuper ? "Pick a reference" : "Pick the referring staff"}
          </DialogTitle>
          <DialogDescription>
            {isSuper
              ? "Select the client this admission should be attributed to. Skip to enrol without a reference."
              : "Select the staff this student is being enrolled under. Skip if there's no referrer."}
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, company or office…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 h-10"
              data-testid="client-picker-search"
            />
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto" data-testid="client-picker-list">
          {groups.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground" data-testid="client-picker-empty">
              {clients.length === 0
                ? <>No clients yet. <Link to="/clients" onClick={() => onOpenChange(false)} className="text-orange-600 dark:text-orange-400 underline">Add one</Link>.</>
                : "No clients matched your search."}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.value} data-testid={`picker-group-${g.value}`}>
                <div className="px-5 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">{g.label}</span>
                  <span className="text-[10px] text-muted-foreground/70">{g.items.length}</span>
                </div>
                {g.items.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => onPick(c)}
                    data-testid={`picker-pick-${c.id}`}
                    className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors border-b border-border/40"
                  >
                    <div className="w-9 h-9 rounded-md bg-muted text-foreground text-sm font-semibold flex items-center justify-center shrink-0">
                      {(c.name || "?")[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {clientTypeLabel(c.client_type)}
                        {c.client_type === "staff" && c.office ? ` · ${c.office.replace("KM_", "KM ")}` : ""}
                        {c.company ? ` · ${c.company}` : ""}
                      </p>
                    </div>
                    <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <DialogFooter className="px-5 py-3 border-t border-border">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <X size={14} className="mr-1.5" /> Cancel
          </Button>
          <Button type="button" onClick={onSkip} data-testid="picker-skip" className="bg-muted text-foreground hover:bg-muted/80">
            Skip & enrol without reference
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

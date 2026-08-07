import React, { useState } from "react";
import { LEAD_STATUSES, LEAD_STATUS_META } from "./constants";
import { Phone, GraduationCap } from "@phosphor-icons/react";
import UserAvatar from "@/components/UserAvatar";

export default function LeadsBoard({ leads, onCardClick, onStatusChange, editable }) {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);

  const byStatus = LEAD_STATUSES.reduce((acc, s) => { acc[s] = []; return acc; }, {});
  leads.forEach((l) => { (byStatus[l.status] || (byStatus[l.status] = [])).push(l); });

  const handleDrop = (status) => {
    const lead = leads.find((l) => l.id === dragId);
    setOverCol(null);
    setDragId(null);
    if (lead && lead.status !== status) onStatusChange(lead, status);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1" data-testid="leads-board">
      {LEAD_STATUSES.map((s) => {
        const meta = LEAD_STATUS_META[s];
        return (
          <div
            key={s}
            onDragOver={(e) => { if (editable && dragId) { e.preventDefault(); setOverCol(s); } }}
            onDragLeave={() => setOverCol((c) => (c === s ? null : c))}
            onDrop={() => editable && handleDrop(s)}
            data-testid={`board-col-${s}`}
            className={`w-72 shrink-0 flex flex-col rounded-xl border transition-colors ${overCol === s ? "border-orange-500/60 bg-orange-500/5" : "border-border bg-muted/30"} p-2 h-[calc(100vh-16rem)] min-h-[400px]`}
          >
            <div className="flex items-center justify-between px-2 py-1.5 shrink-0">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums" data-testid={`board-col-count-${s}`}>
                {byStatus[s].length}
              </span>
            </div>
            <div
              className="space-y-2 mt-1 flex-1 overflow-y-auto pr-1 -mr-1"
              data-testid={`board-col-scroll-${s}`}
            >
              {byStatus[s].length === 0 ? (
                <p className="text-[11px] text-muted-foreground/70 text-center py-6 select-none">
                  No leads
                </p>
              ) : (
                byStatus[s].map((l) => (
                <div
                  key={l.id}
                  draggable={editable}
                  onDragStart={() => setDragId(l.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  onClick={() => onCardClick(l)}
                  data-testid={`board-card-${l.id}`}
                  className={`rounded-lg border border-border bg-card p-3 cursor-pointer hover:border-orange-500/40 hover:shadow-sm transition-all ${dragId === l.id ? "opacity-40" : ""}`}
                >
                  <p className="text-sm font-medium text-foreground truncate">{l.name}</p>
                  {l.course && <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5"><GraduationCap size={12} /> {l.course}</p>}
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
                    {l.phone && <span className="flex items-center gap-1"><Phone size={11} /> {l.phone}</span>}
                    {l.assigned_to_name && (
                      <span className="pl-0.5 pr-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                        <UserAvatar name={l.assigned_to_name} photoUrl={l.assigned_to_photo_url} size="xs" />
                        {l.assigned_to_name}
                      </span>
                    )}
                    {l.is_missed && <span className="text-rose-500 font-medium">Missed</span>}
                  </div>
                </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

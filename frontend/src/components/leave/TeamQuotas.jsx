import React, { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { PencilSimple, Buildings, UsersThree } from "@phosphor-icons/react";
import StaffQuotaDialog from "./StaffQuotaDialog";

const ROLE_LABEL = { staff: "Staff", office_admin: "Office Admin", super_admin: "Super Admin" };
const officeLabel = (o) => (o ? o.replace("KM_", "KM ") : "—");

function QuotaChips({ q }) {
  const items = [
    ["C", q.casual], ["S", q.sick], ["E", q.earned],
    ["U", q.unpaid == null ? "∞" : q.unpaid],
  ];
  return (
    <div className="flex gap-1.5 flex-wrap">
      {items.map(([k, v]) => (
        <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground tabular-nums" title={k}>
          {k} {v}
        </span>
      ))}
    </div>
  );
}

export default function TeamQuotas() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState(null); // {id, name}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/leave/quotas/team");
      setMembers(data.members || []);
    } catch (err) {
      console.error("[leave] team quotas fetch failed:", err);
      toast.error("Could not load team quotas");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = members.filter((m) =>
    !search || (m.name || "").toLowerCase().includes(search.toLowerCase()) || (m.email || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4" data-testid="team-quotas">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">Set a custom annual allowance per person. People without an override use the company policy.</p>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email…" className="h-9 w-full sm:w-64 bg-card" data-testid="team-quota-search" />
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center" data-testid="team-quota-empty">
          <UsersThree size={40} className="mx-auto text-muted-foreground mb-3" weight="duotone" />
          <p className="text-foreground font-medium">No team members yet</p>
          <p className="text-sm text-muted-foreground mt-1">Staff and office admins will appear here.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="team-quota-list">
          {filtered.map((m) => (
            <Card key={m.id} className="p-4 flex items-start justify-between gap-3" data-testid={`quota-member-${m.id}`}>
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{m.name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  {ROLE_LABEL[m.role] || m.role}
                  <span className="inline-flex items-center gap-1"><Buildings size={11} /> {officeLabel(m.office)}</span>
                </p>
                <div className="mt-2"><QuotaChips q={m.quota} /></div>
                {m.has_override && (
                  <span className="inline-block mt-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300" data-testid={`quota-override-${m.id}`}>
                    Custom
                  </span>
                )}
              </div>
              <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setEdit({ id: m.id, name: m.name })} data-testid={`quota-edit-${m.id}`}>
                <PencilSimple size={14} className="mr-1.5" /> Edit
              </Button>
            </Card>
          ))}
        </div>
      )}

      <StaffQuotaDialog
        open={!!edit}
        onOpenChange={(v) => { if (!v) setEdit(null); }}
        userId={edit?.id}
        userName={edit?.name}
        onSaved={load}
      />
    </div>
  );
}

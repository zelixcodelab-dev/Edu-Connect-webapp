import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Check, X, GitBranch } from "lucide-react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

function useRequests(tenantId) {
  const [items, setItems] = useState([]);
  const load = useCallback(() => {
    api.get("/platform/office-requests", { params: tenantId ? { tenant_id: tenantId } : {} })
      .then((r) => setItems(r.data.items || [])).catch(() => setItems([]));
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);
  const decide = async (r, decision) => {
    try {
      const { data } = await api.post(`/platform/office-requests/${r.id}/${decision}`, {});
      toast.success(decision === "approve" ? `"${r.name}" added for ${r.tenant_name}` : "Request declined");
      load();
      return data;
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not update request"); return null; }
  };
  return { items, decide, reload: load };
}

function RequestRow({ r, onDecide, showClient, onOpenClient }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5" data-testid={`branch-request-${r.id}`}>
      <GitBranch size={15} className="text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0 text-sm">
        <p className="font-medium truncate">{r.name}{showClient && <> · <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpenClient?.(r.tenant_id)}>{r.tenant_name}</button></>}</p>
        <p className="text-xs text-muted-foreground truncate">Requested by {r.requested_by}{r.note ? ` — ${r.note}` : ""}</p>
      </div>
      <Button size="sm" className="gap-1" onClick={() => onDecide(r, "approve")} data-testid={`branch-request-approve-${r.id}`}><Check size={14} /> Approve</Button>
      <Button size="sm" variant="outline" className="gap-1" onClick={() => onDecide(r, "reject")} data-testid={`branch-request-reject-${r.id}`}><X size={14} /> Decline</Button>
    </div>
  );
}

// Clients page: every pending branch request across clients.
export function BranchRequestsStrip({ onOpenClient }) {
  const { items, decide } = useRequests(null);
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2" data-testid="branch-requests-strip">
      <p className="font-display font-semibold text-sm">Branch requests · {items.length} pending</p>
      {items.map((r) => <RequestRow key={r.id} r={r} onDecide={decide} showClient onOpenClient={onOpenClient} />)}
    </div>
  );
}

// Client detail: manage that client's offices and their pending requests.
export function ClientOffices({ client, onSaved }) {
  const [rows, setRows] = useState(client.offices || []);
  const [saving, setSaving] = useState(false);
  const { items, decide } = useRequests(client.id);
  const dirty = JSON.stringify(rows) !== JSON.stringify(client.offices || []);

  const save = async (next = rows) => {
    setSaving(true);
    try {
      const { data } = await api.put(`/platform/tenants/${client.id}/offices`, { offices: next.filter((o) => o.name.trim()) });
      setRows(data.offices);
      onSaved?.(data.offices);
      toast.success("Offices saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save offices"); }
    finally { setSaving(false); }
  };
  const onDecide = async (r, d) => {
    const res = await decide(r, d);
    if (res?.office) { const next = [...rows, res.office]; setRows(next); onSaved?.(next); }
  };
  const set = (i, patch) => setRows((rs) => rs.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-5 space-y-4 text-sm" data-testid="client-offices">
      <div>
        <p className="font-display font-semibold text-base">Offices / branches</p>
        <p className="text-muted-foreground text-xs mt-0.5">The client sees only active offices. Hidden offices keep their records.</p>
      </div>
      {items.length > 0 && <div className="space-y-2">{items.map((r) => <RequestRow key={r.id} r={r} onDecide={onDecide} />)}</div>}
      <div className="space-y-2">
        {rows.map((o, i) => (
          <div key={o.code || `new-${i}`} className="flex items-center gap-3" data-testid={`client-office-row-${i}`}>
            <Input value={o.name} onChange={(e) => set(i, { name: e.target.value })} className="flex-1" data-testid={`client-office-name-${i}`} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
              <Switch checked={o.active !== false} onCheckedChange={(v) => set(i, { active: v })} data-testid={`client-office-active-${i}`} />
              {o.active !== false ? "Active" : "Hidden"}
            </label>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setRows((rs) => [...rs, { name: "", active: true }])} data-testid="client-office-add"><Plus size={14} /> Add office</Button>
        <Button size="sm" onClick={() => save()} disabled={!dirty || saving} data-testid="client-offices-save">{saving ? "Saving…" : "Save offices"}</Button>
      </div>
    </div>
  );
}

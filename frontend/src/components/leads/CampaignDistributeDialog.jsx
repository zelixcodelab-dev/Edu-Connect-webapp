import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle, UsersThree } from "@phosphor-icons/react";

const METHODS = [
  ["equal", "Equal split", "Round-robin across selected employees"],
  ["count", "By count", "Set how many leads each employee gets"],
  ["percentage", "By percentage", "Split by % per employee"],
];

export default function CampaignDistributeDialog({ open, onOpenChange, campaignId, employees, stats, onDistributed }) {
  const [method, setMethod] = useState("equal");
  const [scope, setScope] = useState("unassigned");
  const [selected, setSelected] = useState([]);
  const [counts, setCounts] = useState({});
  const [percentages, setPercentages] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) { setMethod("equal"); setScope("unassigned"); setSelected([]); setCounts({}); setPercentages({}); setResult(null); }
  }, [open]);

  const available = scope === "all" ? (stats?.total || 0) : (stats?.unassigned || 0);

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const pctSum = useMemo(
    () => selected.reduce((sum, id) => sum + (parseFloat(percentages[id]) || 0), 0),
    [selected, percentages]
  );
  const countSum = useMemo(
    () => selected.reduce((sum, id) => sum + (parseInt(counts[id], 10) || 0), 0),
    [selected, counts]
  );

  const submit = async () => {
    if (selected.length === 0) { toast.error("Select at least one employee"); return; }
    if (available === 0) { toast.error("No leads available to distribute for this scope"); return; }
    if (method === "count" && countSum === 0) { toast.error("Enter counts for the employees"); return; }
    if (method === "percentage" && Math.round(pctSum) !== 100) { toast.error("Percentages must add up to 100"); return; }
    setSaving(true); setResult(null);
    try {
      const payload = { method, employee_ids: selected, scope };
      if (method === "count") payload.counts = Object.fromEntries(selected.map((id) => [id, parseInt(counts[id], 10) || 0]));
      if (method === "percentage") payload.percentages = Object.fromEntries(selected.map((id) => [id, parseFloat(percentages[id]) || 0]));
      const { data } = await api.post(`/campaigns/${campaignId}/distribute`, payload);
      setResult(data);
      toast.success(`Distributed ${data.assigned} lead(s)`);
      onDistributed?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not distribute");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-lg" data-testid="campaign-distribute-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Distribute leads</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Assign campaign leads to employees by your chosen method.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scope */}
          <div className="flex items-center gap-2" data-testid="distribute-scope">
            {[["unassigned", `Unassigned (${stats?.unassigned || 0})`], ["all", `All leads (${stats?.total || 0})`]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setScope(v)} data-testid={`distribute-scope-${v}`}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${scope === v ? "bg-amber-gradient text-white border-transparent" : "border-border text-muted-foreground hover:bg-muted"}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Method */}
          <div className="grid grid-cols-3 gap-2" data-testid="distribute-methods">
            {METHODS.map(([v, label, desc]) => (
              <button key={v} type="button" onClick={() => setMethod(v)} data-testid={`distribute-method-${v}`}
                className={`text-left rounded-lg border p-2.5 transition-all ${method === v ? "border-orange-500 bg-amber-gradient-soft" : "border-border hover:border-orange-500/40"}`}>
                <p className="text-xs font-semibold text-foreground">{label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{desc}</p>
              </button>
            ))}
          </div>

          {/* Employees */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><UsersThree size={14} /> Employees</p>
            <div className="max-h-[34vh] overflow-y-auto space-y-1.5 pr-1" data-testid="distribute-employees">
              {(employees || []).map((e) => {
                const on = selected.includes(e.id);
                return (
                  <div key={e.id} className={`flex items-center gap-2 rounded-lg border p-2 ${on ? "border-orange-500/40 bg-amber-gradient-soft" : "border-border"}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(e.id)} data-testid={`distribute-emp-${e.id}`} className="accent-orange-500 w-4 h-4" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{e.name}</p>
                      <p className="text-[10px] text-muted-foreground">{e.role === "staff" ? "Staff" : "Office admin"}</p>
                    </div>
                    {on && method === "count" && (
                      <Input type="number" min="0" value={counts[e.id] ?? ""} onChange={(ev) => setCounts((c) => ({ ...c, [e.id]: ev.target.value }))}
                        data-testid={`distribute-count-${e.id}`} placeholder="0" className="w-20 h-8" />
                    )}
                    {on && method === "percentage" && (
                      <div className="flex items-center gap-1">
                        <Input type="number" min="0" max="100" value={percentages[e.id] ?? ""} onChange={(ev) => setPercentages((p) => ({ ...p, [e.id]: ev.target.value }))}
                          data-testid={`distribute-pct-${e.id}`} placeholder="0" className="w-16 h-8" />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {method === "percentage" && selected.length > 0 && (
              <p className={`text-[11px] mt-1.5 ${Math.round(pctSum) === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} data-testid="distribute-pct-sum">
                Total: {pctSum}% {Math.round(pctSum) === 100 ? "✓" : "(must equal 100)"}
              </p>
            )}
            {method === "count" && selected.length > 0 && (
              <p className="text-[11px] mt-1.5 text-muted-foreground" data-testid="distribute-count-sum">Total to assign: {countSum} of {available} available</p>
            )}
          </div>

          {result && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm" data-testid="distribute-result">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle size={16} weight="fill" /><span><strong>{result.assigned}</strong> lead(s) distributed</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {result.per_employee.map((p) => (
                  <span key={p.id} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">{p.name}: {p.count}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" onClick={submit} disabled={saving} data-testid="distribute-submit-btn" className="btn-amber border-0">
            {saving ? "Distributing…" : "Distribute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

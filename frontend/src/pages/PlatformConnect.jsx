import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, AlertOctagon, Inbox, Clock, PauseCircle, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import PlatformShell from "@/components/platform/PlatformShell";
import { StatCard, StatusBadge, EmptyState, LoadingState } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PRIORITY_TONE = { urgent: "bg-rose-500/10 text-rose-600", high: "bg-amber-500/10 text-amber-600", normal: "bg-sky-500/10 text-sky-600", low: "bg-muted text-muted-foreground" };
const FILTERS = ["all", "open", "in_progress", "waiting", "resolved", "closed"];
const fmt = (s) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");

export default function PlatformConnect() {
  const nav = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({});
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ client_id: "", subject: "", category: "General", priority: "normal", message: "" });

  const load = useCallback(async (f = filter) => {
    setLoading(true);
    try {
      const params = f && f !== "all" ? { status: f } : {};
      const [tk, cl] = await Promise.all([
        api.get("/platform/connect/tickets", { params }),
        api.get("/platform/tenants").catch(() => ({ data: { tenants: [] } })),
      ]);
      setTickets(tk.data.tickets || []);
      setCounts(tk.data.counts || {});
      setClients(cl.data.tenants || []);
    } catch { toast.error("Failed to load tickets"); } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(filter); }, [filter, load]);

  const create = async () => {
    if (!form.subject.trim()) { toast.error("Subject is required"); return; }
    setSaving(true);
    try {
      const client = clients.find((c) => c.id === form.client_id);
      await api.post("/platform/connect/tickets", { ...form, client_name: client?.name || "Unknown" });
      toast.success("Ticket created");
      setOpen(false);
      setForm({ client_id: "", subject: "", category: "General", priority: "normal", message: "" });
      await load(filter);
    } catch (e) { toast.error(e?.response?.data?.detail || "Create failed"); } finally { setSaving(false); }
  };

  return (
    <PlatformShell module={MODULE_BY_KEY.connect} title="Connect">
      <div className="space-y-8">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard icon={Inbox} label="Open" value={counts.open || 0} tint="bg-sky-500/10 text-sky-600" />
          <StatCard icon={Clock} label="In progress" value={counts.in_progress || 0} tint="bg-violet-500/10 text-violet-600" />
          <StatCard icon={PauseCircle} label="Waiting" value={counts.waiting || 0} tint="bg-amber-500/10 text-amber-600" />
          <StatCard icon={CheckCircle2} label="Resolved" value={counts.resolved || 0} tint="bg-emerald-500/10 text-emerald-600" />
          <StatCard icon={AlertOctagon} label="Critical" value={counts.critical || 0} tint="bg-rose-500/10 text-rose-600" />
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} data-testid={`ticket-filter-${f}`}
                className={`px-3 py-1.5 rounded-full text-sm capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}>
                {f.replace("_", " ")}{f === "all" && counts.all ? ` (${counts.all})` : ""}
              </button>
            ))}
          </div>
          <Button onClick={() => setOpen(true)} data-testid="new-ticket-btn" className="bg-primary hover:bg-primary/90 text-primary-foreground border-0"><Plus size={16} className="mr-1.5" /> New ticket</Button>
        </div>

        {loading ? <LoadingState /> : tickets.length === 0 ? (
          <EmptyState icon={Inbox} title="No tickets" desc="No support tickets in this view." />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto" data-testid="ticket-table">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Ticket</TableHead><TableHead className="hidden md:table-cell">Client</TableHead>
                <TableHead>Priority</TableHead><TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">SLA</TableHead><TableHead className="hidden lg:table-cell">Updated</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" data-testid={`ticket-row-${t.ticket_no}`} onClick={() => nav(`/platform/connect/${t.id}`)}>
                    <TableCell><p className="font-medium truncate max-w-[240px]">{t.subject}</p><p className="text-xs text-muted-foreground">{t.ticket_no} · {t.category}</p></TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{t.client_name}</TableCell>
                    <TableCell><Badge className={`border-0 capitalize ${PRIORITY_TONE[t.priority] || ""}`}>{t.priority}</Badge></TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="hidden lg:table-cell">{t.sla?.state === "breached" ? <span className="text-xs text-rose-600 font-medium">Breached</span> : t.sla?.state === "at_risk" ? <span className="text-xs text-amber-600">At risk</span> : <span className="text-xs text-muted-foreground">On track</span>}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{fmt(t.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="ticket-dialog">
          <DialogHeader><DialogTitle>New ticket</DialogTitle><DialogDescription>Log a client support request or complaint.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5"><Label>Client</Label>
              <select value={form.client_id} onChange={(e) => setForm((p) => ({ ...p, client_id: e.target.value }))} data-testid="ticket-client" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select a client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label>Subject</Label><Input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} placeholder="Short summary of the issue" data-testid="ticket-subject" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Category</Label>
                <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {["General", "Bug", "Billing", "Feature", "Infrastructure"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Priority</Label>
                <select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))} data-testid="ticket-priority" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Message</Label><Textarea rows={3} value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))} placeholder="Describe the issue…" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={saving} className="bg-primary text-primary-foreground border-0" data-testid="save-ticket">{saving ? "Creating…" : "Create ticket"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlatformShell>
  );
}

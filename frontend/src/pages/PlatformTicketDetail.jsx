import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Send, Lock, CheckCircle2, Clock } from "lucide-react";
import api from "@/lib/api";
import PlatformShell from "@/components/platform/PlatformShell";
import { StatusBadge, LoadingState, EmptyState, Avatar } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const STATUSES = ["open", "assigned", "in_progress", "waiting", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const fmt = (s) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function PlatformTicketDetail() {
  const { ticketId } = useParams();
  const nav = useNavigate();
  const [t, setT] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get(`/platform/connect/tickets/${ticketId}`); setT(data); }
    catch { /* */ } finally { setLoading(false); }
  }, [ticketId]);
  useEffect(() => { load(); }, [load]);

  const patch = async (body) => {
    try { const { data } = await api.patch(`/platform/connect/tickets/${ticketId}`, body); setT(data); toast.success("Ticket updated"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Update failed"); }
  };

  const send = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post(`/platform/connect/tickets/${ticketId}/messages`, { body: reply, internal });
      setT(data); setReply(""); setInternal(false);
    } catch (e) { toast.error("Failed to send"); } finally { setSending(false); }
  };

  const resolve = async () => {
    const note = window.prompt("Resolution summary:");
    if (!note) return;
    try { const { data } = await api.post(`/platform/connect/tickets/${ticketId}/resolve`, { resolution: note }); setT(data); toast.success("Ticket resolved"); }
    catch { toast.error("Failed to resolve"); }
  };

  if (loading) return <PlatformShell module={MODULE_BY_KEY.connect} title="Ticket"><LoadingState /></PlatformShell>;
  if (!t) return <PlatformShell module={MODULE_BY_KEY.connect} title="Ticket"><EmptyState title="Ticket not found" /></PlatformShell>;

  const slaTone = t.sla?.state === "breached" ? "text-rose-600" : t.sla?.state === "at_risk" ? "text-amber-600" : "text-emerald-600";

  return (
    <PlatformShell module={MODULE_BY_KEY.connect} title={t.ticket_no}>
      <button onClick={() => nav("/platform/connect")} data-testid="back-to-connect" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5">
        <ArrowLeft size={15} /> All tickets
      </button>

      <div className="grid lg:grid-cols-[1fr,300px] gap-6">
        {/* Conversation */}
        <div>
          <div className="mb-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">{t.subject}</h2>
            <p className="text-sm text-muted-foreground">{t.ticket_no} · {t.client_name} · {t.category}</p>
          </div>

          <div className="space-y-4" data-testid="ticket-conversation">
            {(t.messages || []).length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
            {(t.messages || []).map((m) => (
              <div key={m.id} className={`rounded-xl border p-4 ${m.internal ? "border-amber-500/30 bg-amber-500/5" : m.author_role === "staff" ? "border-border bg-primary/5" : "border-border bg-card"}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Avatar name={m.author} size={26} />
                  <span className="text-sm font-medium">{m.author}</span>
                  <span className="text-xs text-muted-foreground capitalize">· {m.author_role}</span>
                  {m.internal && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600"><Lock size={10} /> INTERNAL</span>}
                  <span className="text-xs text-muted-foreground ml-auto">{fmt(m.created_at)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>

          {/* Reply box */}
          <div className="mt-5 rounded-xl border border-border bg-card p-3">
            <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={internal ? "Add an internal note (not visible to client)…" : "Write a reply…"} data-testid="ticket-reply-input" className="border-0 focus-visible:ring-0 resize-none" />
            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="ticket-internal-toggle" /> Internal note
              </label>
              <Button onClick={send} disabled={sending || !reply.trim()} data-testid="ticket-send" className="bg-primary text-primary-foreground border-0"><Send size={15} className="mr-1.5" /> {sending ? "Sending…" : "Send"}</Button>
            </div>
          </div>
        </div>

        {/* Sidebar controls */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div><p className="text-xs text-muted-foreground mb-1">Status</p>
              <select value={t.status} onChange={(e) => patch({ status: e.target.value })} data-testid="ticket-status-select" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm capitalize">
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
            <div><p className="text-xs text-muted-foreground mb-1">Priority</p>
              <select value={t.priority} onChange={(e) => patch({ priority: e.target.value })} data-testid="ticket-priority-select" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm capitalize">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div><p className="text-xs text-muted-foreground mb-1">Assigned to</p>
              <input defaultValue={t.assigned_to || ""} onBlur={(e) => e.target.value !== (t.assigned_to || "") && patch({ assigned_to: e.target.value })} placeholder="Unassigned" data-testid="ticket-assign-input" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">SLA</span><span className={`inline-flex items-center gap-1 font-medium ${slaTone}`}><Clock size={13} /> {(t.sla?.state || "none").replace("_", " ")}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Due</span><span>{fmt(t.sla?.due)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Created</span><span>{fmt(t.created_at)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Current</span><StatusBadge status={t.status} /></div>
          </div>

          {t.status !== "resolved" && t.status !== "closed" && (
            <Button onClick={resolve} data-testid="ticket-resolve" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white border-0"><CheckCircle2 size={16} className="mr-1.5" /> Mark resolved</Button>
          )}
          {t.resolution && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"><p className="font-medium text-emerald-600 mb-1">Resolution</p><p className="text-muted-foreground">{t.resolution}</p></div>}
        </aside>
      </div>
    </PlatformShell>
  );
}

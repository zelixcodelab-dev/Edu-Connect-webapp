import React, { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const OUTCOMES = [
  ["connected", "Connected"], ["no_answer", "No answer"], ["busy", "Busy"],
  ["call_back", "Call back later"], ["wrong_number", "Wrong number"],
];

const tomorrowAt10 = () => {
  const d = new Date(Date.now() + 86400000);
  d.setHours(10, 0, 0, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Opens "How did the call go?" once the user comes back from the dialer.
export function useCallPrompt() {
  const [pending, setPending] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    if (!pending) return undefined;
    let left = false;
    const show = () => { setPrompt(pending); setPending(null); };
    const onVis = () => {
      if (document.visibilityState === "hidden") left = true;
      else if (left) show();
    };
    // Desktop (no app switch): ask after a short pause instead.
    timer.current = setTimeout(() => { if (!left) show(); }, 6000);
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVis); };
  }, [pending]);
  return { startCall: (phone) => setPending({ phone, at: Date.now() }), prompt, closePrompt: () => setPrompt(null) };
}

export function CallLogDialog({ lead, call, onClose, onSaved }) {
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [fuAt, setFuAt] = useState(tomorrowAt10());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (call) { setOutcome(""); setNote(""); setFuAt(tomorrowAt10()); } }, [call]);

  const save = async () => {
    setBusy(true);
    try {
      let { data } = await api.post(`/leads/${lead.id}/call-log`, { outcome, note, phone: call?.phone || "" });
      if (outcome === "call_back" && fuAt) {
        const r = await api.post(`/leads/${lead.id}/followups`, { at: new Date(fuAt).toISOString(), note: note || "Call back" });
        data = r.data;
      }
      onSaved?.(data);
      onClose();
    } catch { /* error surfaced by the global feedback card */ }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!call} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm" data-testid="call-log-dialog">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display">How did the call go?</DialogTitle>
          <DialogDescription>{lead?.name}{call?.phone ? ` · ${call.phone}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" data-testid="call-log-outcomes">
          {OUTCOMES.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setOutcome(v)} data-testid={`call-outcome-${v}`} aria-pressed={outcome === v}
              className={`px-3.5 h-9 rounded-full text-sm border transition-colors ${outcome === v ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-transparent" : "border-border hover:bg-muted"}`}>
              {l}
            </button>
          ))}
        </div>
        {outcome === "call_back" && (
          <div className="space-y-1.5" data-testid="call-log-followup">
            <Label>Follow-up on</Label>
            <Input type="datetime-local" value={fuAt} onChange={(e) => setFuAt(e.target.value)} data-testid="call-log-followup-at" />
          </div>
        )}
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" data-testid="call-log-note" />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose} data-testid="call-log-skip">Skip</Button>
          <Button onClick={save} disabled={!outcome || busy} data-testid="call-log-save">{busy ? "Saving…" : "Save to journey"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { GitBranch, Plus } from "lucide-react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getOffices } from "@/lib/offices";

const STATUS = { pending: "Waiting for approval", approved: "Approved", rejected: "Declined" };

// Company admin: see their offices and request a new branch from the provider.
export default function OfficesSettings() {
  const [reqs, setReqs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", note: "" });
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/offices/requests").then((r) => setReqs(r.data.items || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/offices/requests", form);
      toast.success("Request sent. Your provider will add the branch once approved.");
      setOpen(false); setForm({ name: "", note: "" }); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not send request"); }
    finally { setBusy(false); }
  };

  return (
    <Card className="p-6 border border-border bg-card rounded-lg shadow-none space-y-4" data-testid="offices-settings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Offices & branches</h2>
          <p className="text-sm text-muted-foreground">Offices on your plan. Need another branch? Send a request.</p>
        </div>
        <Button variant="outline" className="gap-1.5" onClick={() => setOpen(true)} data-testid="request-branch-btn"><Plus size={15} /> Request a branch</Button>
      </div>
      <div className="flex flex-wrap gap-2" data-testid="offices-list">
        {getOffices().map((o) => (
          <span key={o.code} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm"><GitBranch size={13} /> {o.name}</span>
        ))}
      </div>
      {reqs.length > 0 && (
        <div className="space-y-1.5" data-testid="branch-requests-list">
          {reqs.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 text-sm rounded-lg border border-border px-3 py-2">
              <span className="truncate">{r.name}</span>
              <span className="text-xs text-muted-foreground shrink-0" data-testid={`branch-request-status-${r.id}`}>{STATUS[r.status] || r.status}</span>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request a new branch</DialogTitle>
            <DialogDescription>Your provider reviews the request and adds the branch to your workspace.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Branch name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kochi Branch" data-testid="branch-name-input" />
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} placeholder="City, expected staff, start date…" data-testid="branch-note-input" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={busy || form.name.trim().length < 2} data-testid="branch-request-submit">{busy ? "Sending…" : "Send request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

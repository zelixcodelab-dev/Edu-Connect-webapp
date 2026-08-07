import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash } from "@phosphor-icons/react";
import { LEAD_SOURCES } from "./constants";

const blankRow = () => ({ name: "", phone: "", course: "", place: "" });

export default function CampaignAddLeadsDialog({ open, onOpenChange, campaignId, onAdded }) {
  const [rows, setRows] = useState([blankRow(), blankRow(), blankRow()]);
  const [source, setSource] = useState("other");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setRows([blankRow(), blankRow(), blankRow()]); setSource("other"); } }, [open]);

  const update = (i, k, v) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const addRow = () => setRows((r) => [...r, blankRow()]);
  const removeRow = (i) => setRows((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : r));

  const submit = async () => {
    const leads = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), phone: r.phone.trim(), course: r.course.trim(), place: r.place.trim(), source }));
    if (leads.length === 0) { toast.error("Add at least one lead with a name"); return; }
    setSaving(true);
    try {
      const { data } = await api.post(`/campaigns/${campaignId}/leads`, { leads });
      toast.success(`Added ${data.created_count} lead(s)`);
      onAdded?.();
      onOpenChange(false);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not add leads");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-2xl" data-testid="campaign-addleads-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Add leads to campaign</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Leads are added unassigned — distribute them to your team afterwards.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Source for all</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger data-testid="campaign-addleads-source" className="w-40 h-9 bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAD_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="max-h-[45vh] overflow-y-auto space-y-2 pr-1" data-testid="campaign-addleads-rows">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1.4fr_1fr_1.2fr_1fr_auto] gap-2 items-center">
                <Input placeholder="Name *" value={row.name} onChange={(e) => update(i, "name", e.target.value)} data-testid={`campaign-row-name-${i}`} className="h-9" />
                <Input placeholder="Phone" value={row.phone} onChange={(e) => update(i, "phone", e.target.value)} data-testid={`campaign-row-phone-${i}`} className="h-9" />
                <Input placeholder="Course" value={row.course} onChange={(e) => update(i, "course", e.target.value)} className="h-9" />
                <Input placeholder="Place" value={row.place} onChange={(e) => update(i, "place", e.target.value)} className="h-9" />
                <button type="button" onClick={() => removeRow(i)} data-testid={`campaign-row-remove-${i}`} className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors">
                  <Trash size={16} />
                </button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addRow} data-testid="campaign-addrow-btn" className="h-8">
            <Plus size={14} className="mr-1" /> Add row
          </Button>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={saving} data-testid="campaign-addleads-save-btn" className="btn-amber border-0">
            {saving ? "Adding…" : "Add leads"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

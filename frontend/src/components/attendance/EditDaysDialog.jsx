import React, { useCallback, useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash, Plus, FloppyDisk } from "@phosphor-icons/react";

const STATUSES = ["present", "late", "half_day", "absent", "leave", "weekoff"];

const toHM = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  } catch {
    return "";
  }
};

function DayRow({ userId, rec, isNew, onSaved, onRemoveNew }) {
  const [date, setDate] = useState(rec?.date || "");
  const [status, setStatus] = useState(rec?.status || "present");
  const [ci, setCi] = useState(toHM(rec?.check_in));
  const [co, setCo] = useState(toHM(rec?.check_out));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!date) return toast.error("Pick a date");
    setBusy(true);
    try {
      await api.post("/attendance/admin/upsert", {
        user_id: userId, date, status, check_in: ci || null, check_out: co || null,
      });
      toast.success("Saved");
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (isNew) return onRemoveNew?.();
    if (!window.confirm(`Delete the ${rec.date} record for this staff? This can affect payroll.`)) return;
    setBusy(true);
    try {
      await api.delete(`/attendance/${rec.id}`);
      toast.success("Deleted");
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 py-1.5" data-testid={isNew ? "edit-day-new-row" : `edit-day-row-${rec.id}`}>
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!isNew} className="h-8 w-[140px] text-xs" data-testid="edit-day-date" />
      <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="edit-day-status" className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground capitalize">
        {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
      </select>
      <Input type="time" value={ci} onChange={(e) => setCi(e.target.value)} className="h-8 w-[110px] text-xs" data-testid="edit-day-in" />
      <Input type="time" value={co} onChange={(e) => setCo(e.target.value)} className="h-8 w-[110px] text-xs" data-testid="edit-day-out" />
      <Button size="sm" className="h-8 px-2" onClick={save} disabled={busy} data-testid="edit-day-save"><FloppyDisk size={14} /></Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-rose-600" onClick={remove} disabled={busy} data-testid="edit-day-delete"><Trash size={14} /></Button>
    </div>
  );
}

export default function EditDaysDialog({ open, onOpenChange, staff, month, onChanged }) {
  const [records, setRecords] = useState([]);
  const [newRows, setNewRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!staff) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/attendance?month=${month}&user_id=${staff.user_id}`);
      setRecords((data.records || []).sort((a, b) => (a.date < b.date ? -1 : 1)));
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [staff, month]);

  useEffect(() => {
    if (open) { setNewRows([]); load(); }
    else { setRecords([]); setNewRows([]); }
  }, [open, load]);

  if (!staff) return null;

  const afterChange = () => { load(); onChanged?.(); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="edit-days-dialog" className="max-w-2xl">
        <DialogHeader><DialogTitle>Edit days · {staff?.name} · {month}</DialogTitle></DialogHeader>
        <div className="py-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1 pb-1">
            <span className="w-[140px]">Date</span><span className="flex-1">Status</span><span className="w-[110px]">In</span><span className="w-[110px]">Out</span><span className="w-[92px]" />
          </div>
          <div className="max-h-[46vh] overflow-auto divide-y divide-border">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
            ) : records.length === 0 && newRows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No records this month. Add a day below.</p>
            ) : (
              <>
                {records.map((r) => <DayRow key={r.id} userId={staff.user_id} rec={r} onSaved={afterChange} />)}
                {newRows.map((n) => (
                  <DayRow key={n} userId={staff.user_id} isNew onSaved={afterChange} onRemoveNew={() => setNewRows((s) => s.filter((x) => x !== n))} />
                ))}
              </>
            )}
          </div>
          <Button variant="outline" size="sm" className="mt-3" data-testid="edit-day-add" onClick={() => setNewRows((s) => [...s, Date.now()])}>
            <Plus size={14} className="mr-1" /> Add day
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

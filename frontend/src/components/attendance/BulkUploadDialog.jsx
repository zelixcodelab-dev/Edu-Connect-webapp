import React, { useRef, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { UploadSimple, DownloadSimple, FileCsv } from "@phosphor-icons/react";

const TEMPLATES = {
  attendance: {
    header: "email,date,status,check_in,check_out",
    sample: "staff@example.com,2026-06-01,present,10:00,19:00\nstaff@example.com,2026-06-02,week-off,,\nstaff@example.com,2026-06-03,casual leave,,\nstaff@example.com,2026-06-04,sick leave,,\nstaff@example.com,2026-06-05,paid leave,,\nstaff@example.com,2026-06-06,unpaid leave,,\nstaff@example.com,2026-06-07,half day,10:00,14:00\nstaff@example.com,2026-06-08,absent,,",
    hint: "Columns: email (or user_id), date (YYYY-MM-DD), status, check_in, check_out (HH:MM). Status: present, absent, late, half day, week-off, casual leave, sick leave, paid leave, unpaid leave. Casual/sick/paid leave & week-off = paid; unpaid leave = unpaid. check_in/out only needed for present/late/half day.",
  },
  salaries: {
    header: "email,monthly_salary",
    sample: "staff@example.com,28000",
    hint: "Columns: email (or user_id), monthly_salary.",
  },
};

function downloadTemplate(kind) {
  const t = TEMPLATES[kind];
  const blob = new Blob([`${t.header}\n${t.sample}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${kind}-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BulkUploadDialog({ open, onOpenChange, onDone }) {
  const [kind, setKind] = useState("attendance");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [applied, setApplied] = useState(false);
  const fileRef = useRef(null);

  const reset = () => { setPreview(null); setApplied(false); };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsv(await f.text());
    reset();
    toast.success(`Loaded ${f.name}`);
  };

  const runPreview = async () => {
    if (!csv.trim()) return toast.error("Paste or choose a CSV first");
    setBusy(true);
    setApplied(false);
    try {
      const { data } = await api.post("/attendance/bulk", { kind, csv, preview: true });
      setPreview(data);
      if (data.error_count && !(data.created + data.updated)) toast.error("All rows have errors — fix them before applying");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/attendance/bulk", { kind, csv, preview: false });
      setPreview(data);
      setApplied(true);
      toast.success(`Applied · ${data.created} added · ${data.updated} updated${data.error_count ? ` · ${data.error_count} skipped` : ""}`);
      onDone?.();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const t = TEMPLATES[kind];
  const validCount = preview ? preview.created + preview.updated : 0;
  const ACTION_CLS = {
    create: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    update: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    error: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="bulk-upload-dialog" className="max-w-2xl">
        <DialogHeader><DialogTitle>Bulk upload</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex gap-2">
            {["attendance", "salaries"].map((k) => (
              <button
                key={k}
                onClick={() => { setKind(k); reset(); }}
                data-testid={`bulk-kind-${k}`}
                className={`flex-1 h-10 rounded-md border text-sm font-medium capitalize ${kind === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button onClick={() => downloadTemplate(kind)} data-testid="bulk-template" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              <DownloadSimple size={15} /> Download {kind} template
            </button>
            <button onClick={() => fileRef.current?.click()} data-testid="bulk-file-btn" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <FileCsv size={15} /> Choose CSV file
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" data-testid="bulk-file-input" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">CSV content</label>
            <Textarea
              value={csv}
              onChange={(e) => { setCsv(e.target.value); reset(); }}
              rows={5}
              placeholder={`${t.header}\n${t.sample}`}
              data-testid="bulk-csv"
              className="mt-1 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">{t.hint} Existing rows for the same staff + date are overwritten.</p>
          </div>

          {preview && (
            <div data-testid="bulk-preview">
              <div className="flex items-center gap-3 text-xs font-medium mb-2">
                <span className="text-emerald-600 dark:text-emerald-400">{preview.created} to add</span>
                <span className="text-sky-600 dark:text-sky-400">{preview.updated} to update</span>
                <span className="text-rose-600 dark:text-rose-400">{preview.error_count} error{preview.error_count !== 1 ? "s" : ""}</span>
                {applied && <span className="ml-auto text-foreground font-semibold">✓ Applied</span>}
              </div>
              <div className="max-h-56 overflow-auto rounded-lg border border-border divide-y divide-border">
                {(preview.rows || []).map((r, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs" data-testid={`bulk-prow-${r.line}`}>
                    <span className="text-muted-foreground w-8 shrink-0">#{r.line}</span>
                    <span className="flex-1 min-w-0 truncate">
                      <span className="text-foreground font-medium">{r.name || r.ref}</span>
                      <span className="text-muted-foreground">
                        {kind === "salaries"
                          ? ` · ₹${r.salary ?? "?"}`
                          : `${r.date ? ` · ${r.date}` : ""}${r.status ? ` · ${r.status}` : ""}`}
                        {r.message ? ` · ${r.message}` : ""}
                      </span>
                    </span>
                    <span className={`px-2 py-0.5 rounded-full font-medium shrink-0 ${ACTION_CLS[r.action]}`}>{r.action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="outline" onClick={runPreview} disabled={busy} data-testid="bulk-preview-btn">Preview</Button>
          <Button className="btn-amber" onClick={apply} disabled={busy || !preview || validCount === 0 || applied} data-testid="bulk-submit">
            <UploadSimple size={16} className="mr-1.5" /> Apply{preview ? ` (${validCount})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

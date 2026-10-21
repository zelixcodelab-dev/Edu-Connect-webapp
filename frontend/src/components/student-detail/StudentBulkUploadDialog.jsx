import React, { useRef, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { UploadSimple, DownloadSimple, FileCsv } from "@phosphor-icons/react";

const HEADER = "Enrollment Date,Name,Course,College,Reference,Status,Visible to office";
const SAMPLE = [
  "2026-06-01,Anjali Menon,BSc Nursing,City College,Ramesh (agent),Enrolled,KM_BLR",
  "15/06/2026,Rahul Nair,BPT,Green Valley College,,Inquiry,KM_TCR",
  "2026-06-20,Fathima K,B.Com,Sunrise College,,Completed,ALL",
].join("\n");

function downloadTemplate() {
  const blob = new Blob([`${HEADER}\n${SAMPLE}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "admissions-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const ACTION_CLS = {
  create: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  update: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  error: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

// Super / Office admin only: bulk-create admissions from a CSV with a
// row-by-row dry-run preview before applying.
export default function StudentBulkUploadDialog({ open, onOpenChange, onDone }) {
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

  const call = async (isPreview) => {
    if (!csv.trim()) { toast.error("Paste or choose a CSV first"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/students/bulk", { csv, preview: isPreview });
      setPreview(data);
      if (isPreview) {
        setApplied(false);
        if (data.error_count && !(data.created + data.updated)) toast.error("All rows have errors — fix them before applying");
      } else {
        setApplied(true);
        toast.success(`${data.created} added · ${data.updated} updated${data.error_count ? ` · ${data.error_count} skipped` : ""}`);
        onDone?.();
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setCsv(""); reset(); } }}>
      <DialogContent data-testid="student-bulk-dialog" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk upload admissions</DialogTitle>
          <DialogDescription className="text-xs">
            Upload a CSV of admissions. Preview each row before applying.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button onClick={downloadTemplate} data-testid="student-bulk-template" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              <DownloadSimple size={15} /> Download template
            </button>
            <button onClick={() => fileRef.current?.click()} data-testid="student-bulk-file-btn" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <FileCsv size={15} /> Choose CSV file
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" data-testid="student-bulk-file-input" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">CSV content</label>
            <Textarea
              value={csv}
              onChange={(e) => { setCsv(e.target.value); reset(); }}
              rows={6}
              placeholder={`${HEADER}\n${SAMPLE}`}
              data-testid="student-bulk-csv"
              className="mt-1 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Columns: Enrollment Date, Name (required), Course, College, Reference, Status, Visible to office. Status: inquiry, enrolled, cancelled, completed. Visible to office: KM_BLR, KM_TCR, KM_KMLY or ALL (blank = private; Office Admin uploads always go to their own office). Reference auto-links to a staff/agent by name when it matches.
            </p>
          </div>

          {preview && (
            <div data-testid="student-bulk-preview">
              <div className="flex items-center gap-3 text-xs font-medium mb-2">
                <span className="text-emerald-600 dark:text-emerald-400">{preview.created} to add</span>
                <span className="text-sky-600 dark:text-sky-400">{preview.updated} to update</span>
                <span className="text-rose-600 dark:text-rose-400">{preview.error_count} error{preview.error_count !== 1 ? "s" : ""}</span>
                {applied && <span className="ml-auto text-foreground font-semibold">✓ Applied</span>}
              </div>
              <div className="max-h-56 overflow-auto rounded-lg border border-border divide-y divide-border">
                {(preview.rows || []).map((r, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs" data-testid={`student-bulk-prow-${r.line}`}>
                    <span className="text-muted-foreground w-8 shrink-0">#{r.line}</span>
                    <span className="flex-1 min-w-0 truncate">
                      <span className="text-foreground font-medium">{r.name || "—"}</span>
                      <span className="text-muted-foreground">
                        {r.status ? ` · ${r.status}` : ""}{r.date ? ` · ${r.date}` : ""}{r.college ? ` · ${r.college}` : ""}{r.office ? ` · ${String(r.office).replace("KM_", "KM ")}` : ""}
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
          <Button variant="outline" onClick={() => call(true)} disabled={busy} data-testid="student-bulk-preview-btn">Preview</Button>
          <Button className="btn-amber" onClick={() => call(false)} disabled={busy || !preview || (preview.created + preview.updated) === 0 || applied} data-testid="student-bulk-submit">
            <UploadSimple size={16} className="mr-1.5" /> Apply{preview ? ` (${preview.created + preview.updated})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

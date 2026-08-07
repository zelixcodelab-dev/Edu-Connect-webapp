import React, { useRef, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  UploadSimple, DownloadSimple, CheckCircle, Warning, FileCsv,
} from "@phosphor-icons/react";

/** CSV bulk-upload dialog for the colleges catalogue. Self-contained — owns
 * the file input, template download, and post-upload result summary.
 * `onUploaded()` runs after a successful upload so the parent can refresh.
 */
export default function BulkUploadDialog({ open, onOpenChange, onUploaded }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const downloadTemplate = async () => {
    try {
      const r = await api.get("/colleges/template", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "colleges-template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[colleges] template failed:", err);
      toast.error("Could not download template");
    }
  };

  const handleUpload = async () => {
    if (!file) { toast.error("Pick a CSV file first"); return; }
    setUploading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/colleges/bulk", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(r.data);
      if (r.data.created_count > 0) {
        toast.success(`Added ${r.data.created_count} college(s)`);
        onUploaded?.();
      } else {
        toast.message("Nothing to add", { description: "All rows were duplicates or blank." });
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Bulk upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="bg-card max-w-lg" data-testid="bulk-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Bulk upload colleges</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Upload a CSV with columns <code className="px-1 py-0.5 rounded bg-muted text-foreground">name</code>,{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-foreground">courses</code>,{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-foreground">place</code>,{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-foreground">deal_with</code>,{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-foreground">sc_rates</code>.
            Duplicates are skipped. <br />
            <span className="text-[11px] text-amber-700 dark:text-amber-400">
              <strong>sc_rates</strong> (optional, confidential): <code>Course:Amount|Course:Amount</code>
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-gradient-soft p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm">
              <FileCsv size={20} className="text-amber-700 dark:text-amber-400" />
              <span className="text-foreground">Need a template?</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
              data-testid="download-template-btn"
              className="h-8"
            >
              <DownloadSimple size={14} className="mr-1" /> Sample CSV
            </Button>
          </div>

          <div>
            <Label>CSV file</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }}
              data-testid="bulk-file-input"
              className="block w-full text-sm text-foreground file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-amber-gradient file:text-white file:cursor-pointer mt-1.5"
            />
            {file && (
              <p className="text-xs text-muted-foreground mt-2" data-testid="bulk-file-name">
                Selected: <span className="text-foreground">{file.name}</span>
                {" "}({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          {result && (
            <div
              className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-sm"
              data-testid="bulk-result"
            >
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle size={16} weight="fill" />
                <span><strong>{result.created_count}</strong> college(s) added</span>
              </div>
              {result.duplicates_count > 0 && (
                <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                  <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
                  <span>
                    <strong>{result.duplicates_count}</strong> duplicate(s) skipped
                    {result.duplicates_sample?.length > 0 && (
                      <span className="text-muted-foreground"> — e.g. {result.duplicates_sample.slice(0, 3).join(", ")}</span>
                    )}
                  </span>
                </div>
              )}
              {result.skipped_blank_rows?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Skipped {result.skipped_blank_rows.length} blank row(s).
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {result ? "Done" : "Cancel"}
          </Button>
          <Button
            type="button"
            onClick={handleUpload}
            disabled={!file || uploading}
            className="btn-amber border-0"
            data-testid="bulk-submit-btn"
          >
            <UploadSimple size={14} className="mr-1.5" />
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

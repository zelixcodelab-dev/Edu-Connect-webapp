import React, { useRef, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { DownloadSimple, CheckCircle, FileCsv } from "@phosphor-icons/react";

export default function LeadsBulkUploadDialog({ open, onOpenChange, onUploaded, assignable, user, campaignId = null }) {
  const isStaff = user?.role === "staff";
  const campaignMode = !!campaignId;
  const [file, setFile] = useState(null);
  const [assignee, setAssignee] = useState("");
  const [result, setResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const reset = () => {
    setFile(null); setResult(null); setAssignee("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const close = () => { onOpenChange(false); reset(); };

  const downloadTemplate = async () => {
    try {
      const r = await api.get("/leads/template", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url; a.download = "leads-template.csv";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[leads] template failed:", err);
      toast.error("Could not download template");
    }
  };

  const handleUpload = async () => {
    if (!file) { toast.error("Pick a CSV file first"); return; }
    setUploading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (campaignMode) fd.append("campaign_id", campaignId);
      else if (!isStaff && assignee) fd.append("assigned_to_user_id", assignee);
      const r = await api.post("/leads/bulk", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(r.data);
      if (r.data.created_count > 0) {
        toast.success(`Imported ${r.data.created_count} lead(s)`);
        onUploaded?.();
      } else {
        toast.message("Nothing imported", { description: "All rows were blank." });
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Bulk upload failed");
    } finally { setUploading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="bg-card max-w-lg" data-testid="leads-bulk-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Bulk upload leads</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            CSV columns: <code className="px-1 py-0.5 rounded bg-muted text-foreground">name, phone, email, course, place, source, notes, employee</code>.
            {campaignMode
              ? " Leads are added to this campaign, unassigned — distribute them afterwards. A matching 'employee' cell still assigns that row."
              : (isStaff ? " Imported leads are assigned to you." : " Fill the optional 'employee' column to assign a row to a specific employee by name; blank or unmatched rows use the default assignee below.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-gradient-soft p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm">
              <FileCsv size={20} className="text-amber-700 dark:text-amber-400" />
              <span className="text-foreground">Need a template?</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} data-testid="leads-download-template-btn" className="h-8">
              <DownloadSimple size={14} className="mr-1" /> Sample CSV
            </Button>
          </div>

          {!isStaff && !campaignMode && (
            <div className="space-y-1.5">
              <Label>Default assignee <span className="text-muted-foreground font-normal">(used when a row's "employee" is blank or unmatched)</span></Label>
              <Select value={assignee || "self"} onValueChange={(v) => setAssignee(v === "self" ? "" : v)}>
                <SelectTrigger data-testid="leads-bulk-assignee" className="bg-card"><SelectValue placeholder="Me" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Me (uploader)</SelectItem>
                  {(assignable || []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name} · {u.role === "staff" ? "Staff" : "Office admin"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>CSV file</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }}
              data-testid="leads-bulk-file-input"
              className="block w-full text-sm text-foreground file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-amber-gradient file:text-white file:cursor-pointer mt-1.5"
            />
            {file && <p className="text-xs text-muted-foreground mt-2">Selected: <span className="text-foreground">{file.name}</span></p>}
          </div>

          {result && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm" data-testid="leads-bulk-result">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle size={16} weight="fill" />
                <span><strong>{result.created_count}</strong> lead(s) imported</span>
              </div>
              {result.skipped_blank_rows?.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">{result.skipped_blank_rows.length} blank row(s) skipped</p>
              )}
              {result.unmatched_employees?.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1" data-testid="leads-bulk-unmatched">
                  {result.unmatched_employees.length} employee name(s) not matched — those leads used the default assignee: {result.unmatched_employees.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={close}>Close</Button>
          <Button type="button" onClick={handleUpload} disabled={uploading || !file} data-testid="leads-bulk-upload-btn" className="btn-amber border-0">
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

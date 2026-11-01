import React, { useRef, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DownloadSimple, UploadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { downloadClientsCsv } from "@/lib/downloadClients";
import ClientImportReviewDialog from "@/components/clients/ClientImportReviewDialog";

export const ClientsCsvActions = ({ scopeTypes, defaultType, onImported }) => {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async (f, dryRun) => {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("default_type", defaultType);
    const { data } = await api.post(`/clients/import?dry_run=${dryRun}`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  };

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!f) return;
    setBusy(true);
    try {
      setPreview(await send(f, true));
      setFile(f);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not read the CSV");
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const data = await send(file, false);
      toast.success(`Imported ${data.created} client${data.created === 1 ? "" : "s"}`);
      setPreview(null); setFile(null);
      onImported?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Import failed");
    } finally { setBusy(false); }
  };

  const download = async () => {
    try { await downloadClientsCsv({ types: scopeTypes.join(",") }); }
    catch { toast.error("Download failed"); }
  };

  return (
    <>
      <Button variant="outline" className="h-10" onClick={download} data-testid="clients-download-btn">
        <DownloadSimple size={16} className="mr-1.5" /> Download
      </Button>
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onPick} data-testid="clients-upload-input" />
      <Button variant="outline" className="h-10" disabled={busy} onClick={() => inputRef.current?.click()} data-testid="clients-upload-btn">
        <UploadSimple size={16} className="mr-1.5" /> {busy && !preview ? "Reading…" : "Upload"}
      </Button>
      <ClientImportReviewDialog
        preview={preview} busy={busy} onConfirm={confirm}
        onCancel={() => { setPreview(null); setFile(null); }}
      />
    </>
  );
};

export default ClientsCsvActions;

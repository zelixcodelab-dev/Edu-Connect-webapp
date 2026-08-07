import React, { useRef, useState } from "react";
import api, { API, getStoredToken, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Paperclip, FilePdf, FileImage, Trash, DownloadSimple, UploadSimple } from "@phosphor-icons/react";

/**
 * Attachments panel inside the Lead detail dialog.
 *
 * Admin-only editing: only super_admin / office_admin can upload or delete
 * files. Everyone with view access sees the list and can download.
 *
 * Uploads go straight to POST /api/leads/{id}/attachments which does the
 * heavy lifting (MIME + size validation + push into leads.attachments).
 * We refresh the parent's local ``lead`` after each mutation via ``onChanged``.
 */
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";
const MAX_MB = 10;

function humanBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function iconFor(ct) {
  if ((ct || "").startsWith("image/")) return FileImage;
  if (ct === "application/pdf") return FilePdf;
  return Paperclip;
}

function authedUrl(url) {
  // The <a> download / <img> src needs the token appended as a query param
  // since headers aren't attached by the browser for these tags.
  const token = getStoredToken() || "";
  const base = url.startsWith("/api/") ? `${API}${url.replace(/^\/api/, "")}` : url;
  return `${base}?auth=${encodeURIComponent(token)}`;
}

export default function LeadAttachments({ lead, canManage, onChanged }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const items = lead?.attachments || [];

  const pick = () => inputRef.current?.click();

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`File must be ${MAX_MB}MB or smaller`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/leads/${lead.id}/attachments`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      // Optimistic append so we don't need to refetch the lead
      onChanged?.({ ...lead, attachments: [...items, data] });
      toast.success("Uploaded");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (att) => {
    if (!window.confirm(`Delete "${att.original_filename}"? This cannot be undone.`)) return;
    setDeletingId(att.file_id);
    try {
      await api.delete(`/leads/${lead.id}/attachments/${att.file_id}`);
      onChanged?.({ ...lead, attachments: items.filter((a) => a.file_id !== att.file_id) });
      toast.success("Deleted");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not delete");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-2.5" data-testid="lead-attachments">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Paperclip size={14} /> Attachments {items.length ? `(${items.length})` : ""}
        </p>
        {canManage && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={upload}
              data-testid="lead-attach-input"
            />
            <Button
              type="button" size="sm" variant="outline"
              onClick={pick} disabled={uploading}
              data-testid="lead-attach-btn"
            >
              <UploadSimple size={13} className="mr-1.5" />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2" data-testid="lead-attachments-empty">
          {canManage
            ? "No attachments yet. Add PDFs or images (up to 10MB)."
            : "No attachments."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((att) => {
            const Icon = iconFor(att.content_type);
            const isImg = (att.content_type || "").startsWith("image/");
            return (
              <li
                key={att.file_id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
                data-testid={`lead-attachment-${att.file_id}`}
              >
                {isImg ? (
                  <img
                    src={authedUrl(att.url)}
                    alt={att.original_filename}
                    className="w-9 h-9 rounded object-cover border border-border shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded bg-muted flex items-center justify-center shrink-0">
                    <Icon size={18} className="text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">{att.original_filename}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {humanBytes(att.size)}
                    {att.uploaded_by_name ? ` · ${att.uploaded_by_name}` : ""}
                  </p>
                </div>
                <a
                  href={authedUrl(att.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={att.original_filename}
                  className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
                  data-testid={`lead-attachment-dl-${att.file_id}`}
                  aria-label={`Download ${att.original_filename}`}
                >
                  <DownloadSimple size={14} />
                </a>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => remove(att)}
                    disabled={deletingId === att.file_id}
                    className="h-8 w-8 rounded-md flex items-center justify-center text-rose-600 hover:bg-rose-500/10 disabled:opacity-50"
                    data-testid={`lead-attachment-del-${att.file_id}`}
                    aria-label={`Delete ${att.original_filename}`}
                  >
                    <Trash size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

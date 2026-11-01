import React, { useState } from "react";
import { createPortal } from "react-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash, X, DownloadSimple, CheckSquare } from "@phosphor-icons/react";
import { toast } from "sonner";
import { downloadClientsCsv } from "@/lib/downloadClients";

export const ClientsBulkBar = ({ selected, totalCount, onSelectAll, onClear, onDeleted }) => {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = selected.size;
  if (n === 0) return null;

  const del = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/clients/bulk-delete", { ids: [...selected] });
      toast.success(`Deleted ${data.deleted}`);
      setConfirm(false);
      onDeleted();
    } catch { toast.error("Delete failed"); } finally { setBusy(false); }
  };
  const download = async () => {
    try { await downloadClientsCsv({ ids: [...selected].join(",") }, "clients-selected.csv"); }
    catch { toast.error("Download failed"); }
  };

  return createPortal(
    <>
      <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-max flex items-center gap-2 flex-wrap justify-center bg-card border border-border shadow-xl rounded-full px-3 sm:px-4 py-2 max-w-[95vw]" data-testid="clients-bulk-bar">
        <span className="text-sm font-semibold whitespace-nowrap" data-testid="clients-bulk-count">{n} selected</span>
        {n < totalCount ? (
          <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={onSelectAll} disabled={busy} data-testid="clients-select-all-btn">
            <CheckSquare size={15} className="mr-1.5" /> Select all ({totalCount})
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={onClear} disabled={busy} data-testid="clients-clear-all-btn">Clear all</Button>
        )}
        <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={download} disabled={busy} data-testid="clients-bulk-download-btn">
          <DownloadSimple size={15} className="mr-1.5" /> Download
        </Button>
        <Button variant="destructive" size="sm" className="h-9 rounded-full" onClick={() => setConfirm(true)} disabled={busy} data-testid="clients-bulk-delete-btn">
          <Trash size={15} className="mr-1.5" /> Delete
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={onClear} disabled={busy} aria-label="Clear selection" data-testid="clients-bulk-clear-btn">
          <X size={16} />
        </Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent data-testid="clients-bulk-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {n} client{n === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the selected client{n === 1 ? "" : "s"}. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); del(); }} disabled={busy} className="bg-rose-600 hover:bg-rose-700 text-white" data-testid="clients-bulk-delete-confirm-btn">
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>,
    document.body
  );
};

export default ClientsBulkBar;

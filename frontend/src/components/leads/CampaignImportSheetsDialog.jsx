import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { GoogleLogo, ArrowClockwise, CheckCircle, WarningCircle, CopySimple } from "@phosphor-icons/react";

const FIELDS = ["name", "phone", "email", "course", "place", "source", "notes"];

function digits(s) { return String(s ?? "").replace(/\D/g, ""); }
function isValidRow(r) { return r.name?.trim() && digits(r.phone).length >= 10; }

export default function CampaignImportSheetsDialog({ open, onOpenChange, campaignId, onImported }) {
  const [status, setStatus] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [sheetId, setSheetId] = useState("");
  const [worksheets, setWorksheets] = useState([]);
  const [worksheet, setWorksheet] = useState("");
  const [rows, setRows] = useState(null); // parsed preview rows
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [keepSynced, setKeepSynced] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSheetId(""); setWorksheets([]); setWorksheet(""); setRows(null); setKeepSynced(false);
    (async () => {
      try {
        const { data } = await api.get("/google/status");
        setStatus(data);
        if (data.connected) {
          setLoading(true);
          const res = await api.get("/google/spreadsheets");
          setSheets(res.data.files || []);
        }
      } catch {
        setStatus({ connected: false });
      } finally { setLoading(false); }
    })();
  }, [open]);

  const chooseSheet = async (id) => {
    setSheetId(id); setWorksheet(""); setWorksheets([]); setRows(null);
    setLoading(true);
    try {
      const { data } = await api.get(`/google/spreadsheets/${id}/worksheets`);
      setWorksheets(data.worksheets || []);
      if ((data.worksheets || []).length === 1) setWorksheet(data.worksheets[0].title);
    } catch {
      toast.error("Could not read worksheets");
    } finally { setLoading(false); }
  };

  const fetchRows = async () => {
    if (!sheetId || !worksheet) return;
    setLoading(true); setRows(null);
    try {
      const { data } = await api.get(`/google/spreadsheets/${sheetId}/values`, { params: { sheet: worksheet } });
      const values = data.values || [];
      if (values.length < 2) { toast.error("This worksheet has no data rows"); setRows([]); return; }
      const headers = values[0].map((h) => String(h || "").trim().toLowerCase());
      const pos = {};
      FIELDS.forEach((f) => { const i = headers.indexOf(f); if (i >= 0) pos[f] = i; });
      if (pos.name === undefined) { toast.error("No 'name' column found in the header row"); setRows([]); return; }
      const parsed = values.slice(1).map((row) => {
        const o = {};
        FIELDS.forEach((f) => { o[f] = pos[f] !== undefined ? String(row[pos[f]] ?? "").trim() : ""; });
        return o;
      }).filter((o) => Object.values(o).some((v) => v));
      setRows(parsed);
    } catch {
      toast.error("Could not read the sheet values");
      setRows([]);
    } finally { setLoading(false); }
  };

  const counts = useMemo(() => {
    if (!rows) return { total: 0, valid: 0, invalid: 0 };
    const valid = rows.filter(isValidRow).length;
    return { total: rows.length, valid, invalid: rows.length - valid };
  }, [rows]);

  const doImport = async () => {
    const payload = (rows || []).filter(isValidRow);
    if (payload.length === 0) { toast.error("No valid rows to import (need name + phone)"); return; }
    setImporting(true);
    try {
      const { data } = await api.post("/google/import", { campaign_id: campaignId, rows: payload });
      const msg = `Imported ${data.created_count} lead(s)` +
        (data.duplicate_count ? ` · ${data.duplicate_count} duplicate(s) skipped` : "");
      toast.success(msg);
      if (keepSynced) {
        try {
          const sheetName = sheets.find((s) => s.id === sheetId)?.name || "";
          await api.post("/google/sync", {
            campaign_id: campaignId, spreadsheet_id: sheetId,
            spreadsheet_name: sheetName, worksheet,
          });
          toast.success("Auto-sync enabled — new rows will import automatically");
        } catch {
          toast.error("Import done, but auto-sync could not be enabled");
        }
      }
      onImported?.();
      onOpenChange(false);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Import failed");
    } finally { setImporting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-3xl" data-testid="campaign-import-sheets-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><GoogleLogo size={20} weight="bold" /> Import from Google Sheets</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Leads are added unassigned — distribute them to your team afterwards. Duplicates are skipped automatically.
          </DialogDescription>
        </DialogHeader>

        {status && !status.connected ? (
          <div className="py-6 text-center space-y-3" data-testid="sheets-not-connected">
            <WarningCircle size={32} className="mx-auto text-amber-500" />
            <p className="text-sm text-muted-foreground">Your Google account isn’t connected yet.</p>
            <p className="text-xs text-muted-foreground">Go to <span className="font-medium text-foreground">Settings → Google Sheets</span> and click “Sign in with Google”, then come back here.</p>
            <Link to="/settings" onClick={() => onOpenChange(false)} className="inline-flex text-xs font-medium text-primary hover:underline" data-testid="sheets-go-settings">Open Settings →</Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_auto] gap-3 items-end">
              <div>
                <Label className="text-xs">Spreadsheet</Label>
                <Select value={sheetId} onValueChange={chooseSheet}>
                  <SelectTrigger data-testid="sheets-spreadsheet-select" className="h-9 bg-card"><SelectValue placeholder="Choose a spreadsheet" /></SelectTrigger>
                  <SelectContent>
                    {sheets.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Worksheet</Label>
                <Select value={worksheet} onValueChange={setWorksheet} disabled={!worksheets.length}>
                  <SelectTrigger data-testid="sheets-worksheet-select" className="h-9 bg-card"><SelectValue placeholder="Tab" /></SelectTrigger>
                  <SelectContent>
                    {worksheets.map((w) => <SelectItem key={w.sheetId} value={w.title}>{w.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" onClick={fetchRows} disabled={!sheetId || !worksheet || loading} data-testid="sheets-fetch-btn" className="h-9">
                <ArrowClockwise size={15} className="mr-1.5" /> Fetch
              </Button>
            </div>

            {loading && <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>}

            {rows && rows.length > 0 && (
              <>
                <div className="flex flex-wrap gap-3 text-xs" data-testid="sheets-counts">
                  <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle size={14} weight="fill" /> {counts.valid} valid</span>
                  {counts.invalid > 0 && <span className="inline-flex items-center gap-1 text-rose-600"><WarningCircle size={14} weight="fill" /> {counts.invalid} invalid (missing name/phone)</span>}
                  <span className="text-muted-foreground">{counts.total} rows found</span>
                </div>
                <div className="max-h-[38vh] overflow-auto border border-border rounded-md" data-testid="sheets-preview-table">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">Name</th>
                        <th className="px-2 py-1.5 font-medium">Phone</th>
                        <th className="px-2 py-1.5 font-medium">Course</th>
                        <th className="px-2 py-1.5 font-medium">Place</th>
                        <th className="px-2 py-1.5 font-medium w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 300).map((r, i) => {
                        const ok = isValidRow(r);
                        return (
                          <tr key={i} className={`border-t border-border ${ok ? "" : "bg-rose-500/5"}`} data-testid={`sheets-row-${i}`}>
                            <td className="px-2 py-1.5 text-foreground truncate max-w-[180px]">{r.name || <span className="text-rose-500">—</span>}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">{r.phone || <span className="text-rose-500">—</span>}</td>
                            <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[140px]">{r.course}</td>
                            <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[120px]">{r.place}</td>
                            <td className="px-2 py-1.5">{ok ? <CheckCircle size={13} className="text-emerald-500" /> : <WarningCircle size={13} className="text-rose-500" />}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {rows && rows.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground text-center py-4">No importable rows found in this worksheet.</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {status?.connected && rows && rows.length > 0 ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none" data-testid="sheets-keep-synced-label">
              <Checkbox checked={keepSynced} onCheckedChange={(v) => setKeepSynced(!!v)} data-testid="sheets-keep-synced" />
              Keep this sheet synced to this campaign (auto-imports new rows every 6h)
            </label>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {status?.connected && (
              <Button type="button" onClick={doImport} disabled={importing || !counts.valid} data-testid="sheets-import-btn" className="btn-amber border-0">
                <CopySimple size={15} className="mr-1.5" />
                {importing ? "Importing…" : `Import ${counts.valid} lead(s)`}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Database, HardDrive, Server as ServerIcon, CheckCircle2, ShieldAlert, FolderOpen, Table2, Search, X, ChevronLeft, ChevronRight, Download, Loader2, FileJson } from "lucide-react";
import api from "@/lib/api";
import PlatformShell from "@/components/platform/PlatformShell";
import { StatCard, StatusBadge, EmptyState, LoadingState } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const fmt = (s) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export default function PlatformDatabase() {
  const [conns, setConns] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [openDb, setOpenDb] = useState(null);
  const [cols, setCols] = useState(null);

  // Document browser
  const [browse, setBrowse] = useState(null); // { db, collection }
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [docLoading, setDocLoading] = useState(false);
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [appliedField, setAppliedField] = useState("");
  const [appliedValue, setAppliedValue] = useState("");
  const [exporting, setExporting] = useState(false);
  const [docJson, setDocJson] = useState(null); // full single doc

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get("/platform/database/connections"); setConns(data.connections || []); setCounts(data.counts || {}); }
    catch { toast.error("Failed to load databases"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = async (c) => {
    setOpenDb(c.name); setCols(null);
    try { const { data } = await api.get(`/platform/database/${encodeURIComponent(c.name)}/collections`); setCols(data.collections || []); }
    catch { setCols([]); toast.error("Cannot read collections"); }
  };

  const backup = async (c) => {
    if (!window.confirm(`Record a backup checkpoint for "${c.name}"?\n\nThis logs an audited snapshot marker.`)) return;
    try { await api.post(`/platform/database/${encodeURIComponent(c.name)}/backup`); toast.success("Backup checkpoint recorded"); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const fetchDocs = useCallback(async (db, collection, p, f, v) => {
    setDocLoading(true);
    try {
      const { data } = await api.get(`/platform/database/${encodeURIComponent(db)}/collections/${encodeURIComponent(collection)}/documents`, {
        params: { page: p, limit: 25, field: f || "", value: v || "" },
      });
      setRows(data.documents || []); setColumns(data.columns || []);
      setTotal(data.total || 0); setPage(data.page || 1); setPages(data.pages || 1);
    } catch (e) {
      setRows([]); setColumns([]); setTotal(0); setPages(1);
      toast.error(e?.response?.data?.detail || "Cannot read documents");
    } finally { setDocLoading(false); }
  }, []);

  const openBrowser = (db, collection) => {
    setBrowse({ db, collection }); setRows([]); setColumns([]); setPage(1);
    setField(""); setValue(""); setAppliedField(""); setAppliedValue("");
    fetchDocs(db, collection, 1, "", "");
  };

  const runSearch = () => {
    if (field.trim() && !value.trim()) { toast.error("Enter a value to search"); return; }
    setAppliedField(field.trim()); setAppliedValue(value.trim());
    fetchDocs(browse.db, browse.collection, 1, field.trim(), value.trim());
  };
  const clearSearch = () => {
    setField(""); setValue(""); setAppliedField(""); setAppliedValue("");
    fetchDocs(browse.db, browse.collection, 1, "", "");
  };
  const goPage = (p) => { if (p < 1 || p > pages) return; fetchDocs(browse.db, browse.collection, p, appliedField, appliedValue); };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/platform/database/${encodeURIComponent(browse.db)}/collections/${encodeURIComponent(browse.collection)}/export`, {
        params: { field: appliedField || "", value: appliedValue || "" },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url; a.download = `${browse.collection}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (e) { toast.error("Export failed"); } finally { setExporting(false); }
  };

  return (
    <PlatformShell module={MODULE_BY_KEY.database} title="Database">
      <div className="space-y-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Database} label="Connections" value={counts.total || 0} tint="bg-emerald-500/10 text-emerald-600" />
          <StatCard icon={ServerIcon} label="Production" value={counts.production || 0} tint="bg-rose-500/10 text-rose-600" />
          <StatCard icon={HardDrive} label="Staging" value={counts.staging || 0} tint="bg-amber-500/10 text-amber-600" />
          <StatCard icon={CheckCircle2} label="Online" value={counts.online || 0} tint="bg-sky-500/10 text-sky-600" />
        </div>

        <div>
          <h2 className="font-display text-xl font-semibold">Connections</h2>
          <p className="text-sm text-muted-foreground">Live MongoDB stats for the platform and each client workspace. Browsing is strictly read-only. Credentials are never exposed.</p>
        </div>

        {loading ? <LoadingState /> : conns.length === 0 ? (
          <EmptyState icon={Database} title="No databases" desc="No database connections detected." />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto" data-testid="db-connections">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Database</TableHead><TableHead className="hidden md:table-cell">Client</TableHead>
                <TableHead className="hidden lg:table-cell">Environment</TableHead><TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Collections</TableHead><TableHead className="hidden lg:table-cell">Size</TableHead>
                <TableHead className="hidden lg:table-cell">Last backup</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {conns.map((c) => (
                  <TableRow key={c.name} data-testid={`db-row`}>
                    <TableCell><div className="flex items-center gap-2"><Database size={16} className="text-muted-foreground" /><span className="font-mono text-xs truncate max-w-[200px]">{c.name}</span></div></TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{c.client}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm capitalize text-muted-foreground">{c.environment}</TableCell>
                    <TableCell><StatusBadge status={c.status} /></TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{c.collections}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{c.size_mb} MB</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{fmt(c.last_backup)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => view(c)} className="h-8" data-testid="db-view"><FolderOpen size={14} className="mr-1" /> View</Button>
                        <Button size="sm" variant="ghost" onClick={() => backup(c)} className="h-8 text-amber-600" data-testid="db-backup"><ShieldAlert size={14} className="mr-1" /> Backup</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Collections list */}
      <Dialog open={!!openDb} onOpenChange={(o) => !o && setOpenDb(null)}>
        <DialogContent data-testid="db-collections-dialog">
          <DialogHeader><DialogTitle className="font-mono text-sm break-all">{openDb}</DialogTitle></DialogHeader>
          {cols === null ? <LoadingState /> : cols.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No collections.</p> : (
            <div className="max-h-[50vh] overflow-y-auto space-y-1">
              {cols.map((c) => (
                <button key={c.name} onClick={() => openBrowser(openDb, c.name)} data-testid="collection-row"
                  className="w-full flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:border-primary/60 hover:bg-primary/5 transition-colors group">
                  <span className="flex items-center gap-2 font-mono"><Table2 size={14} className="text-muted-foreground group-hover:text-primary" />{c.name}</span>
                  <span className="text-muted-foreground text-xs">{c.documents.toLocaleString()} docs</span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Document browser */}
      <Dialog open={!!browse} onOpenChange={(o) => !o && setBrowse(null)}>
        <DialogContent className="max-w-6xl" data-testid="db-browser-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm break-all"><Table2 size={16} /> {browse?.db} · {browse?.collection}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-[280px]">
              <Input value={field} onChange={(e) => setField(e.target.value)} placeholder="Field (e.g. email)" className="h-9 max-w-[180px]" data-testid="search-field" onKeyDown={(e) => e.key === "Enter" && runSearch()} />
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value contains…" className="h-9 flex-1" data-testid="search-value" onKeyDown={(e) => e.key === "Enter" && runSearch()} />
              <Button size="sm" onClick={runSearch} className="h-9 bg-primary text-primary-foreground border-0" data-testid="search-run"><Search size={14} className="mr-1" /> Search</Button>
              {(appliedField || appliedValue) && <Button size="sm" variant="ghost" onClick={clearSearch} className="h-9" data-testid="search-clear"><X size={14} className="mr-1" /> Clear</Button>}
            </div>
            <Button size="sm" variant="outline" onClick={exportXlsx} disabled={exporting} className="h-9" data-testid="export-xlsx">
              {exporting ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Download size={14} className="mr-1" />} Export .xlsx
            </Button>
          </div>

          {docLoading ? <LoadingState /> : rows.length === 0 ? (
            <EmptyState icon={Table2} title="No documents" desc={appliedField ? "No documents match your search." : "This collection is empty."} />
          ) : (
            <div className="rounded-xl border border-border overflow-auto max-h-[52vh]" data-testid="db-documents-table">
              <Table>
                <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">
                  {columns.map((col) => <TableHead key={col} className="font-mono text-xs whitespace-nowrap">{col}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={r._id || i} className="cursor-pointer" data-testid="document-row" onClick={() => setDocJson(r)}>
                      {columns.map((col) => (
                        <TableCell key={col} className="text-xs max-w-[240px] truncate font-mono" title={cellText(r[col])}>{cellText(r[col])}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground" data-testid="doc-count">{total.toLocaleString()} document{total === 1 ? "" : "s"}{(appliedField || appliedValue) ? " (filtered)" : ""}</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-8" disabled={page <= 1 || docLoading} onClick={() => goPage(page - 1)} data-testid="page-prev"><ChevronLeft size={16} /></Button>
              <span className="text-xs text-muted-foreground" data-testid="page-indicator">Page {page} of {pages}</span>
              <Button size="sm" variant="ghost" className="h-8" disabled={page >= pages || docLoading} onClick={() => goPage(page + 1)} data-testid="page-next"><ChevronRight size={16} /></Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Single document JSON */}
      <Dialog open={!!docJson} onOpenChange={(o) => !o && setDocJson(null)}>
        <DialogContent className="max-w-2xl" data-testid="db-doc-json-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileJson size={16} /> Document</DialogTitle></DialogHeader>
          <pre className="rounded-lg bg-slate-950 text-slate-100 font-mono text-xs p-4 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words" data-testid="doc-json">{docJson ? JSON.stringify(docJson, null, 2) : ""}</pre>
        </DialogContent>
      </Dialog>
    </PlatformShell>
  );
}

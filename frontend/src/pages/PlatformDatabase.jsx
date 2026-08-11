import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Database, HardDrive, Server as ServerIcon, CheckCircle2, ShieldAlert, FolderOpen } from "lucide-react";
import api from "@/lib/api";
import PlatformShell from "@/components/platform/PlatformShell";
import { StatCard, StatusBadge, EmptyState, LoadingState } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const fmt = (s) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

export default function PlatformDatabase() {
  const [conns, setConns] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [openDb, setOpenDb] = useState(null);
  const [cols, setCols] = useState(null);

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
          <p className="text-sm text-muted-foreground">Live MongoDB stats for the platform and each client workspace. Credentials are never exposed.</p>
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

      <Dialog open={!!openDb} onOpenChange={(o) => !o && setOpenDb(null)}>
        <DialogContent data-testid="db-collections-dialog">
          <DialogHeader><DialogTitle className="font-mono text-sm break-all">{openDb}</DialogTitle></DialogHeader>
          {cols === null ? <LoadingState /> : cols.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No collections.</p> : (
            <div className="max-h-[50vh] overflow-y-auto space-y-1">
              {cols.map((c) => (
                <div key={c.name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="font-mono">{c.name}</span>
                  <span className="text-muted-foreground text-xs">{c.documents.toLocaleString()} docs</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PlatformShell>
  );
}

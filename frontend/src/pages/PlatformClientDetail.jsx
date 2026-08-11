import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Users, Boxes, Activity as ActivityIcon, LifeBuoy, ShieldCheck, CreditCard, Database, Settings2 } from "lucide-react";
import api from "@/lib/api";
import PlatformShell from "@/components/platform/PlatformShell";
import { StatCard, StatusBadge, EmptyState, LoadingState, Avatar } from "@/components/platform/PlatformKit";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const fmt = (s) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default function PlatformClientDetail() {
  const { clientId } = useParams();
  const nav = useNavigate();
  const [client, setClient] = useState(null);
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, u, tk, a] = await Promise.all([
        api.get(`/platform/tenants/${clientId}`),
        api.get(`/platform/tenants/${clientId}/users`).catch(() => ({ data: { users: [] } })),
        api.get(`/platform/connect/tickets`).catch(() => ({ data: { tickets: [] } })),
        api.get(`/platform/audit`).catch(() => ({ data: { entries: [] } })),
      ]);
      setClient(c.data);
      setUsers(u.data.users || []);
      setTickets((tk.data.tickets || []).filter((t) => t.client_id === clientId));
      setAudit((a.data.entries || []).filter((e) => e?.meta?.tenant_id === clientId));
    } catch { /* */ } finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <PlatformShell module={MODULE_BY_KEY.clients} title="Client"><LoadingState /></PlatformShell>;
  if (!client) return <PlatformShell module={MODULE_BY_KEY.clients} title="Client"><EmptyState title="Client not found" /></PlatformShell>;

  const b = client.branding || {};

  return (
    <PlatformShell module={MODULE_BY_KEY.clients} title="Client detail">
      <button onClick={() => nav("/platform/clients")} data-testid="back-to-clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5">
        <ArrowLeft size={15} /> All clients
      </button>

      <div className="flex items-start gap-4 mb-8">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-display font-bold text-xl overflow-hidden shrink-0"
             style={{ background: b.logo_url ? "#fff" : b.brand_color || "#C70000" }}>
          {b.logo_url ? <img src={b.logo_url} alt={client.name} className="w-full h-full object-contain p-1.5" /> : (client.name || "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-2xl font-bold tracking-tight">{client.name}</h2>
          <p className="text-sm text-muted-foreground">{client.admin_email}</p>
          <div className="flex items-center gap-2 mt-2">
            <StatusBadge status={client.status} />
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{client.plan || "trial"} plan</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="tickets" data-testid="tab-tickets">Support Tickets</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Users} label="Users" value={client.stats?.users ?? 0} tint="bg-rose-500/10 text-rose-600" />
            <StatCard icon={Boxes} label="Students" value={client.stats?.students ?? 0} tint="bg-violet-500/10 text-violet-600" />
            <StatCard icon={ActivityIcon} label="Leads" value={client.stats?.leads ?? 0} tint="bg-emerald-500/10 text-emerald-600" />
            <StatCard icon={LifeBuoy} label="Tickets" value={tickets.length} tint="bg-amber-500/10 text-amber-600" />
          </div>
          <div className="mt-6 rounded-xl border border-border bg-card p-5 space-y-3 text-sm">
            <p className="font-display font-semibold text-base">Workspace</p>
            <div className="grid sm:grid-cols-2 gap-y-2 gap-x-6">
              <Row k="App name" v={b.app_name || client.name} />
              <Row k="Plan" v={<span className="capitalize">{client.plan || "trial"}</span>} />
              <Row k="Modules enabled" v={client.enabled_modules?.length ?? 0} />
              <Row k="Created" v={fmt(client.created_at)} />
              <Row k="Brand color" v={<span className="inline-flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full border" style={{ background: b.brand_color }} />{b.brand_color}</span>} />
              <Row k="Default tenant" v={client.is_default ? "Yes" : "No"} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="users" className="pt-6">
          {users.length === 0 ? <EmptyState icon={Users} title="No users" desc="This workspace has no users yet." /> : (
            <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40"><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead className="hidden sm:table-cell">Office</TableHead></TableRow></TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell><div className="flex items-center gap-3"><Avatar name={u.name} size={32} /><div><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email}</p></div></div></TableCell>
                      <TableCell className="text-sm capitalize">{(u.role || "").replace("_", " ")}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{u.office || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tickets" className="pt-6">
          {tickets.length === 0 ? <EmptyState icon={LifeBuoy} title="No tickets" desc="No support tickets for this client." /> : (
            <div className="space-y-2">
              {tickets.map((t) => (
                <button key={t.id} onClick={() => nav(`/platform/connect/${t.id}`)} className="w-full text-left rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3 hover:border-primary/40 transition-colors">
                  <div className="min-w-0"><p className="font-medium truncate">{t.subject}</p><p className="text-xs text-muted-foreground">{t.ticket_no} · {t.category}</p></div>
                  <StatusBadge status={t.status} />
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity" className="pt-6">
          {audit.length === 0 ? <EmptyState icon={ActivityIcon} title="No activity" desc="No audited actions recorded for this client yet." /> : (
            <div className="space-y-2">
              {audit.map((e) => (
                <div key={e.id} className="rounded-lg border border-border bg-card p-3 flex items-center justify-between text-sm">
                  <div><span className="font-medium">{e.user_name}</span> <span className="text-muted-foreground">· {e.action}</span></div>
                  <span className="text-xs text-muted-foreground">{fmt(e.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {["applications", "database", "subscription", "security"].map((k) => (
          <TabsContent key={k} value={k} className="pt-6">
            <EmptyState icon={{ applications: Boxes, database: Database, subscription: CreditCard, security: ShieldCheck }[k]}
              title={`${k[0].toUpperCase()}${k.slice(1)}`}
              desc="Detailed data appears here once the related module is fully built." />
          </TabsContent>
        ))}
      </Tabs>
    </PlatformShell>
  );
}

function Row({ k, v }) {
  return <div className="flex justify-between sm:block"><span className="text-muted-foreground">{k}</span><span className="font-medium sm:block">{v}</span></div>;
}

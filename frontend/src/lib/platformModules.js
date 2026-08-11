import { Users, AppWindow, Database, Server, LifeBuoy, Settings } from "lucide-react";

// Central module registry for the Platform Console. Adding a future module is
// a one-line change here — nothing hardcodes a single application.
export const PLATFORM_MODULES = [
  {
    key: "clients", label: "Clients", path: "/platform/clients",
    desc: "Manage companies and customer workspaces",
    icon: Users, perm: "client.view", countKey: "companies",
    accent: "text-rose-600 bg-rose-500/10 dark:text-rose-400",
    ring: "group-hover:border-rose-500/40",
    subnav: ["All Clients", "Active", "Trial", "Suspended"],
  },
  {
    key: "my-apps", label: "My Apps", path: "/platform/my-apps",
    desc: "Manage all SaaS applications",
    icon: AppWindow, perm: "app.view",
    accent: "text-violet-600 bg-violet-500/10 dark:text-violet-400",
    ring: "group-hover:border-violet-500/40",
    subnav: ["All Apps", "EduConnect Pro", "Other Apps"],
  },
  {
    key: "database", label: "Database", path: "/platform/database",
    desc: "Manage database connections and collections",
    icon: Database, perm: "database.view",
    accent: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
    ring: "group-hover:border-emerald-500/40",
    subnav: ["Connections", "Collections", "Queries", "Backups"],
  },
  {
    key: "vps-server", label: "VPS Server", path: "/platform/vps-server",
    desc: "Monitor and control infrastructure",
    icon: Server, perm: "server.view",
    accent: "text-sky-600 bg-sky-500/10 dark:text-sky-400",
    ring: "group-hover:border-sky-500/40",
    subnav: ["Servers", "Docker", "Containers", "Logs", "Monitoring"],
  },
  {
    key: "connect", label: "Connect", path: "/platform/connect",
    desc: "Client support and complaint management",
    icon: LifeBuoy, perm: "ticket.view",
    accent: "text-amber-600 bg-amber-500/10 dark:text-amber-400",
    ring: "group-hover:border-amber-500/40",
    subnav: ["All Tickets", "Open", "In Progress", "Waiting", "Resolved"],
  },
  {
    key: "settings", label: "Settings", path: "/platform/settings",
    desc: "Platform administration and access control",
    icon: Settings, perm: "settings.view",
    accent: "text-slate-600 bg-slate-500/10 dark:text-slate-300",
    ring: "group-hover:border-slate-400/40",
    subnav: ["Platform", "Users & Access", "Clients", "Applications", "Infrastructure", "Security"],
  },
];

export const MODULE_BY_KEY = Object.fromEntries(PLATFORM_MODULES.map((m) => [m.key, m]));

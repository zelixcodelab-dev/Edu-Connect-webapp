import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useBranding } from "@/lib/branding";
import BrandMark from "@/components/BrandMark";
import { canView } from "@/lib/perm";
import { buildApplyUrl } from "@/lib/applyUrl";
import { photoSrc } from "@/pages/Clients";
import NotificationsBell from "@/components/NotificationsBell";
import BottomNav from "@/components/BottomNav";
import InstallPrompt from "@/components/InstallPrompt";
import {
  House, Receipt, Wallet, FileText, UsersThree, Tag, Gear, SignOut, PlusCircle,
  Student, Notebook, Sun, Moon, List as ListIcon, MagnifyingGlass,
  ShieldCheck, ReceiptX, Buildings, Coins, ChatCircleDots, ArrowUpRight,
  Target, IdentificationBadge, CalendarCheck, Handshake, UserCircle, CaretRight, FolderSimplePlus,
  ClockCounterClockwise, Palette,
} from "@phosphor-icons/react";

// Sidebar nav with role gating.
//   roles: array of roles that can see this item. Omitting `roles` means all.
//   perm: page-permission key — when present, item is hidden if canView(user, perm) is false.
//   userRoleAllowed: explicit allow-list flag for the lightweight "user" role.
//     Omit (or set falsy) to hide the item from "user" role accounts.
const ALL_NAV = [
  { to: "/", label: "Overview", icon: House, end: true, tid: "nav-overview", perm: "overview", module: "overview", userRoleAllowed: true },
  { to: "/quick-entry", label: "Quick entry", icon: PlusCircle, tid: "nav-quick-entry", perm: "quick_entry", module: "quick_entry", userRoleAllowed: true },
  { to: "/transactions", label: "Transactions", icon: Receipt, tid: "nav-transactions", perm: "transactions", module: "transactions", userRoleAllowed: true },
  { to: "/accounts", label: "Accounts", icon: Wallet, tid: "nav-accounts", perm: "accounts", module: "accounts", userRoleAllowed: true },
  { to: "/my-ledger", label: "My ledger", icon: Coins, tid: "nav-my-ledger", roles: ["user"], userRoleAllowed: true },
  { to: "/messages", label: "Messages", icon: ChatCircleDots, tid: "nav-messages", module: "messages", userRoleAllowed: true },
  { to: "/invoices", label: "Invoices", icon: FileText, tid: "nav-invoices", roles: ["super_admin"], module: "invoices" },
  { to: "/employees", label: "Employees", icon: UsersThree, tid: "nav-employees", roles: ["super_admin"], perm: "clients", module: "clients" },
  { to: "/clients", label: "Clients", icon: Handshake, tid: "nav-clients", roles: ["super_admin"], perm: "clients", module: "clients" },
  { to: "/employees", label: "Staff", icon: IdentificationBadge, tid: "nav-office-staff", roles: ["office_admin"], perm: "clients", module: "clients" },
  { to: "/students", label: "Students", icon: Student, tid: "nav-students", perm: "students", module: "students" },
  { to: "/my-students", label: "Students", icon: Student, tid: "nav-my-students", roles: ["staff"], module: "students" },
  { to: "/leads", label: "CRM", icon: Target, tid: "nav-leads", roles: ["super_admin", "office_admin", "staff"], perm: "leads", module: "leads", userRoleAllowed: false },
  { to: "/office-overview", label: "Overview", icon: House, tid: "nav-office-overview", roles: ["super_admin"], module: "office_overview" },
  { to: "/staff", label: "Staff", icon: IdentificationBadge, tid: "nav-staff", roles: ["super_admin"], module: "staff" },
  { to: "/leave", label: "Leave", icon: CalendarCheck, tid: "nav-leave", roles: ["super_admin", "office_admin", "staff"], perm: "leave", module: "leave" },
  { to: "/colleges", label: "Colleges", icon: Buildings, tid: "nav-colleges", roles: ["super_admin"], module: "colleges" },
  { to: "/admission-revenue", label: "Admission Revenue", icon: Coins, tid: "nav-admission-revenue", roles: ["super_admin"], module: "admission_revenue" },
  { to: "/agents", label: "Ledger", icon: Notebook, tid: "nav-ledger", roles: ["super_admin"], module: "agents" },
  { to: "/expense-requests", label: "Approvals", icon: ReceiptX, tid: "nav-approvals", roles: ["super_admin"], module: "expense_requests" },
  { to: "/expense-requests", label: "Office expenses", icon: ReceiptX, tid: "nav-office-expenses", roles: ["office_admin"], perm: "expense_requests", module: "expense_requests" },
  { to: "/expense-requests", label: "Expense requests", icon: ReceiptX, tid: "nav-user-expenses", roles: ["user"], userRoleAllowed: true, perm: "expense_requests", module: "expense_requests" },
  { to: "/users", label: "Team", icon: ShieldCheck, tid: "nav-users", roles: ["super_admin"], module: "users" },
  { to: "/branding", label: "Customize", icon: Palette, tid: "nav-branding", roles: ["super_admin"] },
  { to: "/activity", label: "Activity", icon: ClockCounterClockwise, tid: "nav-activity", roles: ["super_admin", "office_admin"], module: "activity" },
  { to: "/categories", label: "Categories", icon: Tag, tid: "nav-categories", roles: ["super_admin"], module: "categories" },
  { to: "/settings", label: "Settings", icon: Gear, tid: "nav-settings", perm: "settings", module: "settings", userRoleAllowed: true },
];

// path → module key, for blocking direct URL access to a disabled module.
const PATH_MODULE = {
  "/quick-entry": "quick_entry",
  "/transactions": "transactions",
  "/accounts": "accounts",
  "/messages": "messages",
  "/invoices": "invoices",
  "/employees": "clients",
  "/clients": "clients",
  "/students": "students",
  "/my-students": "students",
  "/leads": "leads",
  "/office-overview": "office_overview",
  "/staff": "staff",
  "/leave": "leave",
  "/colleges": "colleges",
  "/admission-revenue": "admission_revenue",
  "/agents": "agents",
  "/expense-requests": "expense_requests",
  "/activity": "activity",
  "/categories": "categories",
};

const PAGE_TITLES = {
  "/": "Overview",
  "/quick-entry": "Quick entry",
  "/transactions": "Transactions",
  "/accounts": "Accounts",
  "/my-ledger": "My ledger",
  "/messages": "Messages",
  "/invoices": "Invoices",
  "/clients": "Clients",
  "/employees": "Employees",
  "/students": "Students",
  "/my-students": "Students",
  "/leads": "CRM",
  "/office-overview": "Office overview",
  "/staff": "Staff",
  "/leave": "Leave",
  "/colleges": "Colleges",
  "/admission-revenue": "Admission Revenue",
  "/agents": "Sub-agent Ledger",
  "/categories": "Categories",
  "/settings": "Settings",
  "/users": "Team & approvals",
  "/branding": "Customize",
  "/activity": "Activity",
  "/expense-requests": "Expense requests",
};

function initialsOf(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

// Super Admin gets a grouped sidebar with collapsible sections (Accounts /
// Office / Add details). Every other role keeps a single flat list.
const GROUP_ROUTES = {
  accounts: ["/accounts", "/transactions", "/agents", "/invoices"],
  office: ["/office-overview", "/employees", "/leads", "/staff", "/leave"],
  details: ["/colleges", "/categories"],
};

function buildSections(navItems, role) {
  const byTo = {};
  navItems.forEach((i) => { byTo[i.to] = i; });
  const pick = (tos) => tos.map((t) => byTo[t]).filter(Boolean);
  if (role !== "super_admin") {
    return [{ type: "items", label: "Workspace", items: navItems }];
  }
  return [
    { type: "items", label: "Workspace", items: pick(["/", "/quick-entry", "/admission-revenue"]) },
    { type: "group", key: "accounts", label: "Accounts", icon: Wallet, items: pick(GROUP_ROUTES.accounts) },
    { type: "items", items: pick(["/messages", "/clients", "/students"]) },
    { type: "group", key: "office", label: "Office", icon: Buildings, items: pick(GROUP_ROUTES.office) },
    { type: "group", key: "details", label: "Add details", icon: FolderSimplePlus, items: pick(GROUP_ROUTES.details) },
    { type: "items", items: pick(["/users", "/expense-requests", "/activity", "/settings"]) },
  ].filter((s) => s.items.length > 0);
}

function SidebarContent({ onItemClick, user, onLogout }) {
  const role = user?.role;
  const { branding } = useBranding();
  const enabled = user?.enabled_modules;
  // Groups start COLLAPSED — click the header to expand. The group that
  // contains the current page opens automatically so the active link is
  // never hidden.
  const [collapsed, setCollapsed] = React.useState(() => {
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    const init = {};
    for (const [key, routes] of Object.entries(GROUP_ROUTES)) {
      init[key] = !routes.some((t) => path === t || path.startsWith(`${t}/`));
    }
    return init;
  });
  const navItems = ALL_NAV.filter((i) => {
    if (i.roles && !i.roles.includes(role)) return false;
    if (i.perm && !canView(user, i.perm)) return false;
    if (i.module && Array.isArray(enabled) && !enabled.includes(i.module)) return false;
    return true;
  }).map((i) => {
    if (role !== "staff") return i;
    if (i.to === "/settings") return { ...i, label: "Profile", icon: UserCircle };
    if (i.to === "/leads") return { ...i, label: "My Leads" };
    return i;
  });

  const linkClass = (indent) => ({ isActive }) =>
    `flex items-center gap-3 ${indent ? "pl-11 pr-4" : "px-4"} py-2.5 rounded-lg text-sm transition-all ${
      isActive
        ? "bg-amber-gradient text-white font-medium shadow-md shadow-orange-500/25"
        : "text-[hsl(var(--sidebar-fg))] hover:bg-orange-500/10 hover:text-orange-600 dark:hover:text-orange-400"
    }`;

  const renderLink = (item, indent) => (
    <NavLink key={item.to} to={item.to} end={item.end} data-testid={item.tid} onClick={onItemClick} className={linkClass(indent)}>
      <item.icon size={18} weight="regular" />
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <>
      {/* Brand */}
      <div className="px-6 py-5 flex items-center gap-3 border-b border-[hsl(var(--sidebar-border))]">
        <BrandMark size={44} className="shadow-sm" />
        <div className="flex flex-col min-w-0">
          <span className="font-display text-base font-semibold tracking-tight text-[hsl(var(--sidebar-fg))] truncate">{branding?.app_name || "Edu Connect"}</span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--sidebar-muted))] truncate">{branding?.company_line || ""}</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="px-3 py-6 flex-1 space-y-0.5 overflow-y-auto" data-testid="sidebar-nav">
        {buildSections(navItems, role).map((section, idx) => {
          if (section.type === "group") {
            const open = !collapsed[section.key];
            return (
              <div key={section.key} className="pt-2">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [section.key]: !c[section.key] }))}
                  data-testid={`nav-group-${section.key}`}
                  aria-expanded={open}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-[hsl(var(--sidebar-fg))] hover:bg-orange-500/10 transition-all"
                >
                  <CaretRight size={13} weight="bold" className={`shrink-0 text-[hsl(var(--sidebar-muted))] transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
                  <section.icon size={17} weight="regular" className="shrink-0" />
                  <span className="flex-1 text-left">{section.label}</span>
                </button>
                {open && (
                  <div className="mt-0.5 space-y-0.5">
                    {section.items.map((item) => renderLink(item, true))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={`sec-${idx}`} className={idx > 0 ? "pt-3" : ""}>
              {section.label ? (
                <p className="px-3 mb-2 text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--sidebar-muted))] font-semibold">{section.label}</p>
              ) : (
                <div className="mx-3 mb-2.5 border-t border-[hsl(var(--sidebar-border))]/60" aria-hidden />
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => renderLink(item, false))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer: user info + sign out (mobile drawer only — hidden on desktop where topbar handles it) */}
      {onLogout && (
        <div className="md:hidden border-t border-[hsl(var(--sidebar-border))] p-3 space-y-2 shrink-0">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="w-9 h-9 rounded-full bg-amber-gradient text-white text-xs font-semibold flex items-center justify-center shrink-0 overflow-hidden">
              {user?.photo_url ? (
                <img
                  src={photoSrc(user.photo_url)}
                  alt={user?.name || "profile"}
                  className="w-full h-full object-cover"
                />
              ) : (
                initialsOf(user?.name).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[hsl(var(--sidebar-fg))] truncate" data-testid="drawer-user-name">{user?.name}</p>
              <p className="text-[10px] uppercase tracking-wider text-[hsl(var(--sidebar-muted))] truncate">{user?.role?.replace("_", " ")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            data-testid="drawer-logout-btn"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-sm font-medium transition-colors"
          >
            <SignOut size={16} weight="bold" />
            Sign out
          </button>
        </div>
      )}
    </>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className="relative w-10 h-10 rounded-full bg-muted/60 hover:bg-muted text-foreground flex items-center justify-center transition-colors"
    >
      {theme === "dark" ? <Sun size={18} weight="fill" className="text-amber-400" /> : <Moon size={18} weight="fill" className="text-orange-600" />}
    </button>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const nav = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const pageTitle = (user?.role === "staff" && location.pathname === "/settings" ? "Profile" : null)
    || (user?.role === "staff" && location.pathname === "/leads" ? "My Leads" : null)
    || PAGE_TITLES[location.pathname]
    || (location.pathname.startsWith("/students/") ? "Student" : "")
    || (location.pathname.startsWith("/agents/") ? "Agent detail" : "")
    || (branding?.app_name || "Edu Connect");

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    nav("/login");
  };

  // Block direct URL access to a module the company has switched off.
  const disabledModule = useMemo(() => {
    const mod = PATH_MODULE[location.pathname];
    const enabled = user?.enabled_modules;
    return mod && Array.isArray(enabled) && !enabled.includes(mod);
  }, [location.pathname, user]);
  if (disabledModule) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex">
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex w-64 shrink-0 flex-col border-r bg-[hsl(var(--sidebar-bg))] border-[hsl(var(--sidebar-border))] sticky top-0 h-screen"
        data-testid="desktop-sidebar"
      >
        <SidebarContent user={user} />
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            data-testid="mobile-drawer-overlay"
          />
          <aside
            className="md:hidden fixed top-0 left-0 z-50 w-72 h-full bg-[hsl(var(--sidebar-bg))] border-r border-[hsl(var(--sidebar-border))] flex flex-col animate-fade-in"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            data-testid="mobile-drawer"
          >
            <SidebarContent user={user} onItemClick={() => setMobileOpen(false)} onLogout={handleLogout} />
          </aside>
        </>
      )}

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header
          className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b border-border"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
          data-testid="topbar"
        >
          <div className="h-16 px-4 md:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              data-testid="mobile-menu-btn"
              className="md:hidden w-10 h-10 rounded-lg bg-muted text-foreground flex items-center justify-center hover:bg-muted/80"
            >
              <ListIcon size={20} />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">Workspace</p>
              <h2 className="font-display text-base md:text-lg font-semibold tracking-tight truncate" data-testid="topbar-page-title">{pageTitle}</h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
            <div className="hidden lg:flex relative w-64 xl:w-80">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search…"
                className="w-full h-10 pl-10 pr-3 rounded-full bg-muted/60 border border-transparent focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm transition-all"
                data-testid="topbar-search"
              />
            </div>
            {user?.role === "super_admin" && !!process.env.REACT_APP_APPLY_PUBLIC_URL && (
              <a
                href={buildApplyUrl()}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="topbar-open-public-form"
                title="Open the public admission form in a new tab"
                className="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-muted/60 hover:bg-amber-gradient-soft hover:text-amber-700 dark:hover:text-amber-300 text-xs font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-orange-500/30 transition-colors"
              >
                <span>Public form</span>
                <ArrowUpRight size={12} weight="bold" />
              </a>
            )}
            <NotificationsBell />
            <ThemeToggle />
            <div className="flex items-center gap-2 sm:gap-2.5 pl-2 sm:pl-3 ml-0.5 sm:ml-1 border-l border-border h-8">
              <div className="w-8 h-8 rounded-full bg-amber-gradient text-white text-xs font-semibold flex items-center justify-center shrink-0 overflow-hidden" data-testid="topbar-avatar">
                {user?.photo_url ? (
                  <img
                    src={photoSrc(user.photo_url)}
                    alt={user?.name || "profile"}
                    className="w-full h-full object-cover"
                    data-testid="topbar-avatar-img"
                  />
                ) : (
                  initialsOf(user?.name).toUpperCase()
                )}
              </div>
              <div className="hidden lg:block min-w-0">
                <p className="text-xs font-medium leading-tight truncate max-w-[140px]" data-testid="topbar-user-name">{user?.name}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{user?.business_name || user?.currency || "USD"}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                data-testid="logout-btn"
                title="Sign out"
                className="ml-0.5 sm:ml-1 w-9 h-9 rounded-full bg-muted/60 hover:bg-rose-500/15 text-foreground hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition-colors"
              >
                <SignOut size={16} />
              </button>
            </div>
          </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-10 py-6 sm:py-8 pb-28 md:pb-12 max-w-[1500px] w-full mx-auto">
          <Outlet />
        </div>
      </main>
      <BottomNav />
      <InstallPrompt />
    </div>
  );
}

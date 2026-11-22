import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import api from "@/lib/api";
import { setBadgePart } from "@/lib/appBadge";
import { useTheme } from "@/lib/theme";
import { useBranding } from "@/lib/branding";
import BrandMark from "@/components/BrandMark";
import { canView, hasModule } from "@/lib/perm";
import { buildApplyUrl } from "@/lib/applyUrl";
import AuthedImage, { useAuthedObjectUrl } from "@/components/AuthedImage";
import NotificationsBell from "@/components/NotificationsBell";
import AcademicYearSelect from "@/components/AcademicYearSelect";
import BottomNav from "@/components/BottomNav";
import ProductTour, { START_TOUR_EVENT } from "@/components/ProductTour";
import TrialBanner from "@/components/TrialBanner";
import InstallPrompt from "@/components/InstallPrompt";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  House, Receipt, Wallet, FileText, UsersThree, Tag, Gear, SignOut, PlusCircle,
  Student, Notebook, Sun, Moon, List as ListIcon, MagnifyingGlass,
  ShieldCheck, ReceiptX, Buildings, Coins, ChatCircleDots, ArrowUpRight,
  Target, IdentificationBadge, Handshake, UserCircle, CaretRight, CaretDown, FolderSimplePlus,
  ClockCounterClockwise, Clock, ChartBar, Palette, Compass, CaretLeft, CaretUp, CalendarBlank, PushPin, SquaresFour, CaretDoubleLeft,
} from "@phosphor-icons/react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

// Sidebar nav with role gating.
//   roles: array of roles that can see this item. Omitting `roles` means all.
//   perm: page-permission key — when present, item is hidden if canView(user, perm) is false.
//   userRoleAllowed: explicit allow-list flag for the lightweight "user" role.
//     Omit (or set falsy) to hide the item from "user" role accounts.
const ALL_NAV = [
  { to: "/", label: "Overview", icon: House, end: true, tid: "nav-overview", perm: "overview", module: "overview", userRoleAllowed: true },
  { to: "/dashboard", label: "Dashboard", icon: ChartBar, tid: "nav-dashboard", roles: ["super_admin", "office_admin"], perm: "overview", module: "overview" },
  { to: "/quick-entry", label: "Quick entry", icon: PlusCircle, tid: "nav-quick-entry", perm: "quick_entry", module: "quick_entry", userRoleAllowed: true, mobileOnly: true },
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
  { to: "/attendance", label: "Attendance", icon: Clock, tid: "nav-attendance", roles: ["super_admin", "office_admin", "staff"], perm: "attendance", module: "attendance" },
  { to: "/colleges", label: "Colleges", icon: Buildings, tid: "nav-colleges", roles: ["super_admin"], module: "colleges" },
  { to: "/admission-revenue", label: "Admission Revenue", icon: Coins, tid: "nav-admission-revenue", roles: ["super_admin"], module: "admission_revenue" },
  { to: "/sc-report", label: "SC Report", icon: ChartBar, tid: "nav-sc-report", roles: ["office_admin"], module: "sc_report" },
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
  "/attendance": "attendance",
  "/sc-report": "sc_report",
};

const PAGE_TITLES = {
  "/": "Overview",
  "/dashboard": "Dashboard",
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
  "/leave": "Leave",
  "/attendance": "Attendance & Payroll",
  "/colleges": "Colleges",
  "/admission-revenue": "Admission Revenue",
  "/sc-report": "SC Report",
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
export const GROUP_META = {
  accounts: { label: "Accounts", blurb: "Balances, money flow, sub-agent ledgers and invoices" },
  office: { label: "Office", blurb: "Your offices, people, leads, attendance and approvals" },
  details: { label: "Add details", blurb: "Master data used across the workspace" },
};

export const ITEM_BLURBS = {
  "/accounts": "Bank & cash balances", "/transactions": "Every income and expense", "/agents": "Sub-agent payouts & dues",
  "/invoices": "Bill and track clients", "/office-overview": "Office-wise performance", "/employees": "Employee records",
  "/leads": "Pipeline & follow-ups", "/staff": "Staff profiles & roles", "/attendance": "Attendance & payroll",
  "/expense-requests": "Review expense requests", "/activity": "Audit trail of actions", "/colleges": "Partner colleges & courses",
  "/categories": "Income & expense categories", "/dashboard": "Numbers, charts & activity", "/sc-report": "Service charge summary", "/quick-entry": "Log money in seconds", "/admission-revenue": "Revenue per admission",
  "/messages": "Chats & announcements", "/clients": "Client accounts", "/students": "Admissions & payments",
  "/users": "Team & approvals", "/branding": "Logo, colours & links", "/settings": "Workspace preferences",
};

export function launcherItems(user) {
  const sections = buildSections(visibleNavItems(user, "desktop"), user?.role);
  return sections.flatMap((sec) => sec.type === "group"
    ? [{ to: `/section/${sec.key}`, label: sec.label, icon: sec.icon, tid: `launch-${sec.key}`, blurb: GROUP_META[sec.key]?.blurb, count: sec.items.length }]
    : sec.items.filter((i) => i.to !== "/").map((i) => ({ ...i, blurb: ITEM_BLURBS[i.to] })));
}

export function sectionItems(user, key) {
  const routes = GROUP_ROUTES[key];
  if (!routes || user?.role !== "super_admin") return null;
  const items = visibleNavItems(user, "desktop");
  return routes.map((t) => items.find((i) => i.to === t)).filter(Boolean);
}

const GROUP_ROUTES = {
  accounts: ["/accounts", "/transactions", "/admission-revenue", "/agents", "/invoices"],
  office: ["/office-overview", "/employees", "/leads", "/staff", "/attendance", "/expense-requests", "/activity"],
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
    { type: "items", label: "Workspace", items: pick(["/", "/dashboard", "/quick-entry"]) },
    { type: "group", key: "accounts", label: "Accounts", icon: Wallet, items: pick(GROUP_ROUTES.accounts) },
    { type: "group", key: "office", label: "Office", icon: Buildings, items: pick(GROUP_ROUTES.office) },
    { type: "items", label: "People", items: pick(["/messages", "/clients", "/students"]) },
    { type: "group", key: "details", label: "Add details", icon: FolderSimplePlus, items: pick(GROUP_ROUTES.details) },
    { type: "items", label: "Settings", items: pick(["/users", "/branding", "/settings"]) },
  ].filter((s) => s.items.length > 0);
}

function visibleNavItems(user, variant) {
  const role = user?.role;
  const enabled = user?.enabled_modules;
  return ALL_NAV.filter((i) => {
    if (variant !== "mobile" && i.mobileOnly) return false;
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
}

export function useMonoTheme() {
  useEffect(() => {
    document.documentElement.classList.add("theme-mono");
    return () => document.documentElement.classList.remove("theme-mono");
  }, []);
}

const RAIL_KEY = "ec_sidebar_rail";

// Floating frosted-glass sidebar; collapses to an icon rail (remembered per device).
function DesktopSidebar({ user, alerts, onLogout }) {
  const [rail, setRail] = useState(() => localStorage.getItem(RAIL_KEY) === "1");
  const toggle = () => setRail((r) => { localStorage.setItem(RAIL_KEY, r ? "0" : "1"); return !r; });
  return (
    <TooltipProvider>
      <div className={`hidden md:block shrink-0 sticky top-0 h-screen py-4 pl-4 z-40 transition-[width] duration-300 ${rail ? "w-[84px]" : "w-[264px]"}`}>
        <aside className="glass-panel h-full flex flex-col rounded-[28px] overflow-hidden" data-testid="desktop-sidebar" data-collapsed={rail ? "true" : "false"}>
          <SidebarContent user={user} alerts={alerts} variant="desktop" rail={rail} onToggleRail={toggle} onLogout={onLogout} />
        </aside>
      </div>
    </TooltipProvider>
  );
}

function Avatar({ user, size = 40 }) {
  return (
    <div className="rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-xs font-semibold flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-[hsl(var(--primary))]/20" style={{ width: size, height: size }}>
      {user?.photo_url ? (
        <AuthedImage url={user.photo_url} alt={user?.name || "profile"} className="w-full h-full object-cover" fallback={initialsOf(user?.name).toUpperCase()} />
      ) : initialsOf(user?.name).toUpperCase()}
    </div>
  );
}

// Hover label for icon-only rail mode (portalled so the scrolling nav can't clip it).
function RailTip({ show, label, children }) {
  if (!show) return children;
  return (
    <Tooltip delayDuration={80}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="text-xs font-medium">{label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarContent({ onItemClick, user, onLogout, alerts, variant = "mobile", rail = false, onToggleRail, tidPrefix = "" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const role = user?.role;
  const { branding } = useBranding();
  const { theme, toggle: toggleTheme } = useTheme();
  const enabled = user?.enabled_modules;
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef(null);
  const { refresh: refreshMe } = useAuth();
  const [pins, setPins] = React.useState(() => user?.nav_pins || []);
  const [dragIdx, setDragIdx] = React.useState(null);
  React.useEffect(() => { setPins(user?.nav_pins || []); }, [user?.nav_pins]);
  const savePins = async (next) => {
    const prev = pins;
    setPins(next);
    try { await api.put("/auth/pins", { pins: next }); refreshMe?.(); }
    catch (e) { setPins(prev); toast.error(e?.response?.data?.detail || "Couldn't save pins"); }
  };
  // Only pins the user can still see count; hidden ones are pruned on the next save.
  const visiblePins = () => pinnedItems.map((i) => i.to);
  const togglePin = (to) => {
    const cur = visiblePins();
    if (cur.includes(to)) { savePins(cur.filter((p) => p !== to)); return; }
    if (cur.length >= 8) { toast.error("You can pin up to 8 pages. Unpin one first."); return; }
    savePins([...cur, to]);
  };
  const movePin = (from, target) => {
    if (from === null || from === target || target < 0) return;
    const next = visiblePins();
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    savePins(next);
  };
  const dropPin = (target) => { movePin(dragIdx, target); setDragIdx(null); };
  React.useEffect(() => { if (rail) setQuery(""); }, [rail]);
  const expandAndFocus = () => { onToggleRail?.(); setTimeout(() => searchRef.current?.focus(), 320); };
  const alertFor = (to) => {
    if (to === "/messages") return alerts?.messages || 0;
    if (to === "/expense-requests" && role === "super_admin") return alerts?.approvals || 0;
    return 0;
  };
  // Groups start collapsed; the group holding the current page opens automatically.
  const [collapsed, setCollapsed] = React.useState(() => {
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    const init = {};
    for (const [key, routes] of Object.entries(GROUP_ROUTES)) {
      init[key] = path !== `/section/${key}` && !routes.some((t) => path === t || path.startsWith(`${t}/`));
    }
    return init;
  });
  const navItems = visibleNavItems(user, variant);
  // Keep a roomy row gap, shrinking it only as far as needed to avoid scrolling.
  const navRef = React.useRef(null);
  const fitNav = React.useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    for (let py = 9; py >= 3; py -= 1) {
      el.style.setProperty("--row-py", `${py}px`);
      if (el.scrollHeight <= el.clientHeight) break;
    }
  }, []);
  React.useLayoutEffect(() => { fitNav(); });
  React.useEffect(() => {
    window.addEventListener("resize", fitNav);
    return () => window.removeEventListener("resize", fitNav);
  }, [fitNav]);

  const isMobile = variant === "mobile";
  const pinnedItems = pins.map((to) => navItems.find((i) => i.to === to)).filter(Boolean);
  const q = query.trim().toLowerCase();
  const sections = q
    ? [{ type: "items", label: "Results", items: navItems.filter((i) => `${i.label} ${i.to} ${ITEM_BLURBS[i.to] || ""}`.toLowerCase().includes(q)) }]
    : buildSections(navItems, role);

  const linkClass = (indent) => ({ isActive }) => [
    "group relative z-[1] flex items-center gap-3 rounded-2xl text-sm transition-[background-color,color,transform,box-shadow] duration-200",
    rail ? "justify-center h-10 w-10 mx-auto" : `${indent ? "pl-4 pr-3" : "px-3.5"} py-[var(--row-py,8px)]`,
    isActive
      ? "nav-active-pill bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold shadow-[0_8px_18px_-8px_hsl(var(--primary)/0.7)]"
      : "text-[hsl(var(--sidebar-fg))]/80 hover:bg-[hsl(var(--sidebar-fg))]/[0.06] hover:text-[hsl(var(--sidebar-fg))]",
    !rail && !isActive ? "hover:translate-x-0.5" : "",
  ].join(" ");

  const renderLink = (item, indent, pinIdx = -1) => {
    const count = alertFor(item.to);
    const inPinned = pinIdx >= 0;
    const tid = inPinned ? `${tidPrefix}pinned-${item.tid}` : `${tidPrefix}${item.tid}`;
    const isPinned = pins.includes(item.to);
    const dragProps = inPinned && !rail ? {
      draggable: true,
      onDragStart: (e) => { setDragIdx(pinIdx); e.dataTransfer.effectAllowed = "move"; },
      onDragOver: (e) => e.preventDefault(),
      onDrop: (e) => { e.preventDefault(); dropPin(pinIdx); },
      onDragEnd: () => setDragIdx(null),
    } : {};
    return (
      <RailTip key={`${inPinned ? "pin-" : ""}${item.to}`} show={rail} label={`${item.label}${count > 0 ? ` · ${count}` : ""}`}>
      <span className={`${rail ? "flex justify-center w-full" : "block relative group/pin"} ${dragIdx === pinIdx && inPinned ? "opacity-40" : ""}`} {...dragProps} data-testid={inPinned ? `pinned-row-${pinIdx}` : undefined}>
      {!rail && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(item.to); }}
          data-testid={`${tidPrefix}${inPinned ? "unpin" : "nav-pin"}-${item.tid}`}
          aria-label={isPinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
          title={isPinned ? "Unpin" : "Pin to top"}
          className={`absolute right-2 top-1/2 -translate-y-1/2 z-[2] w-6 h-6 rounded-md flex items-center justify-center transition-[opacity,color,background-color] duration-150 hover:bg-[hsl(var(--sidebar-fg))]/10 ${isPinned ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--sidebar-muted))] hover:text-[hsl(var(--primary))]"} ${isMobile || (isPinned && !inPinned) ? "opacity-100" : "opacity-0 group-hover/pin:opacity-100 focus:opacity-100"} ${count > 0 ? "hidden group-hover/pin:flex" : ""}`}
        >
          <PushPin size={13} weight={isPinned ? "fill" : "regular"} />
        </button>
      )}
      {!rail && inPinned && isMobile && pinIdx > 0 && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); movePin(pinIdx, pinIdx - 1); }}
          data-testid={`pin-up-${item.tid}`}
          aria-label={`Move ${item.label} up`}
          className="absolute right-9 top-1/2 -translate-y-1/2 z-[2] w-6 h-6 rounded-md flex items-center justify-center text-[hsl(var(--sidebar-muted))] hover:bg-[hsl(var(--sidebar-fg))]/10"
        >
          <CaretUp size={12} weight="bold" />
        </button>
      )}
      <NavLink to={item.to} end={item.end} data-testid={tid} onClick={onItemClick} className={linkClass(indent && !rail)} aria-label={item.label}>
        {({ isActive }) => (
          <>
            <item.icon size={19} weight={isActive ? "regular" : "light"} className={`shrink-0 ${isActive ? "" : "text-[hsl(var(--sidebar-muted))] group-hover:text-[hsl(var(--sidebar-fg))]"}`} />
            {!rail && <span className="truncate">{item.label}</span>}
            {count > 0 && (
              <span
                data-testid={`nav-alert-${item.tid}`}
                title={`${count} ${item.to === "/messages" ? "unread" : "pending"}`}
                className={rail
                  ? "absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white/80 dark:ring-black/40"
                  : "ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center shrink-0 ring-2 ring-white/70 dark:ring-transparent"}
              >
                {rail ? "" : count > 9 ? "9+" : count}
              </span>
            )}
          </>
        )}
      </NavLink>
      </span>
      </RailTip>
    );
  };

  const label = (text) => (rail || !text
    ? <div className={`${rail ? "mx-auto w-6" : "mx-3"} my-2 border-t border-[hsl(var(--sidebar-border))]`} aria-hidden />
    : <p className="px-3.5 mb-1.5 text-[10px] uppercase tracking-[0.22em] text-[hsl(var(--sidebar-muted))] font-semibold">{text}</p>);

  return (
    <>
      {/* Brand + collapse */}
      <div className={`group/brand flex items-center gap-3 pt-4 pb-3 ${rail ? "px-2 flex-col" : "px-4"}`}>
        <span className="relative shrink-0 rounded-2xl dark:bg-white dark:p-1 dark:shadow-sm">
          <BrandMark size={rail ? 34 : 36} className={`shadow-sm transition-opacity ${rail && onToggleRail ? "group-hover/brand:opacity-0" : ""}`} />
          {rail && onToggleRail && (
            <button type="button" onClick={onToggleRail} data-testid="sidebar-collapse-btn" aria-label="Expand menu" title="Expand menu"
              className="absolute inset-0 rounded-2xl bg-[hsl(var(--sidebar-fg))]/[0.08] text-[hsl(var(--sidebar-fg))] flex items-center justify-center opacity-0 group-hover/brand:opacity-100 focus-visible:opacity-100 transition-opacity">
              <CaretDoubleLeft size={15} weight="bold" className="rotate-180" />
            </button>
          )}
        </span>
        {!rail && (
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-display text-[15px] font-semibold tracking-tight text-[hsl(var(--sidebar-fg))] truncate" data-testid="sidebar-brand-name">{branding?.app_name || "EduConnect Pro"}</span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--sidebar-muted))] truncate">{branding?.company_line || ""}</span>
          </div>
        )}
        {onToggleRail && !rail && (
          <button type="button" onClick={onToggleRail} data-testid="sidebar-collapse-btn" aria-label="Collapse menu" title="Collapse menu"
            className="w-8 h-8 rounded-xl bg-[hsl(var(--sidebar-fg))]/[0.05] text-[hsl(var(--sidebar-muted))] hover:text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.09] flex items-center justify-center shrink-0 opacity-0 group-hover/brand:opacity-100 focus-visible:opacity-100 transition-[opacity,background-color,color]">
            <CaretDoubleLeft size={14} weight="bold" />
          </button>
        )}
      </div>

      {/* Search */}
      {rail ? (
        <div className="px-2 flex flex-col items-center">
          <RailTip show label="Search menu"><button type="button" onClick={expandAndFocus} className="w-10 h-10 rounded-2xl text-[hsl(var(--sidebar-muted))] hover:text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.06] flex items-center justify-center transition-colors" data-testid="sidebar-rail-search" aria-label="Search menu">
            <MagnifyingGlass size={19} weight="light" />
          </button></RailTip>
        </div>
      ) : (
        <div className="px-4">
          <div className="relative">
            <MagnifyingGlass size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--sidebar-muted))]" />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search menu…" data-testid="sidebar-search"
              onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
              className="w-full h-10 rounded-2xl bg-[hsl(var(--sidebar-fg))]/[0.045] border border-[hsl(var(--sidebar-border))]/70 focus:border-[hsl(var(--primary))]/40 focus:ring-4 focus:ring-[hsl(var(--primary))]/10 pl-10 pr-3 text-sm text-[hsl(var(--sidebar-fg))] placeholder:text-[hsl(var(--sidebar-muted))] outline-none transition-[border-color,box-shadow]" />
          </div>
        </div>
      )}

      {/* Nav */}
      <nav ref={navRef} onTransitionEnd={fitNav} className={`sidebar-scroll relative flex-1 overflow-y-auto overflow-x-hidden py-2.5 ${rail ? "px-2" : "px-3"}`} data-testid="sidebar-nav">
        {!q && pinnedItems.length > 0 && (
          <div className="pb-3 mb-1" data-testid="pinned-section">
            {rail ? null : (
              <p className="px-3 mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-[hsl(var(--primary))] font-semibold">
                <PushPin size={11} weight="fill" /> Pinned
              </p>
            )}
            <div className={rail ? "flex flex-col items-center gap-0.5" : "space-y-0.5"}>
              {pinnedItems.map((item, i) => renderLink(item, false, i))}
            </div>
            {label("")}
          </div>
        )}
        {sections.map((section, idx) => {
          if (q && section.items.length === 0) {
            return <p key="none" className="px-3 py-6 text-sm text-center text-[hsl(var(--sidebar-muted))]" data-testid="sidebar-search-empty">No menu items match "{query}"</p>;
          }
          if (section.type === "group" && rail) {
            const active = location.pathname === `/section/${section.key}` || section.items.some((it) => location.pathname === it.to || location.pathname.startsWith(`${it.to}/`));
            const groupAlert = section.items.reduce((n, it) => n + alertFor(it.to), 0);
            return (
              <div key={section.key} className="flex justify-center pt-0.5">
                <RailTip show label={`${section.label}${groupAlert ? ` · ${groupAlert}` : ""}`}>
                  <button type="button" onClick={() => { navigate(`/section/${section.key}`); onItemClick?.(); }} data-testid={`rail-group-${section.key}`} aria-label={section.label}
                    className={`relative h-10 w-10 rounded-2xl flex items-center justify-center transition-[background-color,color] duration-200 ${active ? "nav-active-pill bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_8px_18px_-8px_hsl(var(--primary)/0.7)]" : "text-[hsl(var(--sidebar-muted))] hover:text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.06]"}`}>
                    <section.icon size={19} weight={active ? "regular" : "light"} />
                    {groupAlert > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white/80 dark:ring-black/40" data-testid={`rail-group-alert-${section.key}`} />}
                  </button>
                </RailTip>
              </div>
            );
          }
          if (section.type === "group" && !rail) {
            const open = !collapsed[section.key];
            const groupAlert = section.items.reduce((n, it) => n + alertFor(it.to), 0);
            return (
              <div key={section.key} className="pt-[calc(var(--row-py,8px)+4px)]">
                <div className={`group flex items-center rounded-xl transition-colors ${location.pathname === `/section/${section.key}` ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--sidebar-muted))] hover:text-[hsl(var(--sidebar-fg))]"}`}>
                  <button type="button" onClick={() => { setCollapsed(Object.fromEntries(Object.keys(GROUP_ROUTES).map((k) => [k, k !== section.key]))); navigate(`/section/${section.key}`); onItemClick?.(); }} data-testid={`nav-group-open-${section.key}`}
                    title={`Open ${section.label} overview`}
                    className="flex-1 min-w-0 flex items-center gap-2 pl-3.5 py-1 text-left text-[10px] uppercase tracking-[0.22em] font-semibold">
                    <span className="truncate">{section.label}</span>
                    {!open && groupAlert > 0 && <span data-testid={`nav-group-alert-${section.key}`} title={`${groupAlert} need attention`} className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />}
                    <ArrowUpRight size={11} weight="bold" className="opacity-0 group-hover:opacity-100" />
                  </button>
                  <button type="button" onClick={() => setCollapsed((c) => Object.fromEntries(Object.keys(GROUP_ROUTES).map((k) => [k, k === section.key ? !c[k] : true])))} data-testid={`nav-group-${section.key}`} aria-expanded={open} aria-label={`Toggle ${section.label}`}
                    className="shrink-0 h-7 w-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--sidebar-fg))]/[0.06]">
                    <CaretDown size={11} weight="bold" className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
                  </button>
                </div>
                <div className={`nav-collapse ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden min-h-0">
                    <div className="mt-0.5 space-y-0.5">
                      {section.items.map((item) => renderLink(item, false))}
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          if (!rail && !q && section.label === "Settings" && section.items.length > 1) {
            return (
              <div key="settings" className="pt-[calc(var(--row-py,8px)+6px)]" data-testid="sidebar-settings-grid">
                {label(section.label)}
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${section.items.length}, minmax(0, 1fr))` }}>
                  {section.items.map((item) => (
                    <NavLink key={item.to} to={item.to} data-testid={`${tidPrefix}${item.tid}`} onClick={onItemClick} title={item.label}
                      className={({ isActive }) => `flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] transition-colors ${isActive ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold" : "bg-[hsl(var(--sidebar-fg))]/[0.04] text-[hsl(var(--sidebar-fg))]/80 hover:bg-[hsl(var(--sidebar-fg))]/[0.08]"}`}>
                      {({ isActive }) => (<><item.icon size={17} weight={isActive ? "regular" : "light"} /><span className="truncate max-w-full px-1">{item.label}</span></>)}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div key={section.key || `sec-${idx}`} className={idx > 0 ? (rail ? "pt-0.5" : "pt-[calc(var(--row-py,8px)+6px)]") : ""}>
              {rail ? (idx > 0 && section.type !== "group" && sections[idx - 1]?.type !== "group" ? label("") : null) : section.label ? label(section.label) : null}
              <div className={rail ? "flex flex-col items-center gap-0.5" : "space-y-0.5"}>{section.items.map((item) => renderLink(item, false))}</div>
            </div>
          );
        })}
      </nav>

      {/* Bottom: profile card with theme + sign out */}
      <div className={`shrink-0 ${rail ? "p-2 flex flex-col items-center gap-0.5" : "px-3 pb-3 pt-2"}`}>
        {rail ? (
          <>
            <RailTip show label={theme === "dark" ? "Light mode" : "Dark mode"}>
              <button type="button" onClick={toggleTheme} data-testid="sidebar-theme-toggle" aria-label="Toggle dark mode" className="w-10 h-10 rounded-2xl flex items-center justify-center text-[hsl(var(--sidebar-muted))] hover:text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.06] transition-colors">
                {theme === "dark" ? <Sun size={19} className="text-amber-400" /> : <Moon size={19} weight="light" />}
              </button>
            </RailTip>
            <RailTip show label={user?.name}>
              <button type="button" onClick={() => { navigate("/settings"); onItemClick?.(); }} data-testid="sidebar-profile" aria-label="Open profile" className="rounded-full hover:scale-105 transition-transform"><Avatar user={user} size={34} /></button>
            </RailTip>
            {onLogout && (
              <RailTip show label="Sign out">
                <button type="button" onClick={onLogout} data-testid={`${tidPrefix || "sidebar-"}logout-btn`} aria-label="Sign out" className="w-10 h-10 rounded-2xl flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors">
                  <SignOut size={19} />
                </button>
              </RailTip>
            )}
          </>
        ) : (
          <div className="glass-card flex items-center gap-2.5 rounded-[20px] p-2" data-testid="sidebar-profile">
            <button type="button" onClick={() => { navigate("/settings"); onItemClick?.(); }} data-testid="sidebar-profile-open" className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-xl">
              <Avatar user={user} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[hsl(var(--sidebar-fg))] truncate" data-testid={isMobile ? "drawer-user-name" : "sidebar-user-name"}>{user?.name}</span>
                <span className="block text-[11px] text-[hsl(var(--sidebar-muted))] truncate" data-testid="sidebar-user-email">{user?.email}</span>
              </span>
            </button>
            <button type="button" onClick={toggleTheme} data-testid="sidebar-theme-toggle" aria-label="Toggle dark mode" title={theme === "dark" ? "Light mode" : "Dark mode"}
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-[hsl(var(--sidebar-muted))] hover:text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.07] transition-colors">
              {theme === "dark" ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} />}
            </button>
            {onLogout && (
              <button type="button" onClick={onLogout} data-testid={isMobile ? "drawer-logout-btn" : `${tidPrefix || "sidebar-"}logout-btn`} aria-label="Sign out" title="Sign out"
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors">
                <SignOut size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const nav = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [alerts, setAlerts] = useState({ messages: 0, approvals: 0 });
  const { theme, toggle: toggleTheme } = useTheme();

  // Attention signals for the sidebar: unread messages (all roles) and pending
  // expense approvals (super admin). Refreshed on navigation + every 60s so the
  // dots clear once the user has dealt with them.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const load = async () => {
      const next = { messages: 0, approvals: 0 };
      try {
        const r = await api.get("/messages/unread-count");
        next.messages = r.data?.count || 0;
        setBadgePart("msgs", next.messages);
      } catch { /* ignore */ }
      if (user.role === "super_admin") {
        try {
          const r = await api.get("/expense-requests", { params: { status: "pending" } });
          next.approvals = Array.isArray(r.data) ? r.data.length : 0;
        } catch { /* ignore */ }
      }
      if (!cancelled) setAlerts(next);
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user, location.pathname]);

  const pageTitle = (user?.role === "staff" && location.pathname === "/settings" ? "Profile" : null)
    || (user?.role === "staff" && location.pathname === "/leads" ? "My Leads" : null)
    || PAGE_TITLES[location.pathname]
    || (location.pathname.startsWith("/section/") ? (GROUP_META[location.pathname.split("/")[2]]?.label || "") : "")
    || (location.pathname.startsWith("/students/") ? "Student" : "")
    || (location.pathname.startsWith("/agents/") ? "Agent detail" : "")
    || (branding?.app_name || "EduConnect Pro");

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useMonoTheme();

  const handleLogout = async () => {
    await logout();
    nav("/login");
  };

  // Block direct URL access to a module the company has switched off.
  const bgPhoto = useAuthedObjectUrl(branding?.app_background === "photo" ? branding?.app_background_url : "");
  const disabledModule = useMemo(() => {
    const mod = PATH_MODULE[location.pathname];
    const enabled = user?.enabled_modules;
    return mod && Array.isArray(enabled) && !enabled.includes(mod);
  }, [location.pathname, user]);
  if (disabledModule) return <Navigate to="/" replace />;

  const bgMode = branding?.app_background || "gradient";
  const bgClass = bgMode === "plain" ? "bg-background" : bgMode === "photo" && bgPhoto ? "app-photo-bg" : "app-glass-bg";
  return (
    <div className={`${bgClass} min-h-screen w-full text-foreground flex`} data-testid="app-root" data-bg={bgMode}
      style={bgClass === "app-photo-bg" ? { "--app-bg-photo": `url("${bgPhoto}")` } : undefined}>
      {/* Desktop Sidebar */}
      <DesktopSidebar user={user} alerts={alerts} onLogout={handleLogout} />

      {/* Mobile Drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            data-testid="mobile-drawer-overlay"
          />
          <aside
            className="glass-panel glass-panel-solid md:hidden fixed top-2 left-2 bottom-2 z-[70] w-[84vw] max-w-[300px] rounded-[26px] overflow-hidden flex flex-col animate-fade-in"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            data-testid="mobile-drawer"
          >
            <SidebarContent user={user} alerts={alerts} variant="mobile" onItemClick={() => setMobileOpen(false)} onLogout={handleLogout} />
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
          <div className="h-16 px-4 md:px-8 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              data-testid="mobile-menu-btn"
              className="md:hidden shrink-0 w-9 h-9 rounded-xl bg-muted text-foreground flex items-center justify-center hover:bg-muted/80"
            >
              <ListIcon size={20} />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold truncate hidden sm:block">Workspace</p>
              <h2 className="font-display text-base md:text-lg font-semibold tracking-tight truncate" data-testid="topbar-page-title">{pageTitle}</h2>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 md:gap-3 shrink-0">
            <AcademicYearSelect />
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
            <button
              type="button"
              onClick={() => nav("/messages")}
              data-testid="topbar-messages-btn"
              title="Messages"
              className="md:hidden relative w-9 h-9 rounded-full bg-muted/60 hover:bg-muted text-foreground flex items-center justify-center transition-colors"
            >
              <ChatCircleDots size={18} />
              {alerts.messages > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-semibold flex items-center justify-center">
                  {alerts.messages > 9 ? "9+" : alerts.messages}
                </span>
              )}
            </button>
            <div className="pl-1.5 sm:pl-3 sm:ml-1 border-l border-border h-8 flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="profile-menu-btn"
                    className="flex items-center gap-2 sm:gap-2.5 rounded-full hover:bg-muted/60 pl-0.5 pr-1.5 py-0.5 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-amber-gradient text-white text-xs font-semibold flex items-center justify-center shrink-0 overflow-hidden" data-testid="topbar-avatar">
                      {user?.photo_url ? (
                        <AuthedImage
                          url={user.photo_url}
                          alt={user?.name || "profile"}
                          className="w-full h-full object-cover"
                          testid="topbar-avatar-img"
                          fallback={initialsOf(user?.name).toUpperCase()}
                        />
                      ) : (
                        initialsOf(user?.name).toUpperCase()
                      )}
                    </div>
                    <div className="hidden lg:block min-w-0 text-left">
                      <p className="text-xs font-medium leading-tight truncate max-w-[140px]" data-testid="topbar-user-name">{user?.name}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{user?.business_name || user?.tenant_name || user?.currency || "USD"}</p>
                    </div>
                    <CaretDown size={13} className="hidden sm:block text-muted-foreground shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56" data-testid="profile-menu">
                  <DropdownMenuLabel>
                    <p className="text-sm font-medium truncate">{user?.name}</p>
                    <p className="text-xs text-muted-foreground font-normal truncate">{user?.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => { e.preventDefault(); toggleTheme(); }}
                    data-testid="profile-theme-toggle"
                    className="cursor-pointer"
                  >
                    {theme === "dark"
                      ? <><Sun size={16} weight="fill" className="mr-2 text-amber-400" /> Light mode</>
                      : <><Moon size={16} weight="fill" className="mr-2 text-orange-600" /> Dark mode</>}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => nav("/settings")} data-testid="profile-settings" className="cursor-pointer">
                    <UserCircle size={16} className="mr-2" /> Profile &amp; settings
                  </DropdownMenuItem>
                  {hasModule(user, "product_tour") && (
                    <DropdownMenuItem onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))} data-testid="profile-take-tour" className="cursor-pointer">
                      <Compass size={16} className="mr-2" /> Take the tour
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    data-testid="logout-btn"
                    className="cursor-pointer text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:focus:text-rose-400"
                  >
                    <SignOut size={16} className="mr-2" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          </div>
        </header>
        <TrialBanner />

        <div className="mobile-pad px-4 sm:px-6 lg:px-10 pt-5 sm:pt-8 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-12 max-w-[1500px] w-full mx-auto">
          <div key={location.pathname} className="route-enter">
            <Outlet />
          </div>
        </div>
      </main>
      <BottomNav />
      <ProductTour />
      <InstallPrompt />
    </div>
  );
}

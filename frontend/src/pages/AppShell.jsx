import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import api from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { useBranding } from "@/lib/branding";
import BrandMark from "@/components/BrandMark";
import { canView, hasModule } from "@/lib/perm";
import { buildApplyUrl } from "@/lib/applyUrl";
import AuthedImage from "@/components/AuthedImage";
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
  ClockCounterClockwise, Clock, ChartBar, Palette, Compass, CaretLeft, CaretUp, CalendarBlank, PushPin,
} from "@phosphor-icons/react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

// Sidebar nav with role gating.
//   roles: array of roles that can see this item. Omitting `roles` means all.
//   perm: page-permission key — when present, item is hidden if canView(user, perm) is false.
//   userRoleAllowed: explicit allow-list flag for the lightweight "user" role.
//     Omit (or set falsy) to hide the item from "user" role accounts.
const ALL_NAV = [
  { to: "/", label: "Overview", icon: House, end: true, tid: "nav-overview", perm: "overview", module: "overview", userRoleAllowed: true },
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
const GROUP_ROUTES = {
  accounts: ["/accounts", "/transactions", "/agents", "/invoices"],
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
    { type: "items", label: "Workspace", items: pick(["/", "/quick-entry", "/admission-revenue"]) },
    { type: "group", key: "accounts", label: "Accounts", icon: Wallet, items: pick(GROUP_ROUTES.accounts) },
    { type: "items", items: pick(["/messages", "/clients", "/students"]) },
    { type: "group", key: "office", label: "Office", icon: Buildings, items: pick(GROUP_ROUTES.office) },
    { type: "group", key: "details", label: "Add details", icon: FolderSimplePlus, items: pick(GROUP_ROUTES.details) },
    { type: "items", items: pick(["/users", "/branding", "/settings"]) },
  ].filter((s) => s.items.length > 0);
}

function Avatar({ user, size = 40 }) {
  return (
    <div className="rounded-full bg-[hsl(var(--primary))] text-white text-xs font-semibold flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-[hsl(var(--primary))]/20" style={{ width: size, height: size }}>
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

function SidebarContent({ onItemClick, user, onLogout, alerts, variant = "mobile", rail = false, onToggleRail }) {
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
      init[key] = !routes.some((t) => path === t || path.startsWith(`${t}/`));
    }
    return init;
  });
  const navItems = ALL_NAV.filter((i) => {
    if (variant === "desktop" && i.mobileOnly) return false;
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

  const isMobile = variant === "mobile";
  const pinnedItems = pins.map((to) => navItems.find((i) => i.to === to)).filter(Boolean);
  const q = query.trim().toLowerCase();
  const sections = q
    ? [{ type: "items", label: "Results", items: navItems.filter((i) => i.label.toLowerCase().includes(q)) }]
    : buildSections(navItems, role);

  const linkClass = (indent) => ({ isActive }) => [
    "group relative z-[1] flex items-center gap-3 rounded-xl text-sm transition-[background-color,color,transform] duration-200",
    rail ? "justify-center h-11 w-11 mx-auto" : `${indent ? "pl-10 pr-3" : "px-3"} py-2.5`,
    isActive
      ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-semibold"
      : "text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.06] hover:text-[hsl(var(--primary))]",
    !rail && !isActive ? "hover:translate-x-0.5" : "",
  ].join(" ");

  const renderLink = (item, indent, pinIdx = -1) => {
    const count = alertFor(item.to);
    const inPinned = pinIdx >= 0;
    const tid = inPinned ? `pinned-${item.tid}` : item.tid;
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
          data-testid={`${inPinned ? "unpin" : "nav-pin"}-${item.tid}`}
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
            {isActive && !rail && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-[hsl(var(--primary))]" aria-hidden />}
            <item.icon size={19} weight={isActive ? "fill" : "regular"} className="shrink-0" />
            {!rail && <span className="truncate">{item.label}</span>}
            {count > 0 && (
              <span
                data-testid={`nav-alert-${item.tid}`}
                title={`${count} ${item.to === "/messages" ? "unread" : "pending"}`}
                className={rail
                  ? "absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-[hsl(var(--sidebar-bg))]"
                  : "ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center shrink-0"}
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
    : <p className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.2em] text-[hsl(var(--sidebar-muted))] font-semibold">{text}</p>);

  return (
    <>
      {/* Brand + collapse */}
      <div className={`flex items-center gap-3 pt-5 pb-4 ${rail ? "px-3 flex-col" : "px-5"}`}>
        <BrandMark size={rail ? 38 : 40} className="shadow-sm shrink-0" />
        {!rail && (
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-display text-[15px] font-semibold tracking-tight text-[hsl(var(--sidebar-fg))] truncate">{branding?.app_name || "EduConnect Pro"}</span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--sidebar-muted))] truncate">{branding?.company_line || ""}</span>
          </div>
        )}
        {onToggleRail && (
          <button type="button" onClick={onToggleRail} data-testid="sidebar-collapse-btn" aria-label={rail ? "Expand menu" : "Collapse menu"} title={rail ? "Expand menu" : "Collapse menu"}
            className="w-8 h-8 rounded-lg border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-muted))] hover:text-[hsl(var(--primary))] hover:border-[hsl(var(--primary))]/40 flex items-center justify-center shrink-0 transition-colors">
            <CaretLeft size={14} weight="bold" className={`transition-transform duration-300 ${rail ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {/* Profile card */}
      <div className={rail ? "px-3 pb-3 flex justify-center" : "px-4 pb-3"}>
        {rail ? (
          <RailTip show label={user?.name}><div className="relative" data-testid="sidebar-profile"><Avatar user={user} size={36} /></div></RailTip>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl bg-[hsl(var(--sidebar-fg))]/[0.04] border border-[hsl(var(--sidebar-border))] px-3 py-2.5" data-testid="sidebar-profile">
            <Avatar user={user} size={38} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[hsl(var(--sidebar-fg))] truncate" data-testid={isMobile ? "drawer-user-name" : "sidebar-user-name"}>{user?.name}</p>
              <p className="text-[11px] font-medium capitalize text-[hsl(var(--primary))] truncate">{(user?.role || "").replace("_", " ")}</p>
            </div>
          </div>
        )}
      </div>

      {/* Search + academic year */}
      {!rail && (
        <div className="px-4 space-y-2">
          <div className="relative">
            <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--sidebar-muted))]" />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search menu" data-testid="sidebar-search"
              className="w-full h-9 rounded-xl bg-[hsl(var(--sidebar-fg))]/[0.05] border border-transparent focus:border-[hsl(var(--primary))]/40 focus:bg-[hsl(var(--sidebar-bg))] pl-9 pr-3 text-sm text-[hsl(var(--sidebar-fg))] placeholder:text-[hsl(var(--sidebar-muted))] outline-none transition-colors" />
          </div>
          {hasModule(user, "academic_year") && <AcademicYearSelect className="!w-full !justify-start !rounded-xl !h-9" />}
        </div>
      )}
      {rail && (
        <div className="px-3 space-y-1.5 flex flex-col items-center">
          <RailTip show label="Search menu"><button type="button" onClick={expandAndFocus} className="w-11 h-11 rounded-xl text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.06] flex items-center justify-center" data-testid="sidebar-rail-search" aria-label="Search menu">
            <MagnifyingGlass size={18} />
          </button></RailTip>
          {hasModule(user, "academic_year") && (
            <RailTip show label="Academic year"><button type="button" onClick={onToggleRail} className="w-11 h-11 rounded-xl text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.06] flex items-center justify-center" data-testid="sidebar-rail-year" aria-label="Academic year">
              <CalendarBlank size={18} />
            </button></RailTip>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className={`sidebar-scroll relative flex-1 overflow-y-auto overflow-x-hidden py-4 space-y-0.5 ${rail ? "px-2" : "px-3"}`} data-testid="sidebar-nav">
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
          if (section.type === "group" && !rail) {
            const open = !collapsed[section.key];
            const groupAlert = section.items.reduce((n, it) => n + alertFor(it.to), 0);
            return (
              <div key={section.key} className="pt-1">
                <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [section.key]: !c[section.key] }))} data-testid={`nav-group-${section.key}`} aria-expanded={open}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.06] transition-colors">
                  <section.icon size={19} weight="regular" className="shrink-0" />
                  <span className="flex-1 text-left">{section.label}</span>
                  {!open && groupAlert > 0 && <span data-testid={`nav-group-alert-${section.key}`} title={`${groupAlert} need attention`} className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />}
                  <CaretDown size={13} weight="bold" className={`shrink-0 text-[hsl(var(--sidebar-muted))] transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
                </button>
                <div className={`nav-collapse ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden min-h-0">
                    <div className="mt-0.5 space-y-0.5 relative before:absolute before:left-[21px] before:top-1 before:bottom-1 before:w-px before:bg-[hsl(var(--sidebar-border))]">
                      {section.items.map((item) => renderLink(item, true))}
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={section.key || `sec-${idx}`} className={idx > 0 ? "pt-3" : ""}>
              {section.label ? label(section.label) : idx > 0 ? label("") : null}
              <div className={rail ? "flex flex-col items-center gap-0.5" : "space-y-0.5"}>{section.items.map((item) => renderLink(item, false))}</div>
            </div>
          );
        })}
      </nav>

      {/* Bottom: theme switch + sign out */}
      <div className={`border-t border-[hsl(var(--sidebar-border))] p-3 space-y-1 shrink-0 ${rail ? "flex flex-col items-center" : ""}`}>
        <RailTip show={rail} label={theme === "dark" ? "Light mode" : "Dark mode"}>
        <button type="button" onClick={toggleTheme} data-testid="sidebar-theme-toggle" aria-label="Toggle dark mode"
          className={`group relative flex items-center gap-3 rounded-xl text-sm text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-fg))]/[0.06] transition-colors ${rail ? "w-11 h-11 justify-center" : "w-full px-3 py-2.5"}`}>
          {theme === "dark" ? <Sun size={19} className="shrink-0 text-amber-400" /> : <Moon size={19} className="shrink-0" />}
          {!rail && <span className="flex-1 text-left">{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
          {!rail && (
            <span className={`relative w-9 h-5 rounded-full transition-colors ${theme === "dark" ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--sidebar-fg))]/20"}`} aria-hidden>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${theme === "dark" ? "translate-x-4" : ""}`} />
            </span>
          )}
        </button>
        </RailTip>
        {onLogout && (
          <RailTip show={rail} label="Sign out">
          <button type="button" onClick={onLogout} data-testid={isMobile ? "drawer-logout-btn" : "sidebar-logout-btn"} aria-label="Sign out"
            className={`group relative flex items-center gap-3 rounded-xl text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors ${rail ? "w-11 h-11 justify-center" : "w-full px-3 py-2.5"}`}>
            <SignOut size={19} className="shrink-0" />
            {!rail && <span>Sign out</span>}
          </button>
          </RailTip>
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
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem("sidebarRail") === "1"; } catch { return false; }
  });
  const toggleSidebar = () => setSidebarHidden((v) => {
    const next = !v;
    try { localStorage.setItem("sidebarRail", next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });
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
    || (location.pathname.startsWith("/students/") ? "Student" : "")
    || (location.pathname.startsWith("/agents/") ? "Agent detail" : "")
    || (branding?.app_name || "EduConnect Pro");

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
      <TooltipProvider>
      <div className={`hidden md:block shrink-0 sticky top-0 h-screen p-3 pr-0 transition-[width] duration-300 ease-out ${sidebarHidden ? "w-[92px]" : "w-[284px]"}`}>
        <aside
          className="h-full flex flex-col rounded-2xl border bg-[hsl(var(--sidebar-bg))] border-[hsl(var(--sidebar-border))] shadow-[0_8px_30px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] overflow-hidden"
          data-testid="desktop-sidebar"
          data-collapsed={sidebarHidden ? "true" : "false"}
        >
          <SidebarContent user={user} alerts={alerts} variant="desktop" rail={sidebarHidden} onToggleRail={toggleSidebar} onLogout={handleLogout} />
        </aside>
      </div>
      </TooltipProvider>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            data-testid="mobile-drawer-overlay"
          />
          <aside
            className="md:hidden fixed top-0 left-0 z-[70] w-[84vw] max-w-[300px] h-full bg-[hsl(var(--sidebar-bg))] border-r border-[hsl(var(--sidebar-border))] rounded-r-2xl shadow-2xl flex flex-col animate-fade-in"
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
            <AcademicYearSelect />
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
            <button
              type="button"
              onClick={() => nav("/messages")}
              data-testid="topbar-messages-btn"
              title="Messages"
              className="md:hidden relative w-10 h-10 rounded-full bg-muted/60 hover:bg-muted text-foreground flex items-center justify-center transition-colors"
            >
              <ChatCircleDots size={18} />
              {alerts.messages > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-semibold flex items-center justify-center">
                  {alerts.messages > 9 ? "9+" : alerts.messages}
                </span>
              )}
            </button>
            <div className="pl-2 sm:pl-3 ml-0.5 sm:ml-1 border-l border-border h-8 flex items-center">
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
                      <p className="text-[10px] text-muted-foreground leading-tight">{user?.business_name || user?.currency || "USD"}</p>
                    </div>
                    <CaretDown size={13} className="text-muted-foreground shrink-0" />
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

        <div className="px-4 sm:px-6 lg:px-10 py-6 sm:py-8 pb-28 md:pb-12 max-w-[1500px] w-full mx-auto">
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

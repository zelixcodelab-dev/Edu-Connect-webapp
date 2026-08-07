import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { canView } from "@/lib/perm";
import { navigateToApply, linkedUserRef } from "@/lib/applyUrl";
import {
  House,
  Student,
  UsersThree,
  Receipt,
  Plus,
  X,
  Wallet,
  Buildings,
  ClipboardText,
  CurrencyCircleDollar,
  ReceiptX,
  Coins,
  ChatCircleDots,
  Target,
  CalendarCheck,
} from "@phosphor-icons/react";

// Bottom nav side items, ranked. We render up to 4 visible items + the center FAB.
//   perm  → page-permission key; item is hidden when canView(user, perm) is false
//   roles → if provided, item is only visible to listed roles
const ALL_SIDE_NAV = [
  { to: "/", label: "Home", icon: House, end: true, tid: "bottom-nav-home", perm: "overview" },
  { to: "/my-ledger", label: "My ledger", icon: Coins, tid: "bottom-nav-my-ledger", roles: ["user"] },
  { to: "/messages", label: "Messages", icon: ChatCircleDots, tid: "bottom-nav-messages" },
  { to: "/students", label: "Students", icon: Student, tid: "bottom-nav-students", perm: "students" },
  { to: "/my-students", label: "Students", icon: Student, tid: "bottom-nav-my-students", roles: ["staff"] },
  { to: "/clients", label: "Clients", icon: UsersThree, tid: "bottom-nav-clients", perm: "clients" },
  { to: "/invoices", label: "Invoices", icon: Receipt, tid: "bottom-nav-invoices", roles: ["super_admin"] },
  { to: "/transactions", label: "Transactions", icon: CurrencyCircleDollar, tid: "bottom-nav-transactions", perm: "transactions" },
  { to: "/expense-requests", label: "Expenses", icon: ReceiptX, tid: "bottom-nav-expenses", perm: "expense_requests" },
];

// Staff get a fixed, CRM-focused bottom bar: Home · My Leads · [＋] · Messages · Leave
const STAFF_SIDE_NAV = [
  { to: "/", label: "Home", icon: House, end: true, tid: "bottom-nav-home" },
  { to: "/leads", label: "My Leads", icon: Target, tid: "bottom-nav-my-leads" },
  { to: "/messages", label: "Messages", icon: ChatCircleDots, tid: "bottom-nav-messages" },
  { to: "/leave", label: "Leave", icon: CalendarCheck, tid: "bottom-nav-leave" },
];

const ALL_QUICK_ACTIONS = [
  {
    label: "Add transaction",
    sub: "Log a credit or debit",
    icon: Wallet,
    color: "from-emerald-500 to-emerald-600",
    href: "/quick-entry",
    tid: "qa-add-transaction",
    perm: "quick_entry",
  },
  {
    label: "Add student",
    sub: "New enrollment",
    icon: Student,
    color: "from-orange-500 to-amber-600",
    href: "/students?new=1",
    tid: "qa-add-student",
    perm: "students",
  },
  {
    label: "Paste application",
    sub: "Parse raw inquiry text",
    icon: ClipboardText,
    color: "from-violet-500 to-fuchsia-600",
    href: "/students?paste=1",
    tid: "qa-paste-application",
    perm: "students",
  },
  {
    label: "Add college",
    sub: "Master catalogue entry",
    icon: Buildings,
    color: "from-sky-500 to-blue-600",
    href: "/colleges?add=1",
    tid: "qa-add-college",
    roles: ["super_admin"],
  },
  {
    label: "Expense request",
    sub: "Submit for approval",
    icon: ReceiptX,
    color: "from-rose-500 to-pink-600",
    href: "/expense-requests?new=1",
    tid: "qa-add-expense-request",
    perm: "expense_requests",
    roles: ["office_admin", "user"],
  },
  {
    label: "Add lead",
    sub: "New prospect",
    icon: Target,
    color: "from-amber-500 to-orange-600",
    href: "/leads?new=1",
    tid: "qa-add-lead",
    roles: ["staff"],
    perm: "leads",
  },
  {
    label: "Add student",
    sub: "Credit to you",
    icon: Student,
    color: "from-emerald-500 to-emerald-600",
    href: "/my-students?add=1",
    tid: "qa-staff-add-student",
    roles: ["staff"],
  },
];

function isVisible(item, user) {
  if (!user) return false;
  if (item.roles && !item.roles.includes(user.role)) return false;
  if (item.perm && !canView(user, item.perm)) return false;
  return true;
}

function NavItem({ item, active }) {
  const nav = useNavigate();
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => nav(item.to)}
      data-testid={item.tid}
      className={`flex flex-col items-center justify-center gap-1 py-2 transition-all ${
        active
          ? "text-orange-600 dark:text-orange-400"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon size={22} weight={active ? "fill" : "regular"} />
      <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
    </button>
  );
}

function EmptyNavSlot() {
  return <div aria-hidden className="py-2" />;
}

export default function BottomNav() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const isActive = (item) => {
    if (item.end) return loc.pathname === item.to;
    return loc.pathname === item.to || loc.pathname.startsWith(`${item.to}/`);
  };

  const go = (href) => {
    setOpen(false);
    nav(href);
  };

  // Take the top 4 visible side items in declared order. We display them
  // around the center FAB (2 on each side). If we have fewer than 4, the
  // remaining slots render as empty placeholders so the layout stays stable.
  const sideItems = (user?.role === "staff" ? STAFF_SIDE_NAV : ALL_SIDE_NAV.filter((i) => isVisible(i, user))).slice(0, 4);
  const quickActions = ALL_QUICK_ACTIONS.filter((a) => isVisible(a, user));

  // For linked sub-agent/associate-consultant "user" accounts the FAB
  // bypasses the quick-add sheet and jumps straight to the public application
  // form pre-filled with their referral code — they only need to onboard
  // students and the sheet's other actions don't apply.
  const linkedRef = user?.role === "user" ? linkedUserRef(user) : null;
  const isLinkedUser = !!linkedRef;
  const onFabClick = () => {
    if (isLinkedUser) {
      navigateToApply(nav, linkedRef);
    } else {
      setOpen(true);
    }
  };
  const fabVisible = isLinkedUser || quickActions.length > 0;

  return (
    <>
      {/* Action sheet */}
      {open && (
        <>
          <div
            className="md:hidden fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
            data-testid="quick-actions-overlay"
          />
          <div
            className="md:hidden fixed inset-x-0 bottom-0 z-[61] bg-card rounded-t-3xl border-t border-border shadow-2xl animate-fade-in"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
            data-testid="quick-actions-sheet"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div>
                <p className="label-eyebrow">Quick add</p>
                <h3 className="font-display text-lg mt-0.5">What are we logging?</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                data-testid="quick-actions-close"
                className="w-9 h-9 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-3 pt-3 pb-2 grid grid-cols-2 gap-2">
              {quickActions.length === 0 ? (
                <div className="col-span-2 text-center text-sm text-muted-foreground py-8" data-testid="quick-actions-empty">
                  No quick actions available for your permissions.
                </div>
              ) : (
                quickActions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.label}
                      type="button"
                      onClick={() => go(a.href)}
                      data-testid={a.tid}
                      className="text-left p-3.5 rounded-2xl border border-border bg-background hover:bg-muted/50 transition-all active:scale-[0.98]"
                    >
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${a.color} text-white flex items-center justify-center mb-2.5 shadow-md`}>
                        <Icon size={20} weight="bold" />
                      </div>
                      <p className="text-sm font-medium text-foreground leading-tight">{a.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{a.sub}</p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* Bottom navigation bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background/95 backdrop-blur-xl border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="bottom-nav"
      >
        <div className="grid grid-cols-5 items-center h-16 max-w-md mx-auto relative">
          {sideItems[0] ? <NavItem item={sideItems[0]} active={isActive(sideItems[0])} /> : <EmptyNavSlot />}
          {sideItems[1] ? <NavItem item={sideItems[1]} active={isActive(sideItems[1])} /> : <EmptyNavSlot />}
          {/* Center FAB */}
          <div className="flex items-center justify-center">
            {fabVisible && (
              <button
                type="button"
                onClick={onFabClick}
                data-testid="bottom-nav-add"
                aria-label={isLinkedUser ? "Add new student" : "Quick add"}
                className="absolute -top-5 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-amber-gradient text-white shadow-lg shadow-orange-500/40 flex items-center justify-center active:scale-95 transition-transform ring-4 ring-background"
              >
                <Plus size={26} weight="bold" />
              </button>
            )}
          </div>
          {sideItems[2] ? <NavItem item={sideItems[2]} active={isActive(sideItems[2])} /> : <EmptyNavSlot />}
          {sideItems[3] ? <NavItem item={sideItems[3]} active={isActive(sideItems[3])} /> : <EmptyNavSlot />}
        </div>
      </nav>
    </>
  );
}

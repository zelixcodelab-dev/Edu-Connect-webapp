import React, { useEffect } from "react";
import "@/index.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { BrandingProvider, useBranding } from "@/lib/branding";
import { Toaster } from "@/components/ui/sonner";

import AuthPage from "@/pages/AuthPage";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import AppShell from "@/pages/AppShell";
import Dashboard from "@/pages/Dashboard";
import QuickEntry from "@/pages/QuickEntry";
import Transactions from "@/pages/Transactions";
import Accounts from "@/pages/Accounts";
import Invoices from "@/pages/Invoices";
import Clients from "@/pages/Clients";
import Categories from "@/pages/Categories";
import Settings from "@/pages/Settings";
import Students from "@/pages/Students";
import StudentDetail from "@/pages/StudentDetail";
import Agents from "@/pages/Agents";
import AgentDetail from "@/pages/AgentDetail";
import ClientDetail from "@/pages/ClientDetail";
import Users from "@/pages/Users";
import ExpenseRequests from "@/pages/ExpenseRequests";
import PublicApplication from "@/pages/PublicApplication";
import Colleges from "@/pages/Colleges";
import AdmissionRevenue from "@/pages/AdmissionRevenue";
import Leads from "@/pages/Leads";
import StaffMembers from "@/pages/StaffMembers";
import StaffStudents from "@/pages/StaffStudents";
import Leave from "@/pages/Leave";
import LinkedUserLedger from "@/pages/LinkedUserLedger";
import Messages from "@/pages/Messages";
import OfficeOverview from "@/pages/OfficeOverview";
import Activity from "@/pages/Activity";
import Branding from "@/pages/Branding";
import PlatformConsole from "@/pages/PlatformConsole";
import PlatformHome from "@/pages/PlatformHome";
import PlatformModulePage from "@/pages/PlatformModulePage";
import PermGate from "@/components/PermGate";

// Keeps the live theme in sync with the signed-in company. On logout it
// falls back to the public default branding.
function BrandingSync() {
  const { user } = useAuth();
  const { setBrandingData, resetBranding } = useBranding();
  useEffect(() => {
    if (user && user !== false) {
      if (user.branding) setBrandingData(user.branding, user.enabled_modules);
    } else if (user === false) {
      resetBranding();
    }
  }, [user, setBrandingData, resetBranding]);
  return null;
}

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="h-screen w-full flex items-center justify-center text-muted-foreground" data-testid="auth-loading">
        <div className="animate-pulse text-sm tracking-widest uppercase">Loading…</div>
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  // Platform owner belongs in the console, not the tenant app.
  if (user.scope === "platform") return <Navigate to="/platform" replace />;
  return children;
}

function PlatformProtected({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="h-screen w-full flex items-center justify-center text-muted-foreground">
        <div className="animate-pulse text-sm tracking-widest uppercase">Loading…</div>
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  if (user.scope !== "platform") return <Navigate to="/" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { user } = useAuth();
  if (user === null) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

// Module-level constants so the `roles` prop on PermGate doesn't allocate a
// fresh array each render — keeps PermGate / its children stable.
const SUPER_ADMIN_ONLY = Object.freeze(["super_admin"]);
const USER_ONLY = Object.freeze(["user"]);
const LEADS_ROLES = Object.freeze(["super_admin", "office_admin", "staff"]);
const STAFF_ONLY = Object.freeze(["staff"]);
const ADMIN_ROLES = Object.freeze(["super_admin", "office_admin"]);

// Hostnames whose entire surface is just the public admission form. Comma-
// separated env var, e.g. "apply.kmfoundation.online,admissions.example.com".
// When window.location.hostname matches one of these we bypass auth + the
// main router and mount only <PublicApplication /> — regardless of path.
const PUBLIC_APPLY_HOSTS = (process.env.REACT_APP_PUBLIC_APPLY_HOSTS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function isPublicApplyHost() {
  if (typeof window === "undefined") return false;
  const host = (window.location.hostname || "").toLowerCase();
  return PUBLIC_APPLY_HOSTS.includes(host);
}

/** Standalone shell used when the app is being served from a public-apply
 * domain. No auth provider, no sidebar, no other routes — just the form,
 * regardless of pathname. Query strings (e.g. ?ref=…) still pass through.
 * (PublicApplication mounts its own <Toaster> so we don't add one here.) */
function PublicApplyOnly() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<PublicApplication />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default function App() {
  if (isPublicApplyHost()) return <PublicApplyOnly />;
  return (
    <ThemeProvider>
      <BrandingProvider>
      <AuthProvider>
        <BrandingSync />
        <BrowserRouter>
        <Routes>
          <Route path="/apply" element={<PublicApplication />} />
          <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><AuthPage mode="register" /></PublicOnly>} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/platform" element={<PlatformProtected><PlatformHome /></PlatformProtected>} />
          <Route path="/platform/clients/*" element={<PlatformProtected><PlatformConsole /></PlatformProtected>} />
          <Route path="/platform/:moduleKey" element={<PlatformProtected><PlatformModulePage /></PlatformProtected>} />
          <Route element={<Protected><AppShell /></Protected>}>
            <Route path="/" element={<PermGate page="overview"><Dashboard /></PermGate>} />
            <Route path="/quick-entry" element={<PermGate page="quick_entry"><QuickEntry /></PermGate>} />
            <Route path="/transactions" element={<PermGate page="transactions"><Transactions /></PermGate>} />
            <Route path="/accounts" element={<PermGate page="accounts"><Accounts /></PermGate>} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/clients" element={<PermGate page="clients"><Clients pageScope="clients" /></PermGate>} />
            <Route path="/employees" element={<PermGate page="clients"><Clients pageScope="employees" /></PermGate>} />
            <Route path="/clients/:id" element={<PermGate page="clients"><ClientDetail /></PermGate>} />
            <Route path="/students" element={<PermGate page="students"><Students /></PermGate>} />
            <Route path="/my-students" element={<PermGate roles={STAFF_ONLY}><StaffStudents /></PermGate>} />
            <Route path="/students/:id" element={<PermGate page="students"><StudentDetail /></PermGate>} />
            <Route path="/colleges" element={<PermGate roles={SUPER_ADMIN_ONLY}><Colleges /></PermGate>} />
            <Route path="/admission-revenue" element={<PermGate roles={SUPER_ADMIN_ONLY}><AdmissionRevenue /></PermGate>} />
            <Route path="/leads" element={<PermGate roles={LEADS_ROLES} page="leads"><Leads /></PermGate>} />
            <Route path="/staff" element={<PermGate roles={SUPER_ADMIN_ONLY}><StaffMembers /></PermGate>} />
            <Route path="/office-overview" element={<PermGate roles={SUPER_ADMIN_ONLY}><OfficeOverview /></PermGate>} />
            <Route path="/leave" element={<PermGate roles={LEADS_ROLES} page="leave"><Leave /></PermGate>} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/detail" element={<AgentDetail />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/branding" element={<PermGate roles={SUPER_ADMIN_ONLY}><Branding /></PermGate>} />
            <Route path="/settings" element={<PermGate page="settings"><Settings /></PermGate>} />
            <Route path="/users" element={<PermGate roles={SUPER_ADMIN_ONLY}><Users /></PermGate>} />
            <Route path="/my-ledger" element={<PermGate roles={USER_ONLY}><LinkedUserLedger /></PermGate>} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/messages/:id" element={<Messages />} />
            <Route path="/expense-requests" element={<PermGate page="expense_requests"><ExpenseRequests /></PermGate>} />
            <Route path="/activity" element={<PermGate roles={ADMIN_ROLES}><Activity /></PermGate>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
      </BrandingProvider>
    </ThemeProvider>
  );
}

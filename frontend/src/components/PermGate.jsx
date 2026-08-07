import React, { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { canView } from "@/lib/perm";
import { toast } from "sonner";

/**
 * Wrap a protected route's element with one of:
 *   <PermGate page="students">         — gated by per-page permission
 *   <PermGate roles={["super_admin"]}> — gated by role (page-permission map ignored)
 * When the current user fails the check we redirect to / with a friendly toast.
 * Super admins always pass the per-page check.
 */
export default function PermGate({ page, roles, children }) {
  const { user } = useAuth();
  const location = useLocation();
  let allowed = true;
  if (user && user !== false) {
    if (roles && roles.length && !roles.includes(user.role)) {
      allowed = false;
    }
    // When both roles + page are given, enforce both. Super admins always
    // pass the per-page permission check.
    if (allowed && page && user.role !== "super_admin") {
      allowed = canView(user, page);
    }
  }

  useEffect(() => {
    if (user && user !== false && !allowed) {
      toast.error("You don't have access to this page anymore.");
    }
  }, [user, allowed]);

  if (user && user !== false && !allowed) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  return children;
}

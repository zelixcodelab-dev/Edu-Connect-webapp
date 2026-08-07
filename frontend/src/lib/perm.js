/* Page-level permission helpers.
 * Super admins always have full edit. Office admins are gated by user.permissions[page].
 * Falls back to "edit" if the field is missing (backward compatible with users
 * created before permissions shipped).
 */

export const PERMISSION_PAGES = [
  { key: "overview", label: "Overview" },
  { key: "quick_entry", label: "Quick entry" },
  { key: "transactions", label: "Transactions" },
  { key: "accounts", label: "Accounts" },
  { key: "clients", label: "Clients / Staff" },
  { key: "students", label: "Students" },
  { key: "leads", label: "Leads (CRM)" },
  { key: "leave", label: "Leave" },
  { key: "expense_requests", label: "Office expenses" },
  { key: "settings", label: "Settings" },
];

export const PERMISSION_LEVELS = [
  { value: "edit", label: "Edit", hint: "Full create / update / delete" },
  { value: "view", label: "View only", hint: "Read-only; write buttons hidden" },
  { value: "none", label: "No access", hint: "Page hidden from sidebar" },
];

export function permFor(user, pageKey) {
  if (!user) return "edit";
  if (user.role === "super_admin") return "edit";
  const map = user.permissions || {};
  return map[pageKey] || "edit";
}

export function canEdit(user, pageKey) {
  return permFor(user, pageKey) === "edit";
}

export function canView(user, pageKey) {
  return permFor(user, pageKey) !== "none";
}

/** Returns a default permission map with every page set to "edit". */
export function defaultPermissions() {
  return PERMISSION_PAGES.reduce((acc, p) => {
    acc[p.key] = "edit";
    return acc;
  }, {});
}

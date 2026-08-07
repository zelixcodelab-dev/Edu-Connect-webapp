// Shared lead pipeline metadata + datetime helpers for the Leads CRM.

export const LEAD_STATUSES = [
  "new",
  "not_connected",
  "interested",
  "follow_up",
  "converted",
  "application_submitted",
  "admission_confirmed",
  "fee_paid",
  "completed",
  "not_turned",
  "lost",
];

export const LEAD_STATUS_META = {
  new: { label: "New", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  not_connected: { label: "Not Connected", cls: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30" },
  // Legacy value kept so existing "contacted" rows still render nicely.
  contacted: { label: "Not Connected", cls: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30" },
  interested: { label: "Interested", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  follow_up: { label: "Follow-up", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  converted: { label: "Converted", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  application_submitted: { label: "Application Submitted", cls: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30" },
  admission_confirmed: { label: "Admission Confirmed", cls: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30" },
  fee_paid: { label: "Fee Paid", cls: "bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30" },
  completed: { label: "Completed", cls: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/40" },
  not_turned: { label: "Not Turned", cls: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30" },
  lost: { label: "Lost", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
};

// The five "post-conversion" journey stages — shown in the timeline & funnel
// after the lead has been converted to a student.
export const POST_CONVERSION_STATUSES = [
  "application_submitted",
  "admission_confirmed",
  "fee_paid",
  "completed",
  "not_turned",
];

export const LEAD_SOURCES = [
  { value: "walk_in", label: "Walk-in" },
  { value: "referral", label: "Referral" },
  { value: "social", label: "Social media" },
  { value: "website", label: "Website" },
  { value: "csv", label: "CSV import" },
  { value: "other", label: "Other" },
];

export function sourceLabel(v) {
  return LEAD_SOURCES.find((s) => s.value === v)?.label || "Other";
}

export function statusLabel(v) {
  return LEAD_STATUS_META[v]?.label || v || "—";
}

export const VISIT_STATUSES = [
  "scheduled",
  "assigned",
  "picked_up",
  "ongoing",
  "confused",
  "admission_taken",
  "fees_paid",
  "admission_letter_taken",
  "lost",
];

export const VISIT_STATUS_META = {
  scheduled: { label: "Scheduled", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  assigned: { label: "Assigned", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  picked_up: { label: "Picked Up", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  ongoing: { label: "Ongoing", cls: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30" },
  confused: { label: "Confused", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  admission_taken: { label: "Admission Taken", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  fees_paid: { label: "Fees Paid", cls: "bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30" },
  admission_letter_taken: { label: "Admission Letter Taken", cls: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/40" },
  lost: { label: "Lost", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
  // Legacy aliases so pre-migration docs still render meaningfully.
  admitted: { label: "Admission Taken", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  completed: { label: "Admission Letter Taken", cls: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/40" },
};

export const TRAVEL_MODES = ["Bus", "Train", "Flight", "Own vehicle", "Cab / Taxi", "Other"];

export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Shared constants + small helpers for the Student Detail page and its dialogs.
// Extracted to keep the page component small and let dialogs be reused.
import { Bank, UsersThree, Briefcase, IdentificationBadge } from "@phosphor-icons/react";
import { todayISO } from "@/lib/format";

export const STATUS_OPTIONS = [
  { value: "inquiry", label: "Inquiry" },
  { value: "enrolled", label: "Enrolled" },
  { value: "cancelled", label: "Cancelled" },
];

export const RECEIVED_IN = {
  college: { label: "College Acc.", icon: Bank, color: "bg-sky-100/60 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  bank: { label: "Other Bank Acc.", icon: Bank, color: "bg-muted text-foreground" },
  sub_agent: { label: "Sub Agent Acc.", icon: UsersThree, color: "bg-violet-100/60 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  associate: { label: "Associate Acc.", icon: Briefcase, color: "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  km: { label: "KM Acc.", icon: IdentificationBadge, color: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
};

// Order matters — drives the Fee Type dropdown in PaymentDialog.
// Legacy keys (booking_admission / tution / other) are preserved for
// historical payments so the UI / PDFs / XLSX exports keep showing the
// correct label even after the catalogue overhaul.
export const FEE_TYPE_LABELS = {
  application_fees: "Application Fees",
  registration_fees: "Registration Fees",
  admission_fees: "Admission Fees",
  tuition_fees: "Tuition Fees",
  uniform_fees: "Uniform Fees",
  other_fees: "Other Fees",
  //sc_adjusted: "SC Adjusted",
  // legacy
  booking_admission: "Booking / Admission Fees",
  tution: "Tution Fees",
  other: "Other Fees",
};

export const FEE_TYPE_OPTIONS = [
  { value: "application_fees", label: "Application Fees" },
  { value: "registration_fees", label: "Registration Fees" },
  { value: "admission_fees", label: "Admission Fees" },
  { value: "tuition_fees", label: "Tuition Fees" },
  { value: "uniform_fees", label: "Uniform Fees" },
  { value: "other_fees", label: "Other Fees" },
  //{ value: "sc_adjusted", label: "SC Adjusted" },
];

// Client types that can absorb an SC Adjusted entry (everyone).
export const SC_ADJUSTED_CLIENT_TYPES = [
  "sub_agent_associate",
  "associate_consultant",
];

// Maps a client_type → the received_in.type stored on the payment so the
// ledger / agent-payments aggregation keeps working.
export const CLIENT_TYPE_TO_RECEIVED_TYPE = {
  sub_agent_associate: "sub_agent",
  associate_consultant: "associate",
};

export const CLIENT_TYPE_LABEL = {
  sub_agent_associate: "Sub-Agent / Associate",
  associate_consultant: "Associate Consultant",
};

export const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "upi", label: "UPI" },
  { value: "other", label: "Other" },
];

export const SUB_AGENT_TYPES = [
  { value: "sub_agent", label: "Sub Agent" },
  { value: "associate", label: "Associate" },
];

export const PRESET_SCHEDULE_LABELS = ["1st Payment", "2nd Payment", "3rd Payment", "4th Payment"];

export const _uid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `adj-${Date.now()}-${Math.random()}`;

export function nextScheduleLabel(schedules) {
  const used = new Set((schedules || []).map((s) => s.label));
  for (const l of PRESET_SCHEDULE_LABELS) {
    if (!used.has(l)) return l;
  }
  return `${(schedules?.length || 0) + 1}th Payment`;
}

export function emptyPayment() {
  return {
    date: todayISO(),
    amount: "",
    fee_type: "admission_fees",
    received_in: { type: "college", name: "", account_id: "", client_id: "" },
    has_adjustment: false,
    adjustments: [],
    schedule_id: "",
    remarks: "",
  };
}

export function emptyEntry() {
  return {
    create_schedule: true,
    schedule: { label: "1st Payment", amount: "", remarks: "", due_date: "" },
    existing_schedule_id: "",
    log_payment: true,
    payment: emptyPayment(),
  };
}

// Options for the per-row "Kind" dropdown in the adjustments block.
// Each one maps to a different backend representation (see submitPay in
// StudentDetail.jsx) so the ledger / agent-payments aggregation keeps
// working.
export const ADJUSTMENT_KIND_OPTIONS = [
  { value: "km_foundation", label: "KM FOUNDATION" },
  { value: "sub_agent", label: "SUB AGENT" },
  { value: "associate_consultant", label: "ASSOCIATE CONSULTANT" },
];

export function emptyAdjustment(date) {
  return {
    _key: _uid(),
    kind: "km_foundation",
    amount: "",
    payment_date: date,
    payment_mode: "bank_transfer",
    sub_agent_type: "sub_agent",
    sub_agent_name: "",
    account_id: "",
    client_id: "",
    remarks: "",
  };
}

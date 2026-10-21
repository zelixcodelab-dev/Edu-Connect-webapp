// Shared payment-mode options for Service Charge payouts and adjustments.
export const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

export const PAYMENT_MODE_LABELS = Object.fromEntries(
  PAYMENT_MODES.map((m) => [m.value, m.label]),
);

// Client types eligible to receive a Service Charge payout.
export const SC_PAYOUT_CLIENT_TYPES = ["sub_agent_associate", "associate_consultant"];

export const SC_PAYOUT_CLIENT_TYPE_LABELS = {
  sub_agent_associate: "Sub-Associate",
  associate_consultant: "Associate Consultant",
};

// "Expense of" options for a recipient-linked expense (non-payout).
export const EXPENSE_OF_OPTIONS = [
  { value: "campus_visit", label: "Campus Visit" },
  { value: "personal", label: "Personal Exp." },
];

export const EXPENSE_OF_LABELS = Object.fromEntries(
  EXPENSE_OF_OPTIONS.map((o) => [o.value, o.label]),
);

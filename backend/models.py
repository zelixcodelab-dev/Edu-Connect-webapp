"""Pydantic request/response models for the API."""
from typing import List, Optional, Literal
from pydantic import BaseModel, Field, EmailStr


# ---------- Users ----------
OfficeCode = Literal["KM_BLR", "KM_TCR", "KM_KMLY"]
# Visibility scope on records: an office code → only that office's admins,
# or "ALL" → every office admin can see it. Records left as None remain
# private to the super_admin who owns them.
RecordOffice = Literal["KM_BLR", "KM_TCR", "KM_KMLY", "ALL"]
UserRole = Literal["super_admin", "office_admin", "user", "staff"]
ApprovalStatus = Literal["pending", "approved", "rejected"]

# Page-level permission keys controllable by super_admin (office_admin only).
PERMISSION_PAGES = (
    "overview", "quick_entry", "transactions", "accounts", "clients",
    "students", "expense_requests", "settings", "leads", "leave",
)
PermissionLevel = Literal["edit", "view", "none"]
DEFAULT_PERMISSIONS = {p: "edit" for p in PERMISSION_PAGES}

# "user" role is a stripped-down personal finance account: only their own
# Overview / Quick Entry / Transactions / Accounts / Settings. Everything
# else is hard-locked at "none".
USER_DEFAULT_PERMISSIONS = {
    "overview": "edit",
    "quick_entry": "edit",
    "transactions": "edit",
    "accounts": "edit",
    "settings": "edit",
    "expense_requests": "edit",  # users can submit (not approve) — backend enforces
    "clients": "none",
    "students": "none",
    "leads": "none",
    "leave": "none",
}

# "staff" role is a field/telecaller login: CRM Leads + their own Leave
# requests + Settings. No finance pages.
STAFF_DEFAULT_PERMISSIONS = {
    "overview": "view",
    "quick_entry": "none",
    "transactions": "none",
    "accounts": "none",
    "clients": "none",
    "students": "none",
    "expense_requests": "none",
    "settings": "edit",
    "leads": "edit",
    "leave": "edit",
}


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    business_name: Optional[str] = None
    office: Optional[OfficeCode] = None  # required for office_admin signups


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    business_name: Optional[str] = None
    currency: str = "USD"
    role: UserRole = "office_admin"
    office: Optional[OfficeCode] = None
    approval_status: ApprovalStatus = "approved"
    permissions: Optional[dict] = None
    # When role="user" this links the login account to a specific Client row
    # (sub_agent or associate_consultant). The linked client's name is used
    # to filter the user's Students view and their SC-earned totals.
    linked_client_id: Optional[str] = None
    linked_client_name: Optional[str] = None
    # Profile photo — resolved from the linked/own client row on read.
    # Relative /api/files/... path (or empty string when no photo uploaded).
    photo_url: Optional[str] = None
    created_at: str


class UserApprovalUpdate(BaseModel):
    status: Literal["approved", "rejected"]
    note: Optional[str] = None


class PermissionsUpdate(BaseModel):
    permissions: dict  # validated in the route handler


class SettingsUpdate(BaseModel):
    name: Optional[str] = None
    business_name: Optional[str] = None
    currency: Optional[Literal["USD", "INR"]] = None


# ---------- Accounts ----------
class AccountIn(BaseModel):
    name: str
    type: Literal["bank", "cash", "credit_card"]
    opening_balance: float = 0.0
    color: Optional[str] = "#10b981"


# ---------- Clients ----------
ClientType = Literal[
    "sub_agent_associate",
    "associate_consultant",
    "km_blr_office",
    "km_tcr_office",
    "km_kmly_office",
    "staff",
]


class ClientIn(BaseModel):
    name: str
    client_type: Optional[ClientType] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    # Staff-specific fields (also usable for sub-agents/associates if desired)
    office: Optional[OfficeCode] = None
    eligible_incentive: Optional[float] = None  # ₹ per admission for staff
    date_of_birth: Optional[str] = None  # ISO date
    # Employee/staff profile fields
    employee_id: Optional[str] = None  # auto-generated for staff if omitted
    address: Optional[str] = None
    place: Optional[str] = None
    photo_url: Optional[str] = None  # relative /api/files/... path
    # Cross-user visibility: when set to KM_BLR / KM_TCR / KM_KMLY, all office
    # admins of that office see the record. "ALL" → every office admin sees it.
    # Office admins always have this overridden server-side to their own office.
    home_office: Optional[RecordOffice] = None


# ---------- Expense Requests (Office Admin → Super Admin approval) ----------
class ExpenseRequestIn(BaseModel):
    amount: float = Field(gt=0)
    category_id: Optional[str] = None
    account_id: Optional[str] = None  # suggested account to debit; super admin can override on approval
    date: str
    description: Optional[str] = ""
    urgency: Literal["normal", "urgent"] = "normal"
    kind: Literal["expense", "salary"] = "expense"  # salary tagged separately for reporting


class ExpenseRequestApproval(BaseModel):
    account_id: str  # actual account to debit on approval
    note: Optional[str] = None


class ExpenseRequestRejection(BaseModel):
    note: Optional[str] = None


# ---------- Categories ----------
class CategoryIn(BaseModel):
    name: str
    type: Literal["income", "expense"]
    color: Optional[str] = "#78716c"
    icon: Optional[str] = "Tag"


# ---------- Transactions ----------
class TransactionIn(BaseModel):
    type: Literal["income", "expense"]
    amount: float
    account_id: str
    category_id: Optional[str] = None
    date: str
    description: Optional[str] = ""
    client_id: Optional[str] = None
    linked_invoice_id: Optional[str] = None


# ---------- Invoices ----------
class InvoiceItem(BaseModel):
    description: str
    quantity: float = 1.0
    unit_price: float = 0.0


class PreviousScPayment(BaseModel):
    has: bool = False
    amount: float = 0.0
    mode: Optional[Literal["cash", "bank_transfer", "upi", "cheque", "card", "other"]] = "bank_transfer"
    date: Optional[str] = None
    account_id: Optional[str] = None


class InvoiceIn(BaseModel):
    client_id: str
    invoice_number: str
    issue_date: str
    due_date: str
    items: List[InvoiceItem]
    tax_rate: float = 0.0
    notes: Optional[str] = ""
    status: Literal["draft", "sent", "paid", "overdue"] = "draft"
    campus_visit_no: Optional[str] = None
    student_name: Optional[str] = None
    course: Optional[str] = None
    visited_colleges: Optional[str] = None
    credit_amount: float = 0.0
    auto_log_expenses: bool = True
    expense_account_id: Optional[str] = None
    invoice_type: Literal["campus_visit", "service_charge"] = "campus_visit"
    college: Optional[str] = None
    academic_year: Optional[str] = None
    # When a service-charge invoice draws credit from a specific campus visit
    linked_visit_invoice_id: Optional[str] = None
    # Service-charge: a prior payment already received towards this SC
    previous_sc_payment: Optional[PreviousScPayment] = None

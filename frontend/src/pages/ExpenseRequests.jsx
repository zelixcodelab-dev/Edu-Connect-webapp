import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canEdit } from "@/lib/perm";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ReceiptX } from "@phosphor-icons/react";
import { todayISO } from "@/lib/format";
import NewRequestDialog from "@/components/expense-requests/NewRequestDialog";
import RequestCard from "@/components/expense-requests/RequestCard";
import ActionDialog from "@/components/expense-requests/ActionDialog";

const TABS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const emptyForm = () => ({
  amount: "", category_id: "", account_id: "", date: todayISO(),
  description: "", urgency: "normal", kind: "expense",
});

export default function ExpenseRequests() {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";
  const allowEdit = canEdit(user, "expense_requests");
  const currency = user?.currency || "INR";

  const [requests, setRequests] = useState([]);
  const [tab, setTab] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [actioning, setActioning] = useState(null); // {req, mode}
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [requesterAccounts, setRequesterAccounts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [approveAccountId, setApproveAccountId] = useState("");
  const [decisionNote, setDecisionNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/expense-requests${tab === "all" ? "" : `?status=${tab}`}`);
      setRequests(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("new") === "1" && !isSuper) {
      setCreateOpen(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, isSuper]);

  useEffect(() => {
    if (!isSuper) {
      Promise.all([api.get("/accounts"), api.get("/categories")])
        .then(([a, c]) => { setAccounts(a.data); setCategories(c.data); })
        .catch((err) => console.error("[expense-requests] account/category fetch failed:", err?.message || err));
    }
  }, [isSuper]);

  const expenseCategories = useMemo(() => categories.filter((c) => c.type === "expense"), [categories]);

  const submitCreate = async (e) => {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Amount must be > 0");
    if (!form.date) return toast.error("Pick a date");
    try {
      await api.post("/expense-requests", {
        ...form,
        amount: Number(form.amount),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
      });
      toast.success("Request submitted for approval");
      setCreateOpen(false);
      setForm(emptyForm());
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Submit failed");
    }
  };

  const openAction = async (req, mode) => {
    setActioning({ req, mode });
    setDecisionNote("");
    if (mode === "approve" && isSuper) {
      try {
        const { data } = await api.get(`/accounts?for_user_id=${req.requested_by_user_id}`);
        setRequesterAccounts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("[expense-requests] requester accounts fetch failed:", err?.message || err);
        setRequesterAccounts([]);
      }
      setApproveAccountId(req.account_id || "");
    }
  };

  const submitDecision = async () => {
    if (!actioning) return;
    const { req, mode } = actioning;
    try {
      if (mode === "approve") {
        const accId = approveAccountId || req.account_id;
        if (!accId) return toast.error("Account is required");
        await api.post(`/expense-requests/${req.id}/approve`, { account_id: accId, note: decisionNote });
        toast.success("Request approved · transaction created");
      } else {
        await api.post(`/expense-requests/${req.id}/reject`, { note: decisionNote });
        toast.success("Request rejected");
      }
      setActioning(null);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed");
    }
  };

  const cancelRequest = async (req) => {
    if (!window.confirm("Cancel this request?")) return;
    try {
      await api.delete(`/expense-requests/${req.id}`);
      toast.success("Cancelled");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed");
    }
  };

  return (
    <div className="space-y-6" data-testid="expense-requests-page">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
        <div>
          <p className="label-eyebrow">{isSuper ? "Approvals" : "My requests"}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {isSuper ? "Expense approvals" : (user?.role === "user" ? "My expense requests" : "Office expense requests")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isSuper
              ? "Review pending office-admin requests. Approving creates the expense transaction automatically."
              : (user?.role === "user"
                  ? "Submit an expense for a super admin to review and approve."
                  : "Raise an office expense or salary. A super admin will review and approve.")}
          </p>
        </div>
        {!isSuper && allowEdit && (
          <NewRequestDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            form={form}
            setForm={setForm}
            accounts={accounts}
            expenseCategories={expenseCategories}
            onSubmit={submitCreate}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2" data-testid="req-tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            data-testid={`req-tab-${t.value}`}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              tab === t.value
                ? "bg-amber-gradient text-white shadow-md shadow-orange-500/25"
                : "bg-card border border-border text-foreground hover:bg-muted/40"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground" data-testid="req-loading">Loading…</div>
      ) : requests.length === 0 ? (
        <Card className="p-10 text-center" data-testid="req-empty">
          <ReceiptX size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No {tab === "all" ? "" : tab} requests.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="req-list">
          {requests.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              isSuper={isSuper}
              currency={currency}
              onApprove={(req) => openAction(req, "approve")}
              onReject={(req) => openAction(req, "reject")}
              onCancel={cancelRequest}
            />
          ))}
        </div>
      )}

      <ActionDialog
        actioning={actioning}
        onClose={() => setActioning(null)}
        requesterAccounts={requesterAccounts}
        approveAccountId={approveAccountId}
        setApproveAccountId={setApproveAccountId}
        decisionNote={decisionNote}
        setDecisionNote={setDecisionNote}
        onConfirm={submitDecision}
      />
    </div>
  );
}

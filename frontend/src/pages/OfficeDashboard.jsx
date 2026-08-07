import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatMoney, greetingForNow } from "@/lib/format";
import {
  GraduationCap, Trophy, ClockClockwise, UserCircle,
} from "@phosphor-icons/react";
import { StatCard } from "@/components/dashboard/StatCard";
import StaffBreakdownList from "@/components/office-dashboard/StaffBreakdownList";
import {
  UpcomingBirthdaysCard, IncentiveRuleCard,
} from "@/components/office-dashboard/AsideCards";
import StaffPickerDialog from "@/components/office-dashboard/StaffPickerDialog";
import AnnouncementBanners from "@/components/messages/AnnouncementBanners";
import CrmAnalytics from "@/components/office-dashboard/CrmAnalytics";

const OFFICE_LABEL = { KM_BLR: "KM BLR", KM_TCR: "KM TCR", KM_KMLY: "KM KMLY" };

const TABS = [
  { value: "crm", label: "Lead CRM" },
  { value: "admissions", label: "Admissions & Incentive" },
];

const WINDOWS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

export default function OfficeDashboard({ superView = false }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [office, setOffice] = useState("KM_BLR");
  const currency = superView ? "INR" : (user?.currency || "INR");
  const [windowKey, setWindowKey] = useState("month");
  const [tab, setTab] = useState("admissions");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [allStaff, setAllStaff] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = superView
        ? `/dashboard/office-admin?window=${windowKey}&office=${office}`
        : `/dashboard/office-admin?window=${windowKey}`;
      const { data } = await api.get(url);
      setData(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [windowKey, superView, office]);

  useEffect(() => { load(); }, [load]);

  const markPaid = async (studentId) => {
    try {
      const { data } = await api.post(`/students/${studentId}/incentive/mark-paid`);
      toast.success(data?.expense_request_id
        ? "Incentive marked paid · salary request sent for approval"
        : "Incentive marked paid");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed");
    }
  };

  const unmarkPaid = async (studentId) => {
    try {
      await api.post(`/students/${studentId}/incentive/unmark-paid`);
      toast.success("Marked unpaid · any pending salary request cancelled");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed");
    }
  };

  const openAdmissionPicker = async () => {
    try {
      const { data } = await api.get("/clients");
      setAllStaff((data || []).filter((c) => c.client_type === "staff" && (!superView || c.office === office)));
      setPickerSearch("");
      setPickerOpen(true);
    } catch (err) {
      console.error("[office-dashboard] staff fetch failed:", err?.message || err);
      toast.error("Couldn't load staff list");
    }
  };

  const pickStaffAndEnrol = (staff) => {
    setPickerOpen(false);
    nav(`/students?new=1&staff=${encodeURIComponent(staff.name)}`);
  };

  const t = data?.totals || {};
  const breakdown = data?.staff_breakdown || [];
  const birthdays = data?.upcoming_birthdays || [];
  const windowLabel = WINDOWS.find((x) => x.value === windowKey)?.label?.toLowerCase();

  return (
    <div className="space-y-6 animate-fade-in" data-testid={superView ? "office-overview-page" : "office-dashboard"}>
      <AnnouncementBanners />
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          {superView ? (
            <>
              <p className="label-eyebrow">Office overview</p>
              <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2" data-testid="office-overview-title">
                {OFFICE_LABEL[office] || office} office
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-3" data-testid="office-switcher">
                {Object.keys(OFFICE_LABEL).map((o) => (
                  <button
                    key={o}
                    onClick={() => setOffice(o)}
                    data-testid={`office-switch-${o}`}
                    className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                      office === o
                        ? "bg-foreground text-background"
                        : "bg-card border border-border text-foreground hover:bg-muted/40"
                    }`}
                  >
                    {OFFICE_LABEL[o]}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="label-eyebrow">{user?.office ? `${OFFICE_LABEL[user.office] || user.office} · office` : "Office"}</p>
              <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2" data-testid="office-greeting">
                {greetingForNow()}, {user?.name?.split(" ")[0] || "there"}.
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Track admissions, staff incentives & lead performance.</p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="office-tabs">
          {TABS.map((tb) => (
            <button
              key={tb.value}
              onClick={() => setTab(tb.value)}
              data-testid={`office-tab-${tb.value}`}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                tab === tb.value
                  ? "bg-amber-gradient text-white shadow-md shadow-orange-500/25"
                  : "bg-card border border-border text-foreground hover:bg-muted/40"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </header>

      {tab === "crm" ? (
        <CrmAnalytics office={superView ? office : null} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" data-testid="window-toggle">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                onClick={() => setWindowKey(w.value)}
                data-testid={`window-${w.value}`}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                  windowKey === w.value
                    ? "bg-foreground text-background"
                    : "bg-card border border-border text-foreground hover:bg-muted/40"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard testId="stat-admissions" icon={GraduationCap} palette="amber"
              eyebrow="Admissions"
              value={loading ? "—" : (t.admissions ?? 0)}
              hint={`in ${windowLabel}`}
              onClick={() => nav("/students")}
            />
            <StatCard testId="stat-incentive-earned" icon={Trophy} palette="emerald"
              eyebrow="Incentive earned"
              value={loading ? "—" : formatMoney(t.incentive_earned ?? 0, currency)}
              hint={`${t.eligible_admissions ?? 0} eligible admissions`}
              onClick={() => nav("/expense-requests")}
            />
            <StatCard testId="stat-incentive-pending" icon={ClockClockwise} palette="rose"
              eyebrow="Incentive pending"
              value={loading ? "—" : formatMoney(t.incentive_pending ?? 0, currency)}
              hint="Yet to mark paid"
              onClick={() => nav("/expense-requests")}
            />
            <StatCard testId="stat-staff-count" icon={UserCircle} palette="violet"
              eyebrow="Staff on roster"
              value={loading ? "—" : (t.staff_count ?? 0)}
              hint="Add more in Staff"
              onClick={() => nav("/employees")}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <StaffBreakdownList
              breakdown={breakdown}
              loading={loading}
              currency={currency}
              onMarkPaid={markPaid}
              onUnmarkPaid={unmarkPaid}
            />

            <div className="space-y-4">
              <UpcomingBirthdaysCard birthdays={birthdays} />
              <IncentiveRuleCard onAddAdmission={openAdmissionPicker} />
            </div>
          </div>
        </>
      )}

      <StaffPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        search={pickerSearch}
        onSearchChange={setPickerSearch}
        staff={allStaff}
        onPick={pickStaffAndEnrol}
      />
    </div>
  );
}

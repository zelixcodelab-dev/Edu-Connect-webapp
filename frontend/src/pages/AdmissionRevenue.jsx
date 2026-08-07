import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CurrencyInr, Lock, TrendUp, Coins, CheckCircle, Warning,
  ArrowsClockwise, GraduationCap, Buildings, Users, CaretDown,
} from "@phosphor-icons/react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import PinLock from "@/components/PinLock";
import CollegeCoursesDrilldown from "@/components/admission-revenue/CollegeCoursesDrilldown";

/** Wrapper: gate the whole dashboard behind a 4-digit PIN (per super admin,
 * per browser-tab session). Non-super-admin fall-through renders the
 * inner component which shows its own "no access" state. */
export default function AdmissionRevenueGate() {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";
  if (!isSuper) return <AdmissionRevenue />;
  return (
    <PinLock
      basePath="admission-revenue"
      title="Admission Revenue"
      subtitle="This page shows confidential per-college revenue. Enter your 4-digit PIN to unlock."
    >
      <AdmissionRevenue />
    </PinLock>
  );
}

/** Super-admin-only revenue dashboard. Aggregates college-side SC across
 * enrolled admissions for the selected Indian financial year (Apr → Mar).
 * Presents three tiers of confidence:
 *   Committed  → all enrolled admissions in FY (accrued rev at enrollment)
 *   Accrued    → committed + at least 1 recorded payment
 *   Confirmed  → committed + fully paid OR status="completed"
 */
function AdmissionRevenue() {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";
  const currency = user?.currency || "INR";
  const [fyOptions, setFyOptions] = useState([]);
  const [fy, setFy] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Drill-down state — the college whose course-wise breakdown is currently
  // being shown in the modal (null = closed).
  const [drillCollege, setDrillCollege] = useState(null);

  useEffect(() => {
    if (!isSuper) return;
    (async () => {
      try {
        const r = await api.get("/admission-revenue/fy-options");
        setFyOptions(r.data?.options || []);
        setFy(r.data?.current || "");
      } catch {
        toast.error("Could not load financial-year list");
      }
    })();
  }, [isSuper]);

  const load = async (fyLabel) => {
    if (!fyLabel) return;
    setLoading(true);
    try {
      const r = await api.get("/admission-revenue/summary", { params: { fy: fyLabel } });
      setData(r.data);
    } catch (err) {
      toast.error("Could not load revenue summary");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (fy) load(fy); /* eslint-disable-next-line */ }, [fy]);

  const fmtInr = (n) => formatMoney(n || 0, "INR").replace(/^[₹$€£¥]\s?/, "");

  const tiers = data?.tiers || {};

  if (!isSuper) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground" data-testid="rev-no-access">
        <Warning size={32} className="mx-auto text-muted-foreground/50 mb-3" />
        Only super admins can view Admission Revenue.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admission-revenue-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow flex items-center gap-1.5">
            <Lock size={11} weight="fill" /> Confidential · Super Admin
          </p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2 flex items-center gap-2">
            <GraduationCap size={30} className="text-amber-700 dark:text-amber-400" />
            Admission Revenue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Service charges received from colleges for every enrolled admission —
            aggregated by Indian financial year (Apr → Mar).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Financial year</label>
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="w-36" data-testid="fy-select">
              <SelectValue placeholder="Pick FY" />
            </SelectTrigger>
            <SelectContent>
              {fyOptions.map((y) => (
                <SelectItem key={y} value={y} data-testid={`fy-opt-${y}`}>
                  FY {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => load(fy)}
            className="h-10 w-10"
            data-testid="fy-refresh-btn"
            title="Refresh"
          >
            <ArrowsClockwise size={14} />
          </Button>
        </div>
      </header>

      {loading ? (
        <Card className="p-12 text-center text-sm text-muted-foreground bg-card border border-border shadow-none">
          Loading revenue…
        </Card>
      ) : !data ? (
        <Card className="p-12 text-center text-sm text-muted-foreground bg-card border border-border shadow-none">
          No data for this financial year.
        </Card>
      ) : (
        <>
          {/* Three-tier KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <TierCard
              tier="committed"
              label="Committed"
              hint="All enrolled admissions in FY"
              icon={TrendUp}
              accent="orange"
              count={tiers.committed?.count}
              amount={tiers.committed?.amount}
              scOut={tiers.committed?.sc_out}
              net={tiers.committed?.net}
              fmtInr={fmtInr}
            />
            <TierCard
              tier="accrued"
              label="Accrued"
              hint="Committed + at least 1 payment"
              icon={Coins}
              accent="amber"
              count={tiers.accrued?.count}
              amount={tiers.accrued?.amount}
              scOut={tiers.accrued?.sc_out}
              net={tiers.accrued?.net}
              fmtInr={fmtInr}
            />
            <TierCard
              tier="confirmed"
              label="Confirmed"
              hint="Fully paid or completed"
              icon={CheckCircle}
              accent="emerald"
              count={tiers.confirmed?.count}
              amount={tiers.confirmed?.amount}
              scOut={tiers.confirmed?.sc_out}
              net={tiers.confirmed?.net}
              fmtInr={fmtInr}
            />
          </div>

          {/* Formula legend */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground" data-testid="rev-formula-legend">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500/70"></span>
              <strong className="text-foreground">In</strong> = SC received from college
            </span>
            <span className="text-muted-foreground/40">−</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500/70"></span>
              <strong className="text-foreground">Out</strong> = SC Earned by sub-agent
            </span>
            <span className="text-muted-foreground/40">=</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500/70"></span>
              <strong className="text-foreground">Net revenue</strong>
            </span>
          </div>

          {/* Zero-rate hint */}
          {(tiers.committed?.count || 0) > 0 && (tiers.committed?.amount || 0) === 0 && (
            <Card className="p-4 border border-amber-500/40 bg-amber-500/5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2" data-testid="rev-zero-rate-hint">
              <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
              <div>
                <strong>{tiers.committed.count}</strong> admission(s) counted but zero rupees
                attributed — no SC rates set on the matching (college × course).
                Head to <a href="/colleges" className="underline">Colleges</a> and set the
                per-course amount for each partner college.
              </div>
            </Card>
          )}

          {/* Split tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownTable
              title="By College"
              icon={Buildings}
              keyField="college"
              rows={data.by_college || []}
              fmtInr={fmtInr}
              testid="by-college"
              onRowClick={(row) => setDrillCollege(row.college)}
            />
            <ClientOfficeTable
              rows={data.by_client || []}
              fmtInr={fmtInr}
            />
          </div>

          <CollegeCoursesDrilldown
            college={drillCollege}
            fy={fy}
            onClose={() => setDrillCollege(null)}
          />

          <p className="text-[11px] text-muted-foreground text-right">
            Range · {data.range?.start} → {data.range?.end}. Only students with
            status <code className="px-1 rounded bg-muted">enrolled</code> or
            <code className="px-1 rounded bg-muted ml-1">completed</code> are counted.
          </p>
        </>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

const ACCENT_MAP = {
  orange: {
    ring: "border-orange-500/40 bg-orange-500/5",
    tag: "bg-orange-500/15 text-orange-800 dark:text-orange-300",
    iconWrap: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  },
  amber: {
    ring: "border-amber-500/40 bg-amber-500/5",
    tag: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    iconWrap: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  emerald: {
    ring: "border-emerald-500/40 bg-emerald-500/5",
    tag: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    iconWrap: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
};

function TierCard({ tier, label, hint, icon: Icon, accent, count, amount, scOut, net, fmtInr }) {
  const a = ACCENT_MAP[accent] || ACCENT_MAP.orange;
  const netVal = Number(net || 0);
  const netColor = netVal >= 0
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-rose-700 dark:text-rose-400";
  return (
    <Card
      className={`p-5 border ${a.ring} shadow-none`}
      data-testid={`tier-${tier}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${a.iconWrap}`}>
          <Icon size={18} weight="duotone" />
        </div>
        <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${a.tag}`}>
          {label}
        </span>
      </div>
      <div className="mt-4 space-y-2.5">
        {/* Gross in */}
        <div>
          <div
            className="text-2xl sm:text-3xl font-display tabular-nums flex items-center gap-1"
            data-testid={`tier-${tier}-amount`}
          >
            <CurrencyInr size={22} weight="regular" className="text-muted-foreground" />
            {fmtInr(amount)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            <span className="tabular-nums font-medium text-foreground" data-testid={`tier-${tier}-count`}>{count || 0}</span> admission{(count || 0) === 1 ? "" : "s"} · {hint}
          </div>
        </div>
        {/* SC Out + Net */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              SC Out
            </div>
            <div
              className="text-sm tabular-nums font-medium text-rose-700 dark:text-rose-400 flex items-center gap-0.5"
              data-testid={`tier-${tier}-sc-out`}
            >
              <CurrencyInr size={11} />
              {fmtInr(scOut)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Net revenue
            </div>
            <div
              className={`text-base tabular-nums font-semibold flex items-center justify-end gap-0.5 ${netColor}`}
              data-testid={`tier-${tier}-net`}
            >
              <CurrencyInr size={12} weight="bold" />
              {fmtInr(netVal)}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function BreakdownTable({ title, icon: Icon, keyField, rows, fmtInr, testid, onRowClick }) {
  const clickable = typeof onRowClick === "function";
  return (
    <Card className="p-5 border border-border bg-card shadow-none" data-testid={`table-${testid}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
          <Icon size={16} className="text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-base font-semibold">{title}</h3>
          {clickable && (
            <p className="text-[11px] text-muted-foreground">
              Click a row to see the course-wise breakdown.
            </p>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {rows.length} row{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">No admissions yet.</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto -mx-1">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 bg-card">
              <tr>
                <th className="text-left py-1.5 pl-1 font-semibold">{keyField}</th>
                <th className="text-right py-1.5 font-semibold w-10">#</th>
                <th className="text-right py-1.5 font-semibold whitespace-nowrap">In (₹)</th>
                <th className="text-right py-1.5 font-semibold whitespace-nowrap">Out (₹)</th>
                <th className="text-right py-1.5 pr-1 font-semibold whitespace-nowrap">Net (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r, idx) => {
                const netVal = Number(r.net || 0);
                const netCls = netVal > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : netVal < 0
                    ? "text-rose-700 dark:text-rose-400"
                    : "text-muted-foreground";
                return (
                  <tr
                    key={`${r[keyField]}-${idx}`}
                    data-testid={`row-${testid}-${idx}`}
                    onClick={clickable ? () => onRowClick(r) : undefined}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(r);
                            }
                          }
                        : undefined
                    }
                    className={`transition-colors ${
                      clickable
                        ? "hover:bg-amber-500/8 focus:bg-amber-500/10 focus:outline-none cursor-pointer"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <td className="py-1.5 pl-1 truncate max-w-[180px]" title={r[keyField]}>
                      {r[keyField]}
                    </td>
                    <td className="text-right py-1.5 tabular-nums text-muted-foreground">
                      {r.count}
                    </td>
                    <td className="text-right py-1.5 tabular-nums whitespace-nowrap pl-3">
                      {fmtInr(r.amount)}
                    </td>
                    <td className="text-right py-1.5 tabular-nums whitespace-nowrap text-rose-700/80 dark:text-rose-400/80 pl-3">
                      {fmtInr(r.sc_out)}
                    </td>
                    <td className={`text-right py-1.5 pr-1 tabular-nums whitespace-nowrap font-medium pl-3 ${netCls}`}>
                      {fmtInr(netVal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


/* ── By Client / Office table ────────────────────────────────────────────── */

// Short office label as user requested — "KM BLR OFFICE", etc.
// Note: the "ALL" and "—" groups are semantic buckets rather than physical
// offices — clients with `home_office=ALL` are typically Associate
// Consultants operating across every office, and rows with no resolvable
// office are almost always Sub / Associates. We surface those meanings in
// the group header so the super admin can read the layout at a glance.
const OFFICE_HEADING = {
  KM_BLR: "KM BLR OFFICE",
  KM_TCR: "KM TCR OFFICE",
  KM_KMLY: "KM KMLY OFFICE",
  ALL: "ASSOCIATE CONSULTANTS",
};
function officeHeading(code) {
  if (!code || code === "—") return "SUB / ASSOCIATES";
  return OFFICE_HEADING[code] || code;
}
const OFFICE_TONE = {
  KM_BLR: "border-orange-500/40 bg-orange-500/5 text-orange-800 dark:text-orange-300",
  KM_TCR: "border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300",
  KM_KMLY: "border-sky-500/40 bg-sky-500/5 text-sky-800 dark:text-sky-300",
  ALL: "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300",
};

// Human-readable tag for the client_type column stored on clients docs.
const CLIENT_TYPE_LABEL = {
  associate_consultant: "Associate Consultant",
  sub_agent_associate: "Sub / Associate",
  staff: "Staff",
  km_blr_office: "KM BLR Office",
  km_tcr_office: "KM TCR Office",
  km_kmly_office: "KM KMLY Office",
};
const CLIENT_TYPE_TONE = {
  associate_consultant: "bg-amber-500/12 text-amber-800 dark:text-amber-300 border-amber-500/40",
  sub_agent_associate: "bg-orange-500/12 text-orange-800 dark:text-orange-300 border-orange-500/40",
  staff: "bg-sky-500/12 text-sky-800 dark:text-sky-300 border-sky-500/40",
  km_blr_office: "bg-muted text-muted-foreground border-border",
  km_tcr_office: "bg-muted text-muted-foreground border-border",
  km_kmly_office: "bg-muted text-muted-foreground border-border",
};

function ClientTypeBadge({ type }) {
  const label = CLIENT_TYPE_LABEL[type];
  if (!label) return null;
  const tone = CLIENT_TYPE_TONE[type] || "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${tone}`}
      data-testid={`client-type-${type}`}
    >
      {label}
    </span>
  );
}

/**
 * Groups the by_client rows by office and renders a sectioned list. Each
 * section is a collapsible header — click the chevron to expand and reveal
 * the clients (with client-type tag). Default state = all collapsed so the
 * super admin sees only the office totals at a glance.
 */
function ClientOfficeTable({ rows, fmtInr }) {
  // Group rows by office → { office_code: [rows...] } preserving order.
  const groups = React.useMemo(() => {
    const map = new Map();
    for (const r of rows || []) {
      const key = r.office || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    // Sort each section by net desc (already sorted server-side, but a
    // consistent re-sort per group is a defensive nicety).
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.net || 0) - (a.net || 0));
    }
    // Preserve office ordering by best group revenue.
    return Array.from(map.entries()).sort((a, b) => {
      const na = a[1].reduce((n, r) => n + (r.net || 0), 0);
      const nb = b[1].reduce((n, r) => n + (r.net || 0), 0);
      return nb - na;
    });
  }, [rows]);

  // Which offices are expanded. Default: all collapsed.
  const [expanded, setExpanded] = React.useState(() => new Set());
  const toggle = (office) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(office)) next.delete(office);
      else next.add(office);
      return next;
    });
  };
  const allExpanded = groups.length > 0 && groups.every(([o]) => expanded.has(o));
  const toggleAll = () => {
    if (allExpanded) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(groups.map(([o]) => o)));
    }
  };

  return (
    <Card
      className="p-5 border border-border bg-card shadow-none"
      data-testid="table-by-client"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
          <Users size={16} className="text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-base font-semibold">By Client / Office</h3>
          <p className="text-[11px] text-muted-foreground">
            Revenue = In (from college) − Out (to sub-agent). Tap an office to expand.
          </p>
        </div>
        {groups.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            data-testid="office-toggle-all"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}
        <span className="text-[11px] text-muted-foreground ml-2">
          {(rows || []).length} row{(rows || []).length === 1 ? "" : "s"}
        </span>
      </div>

      {(rows || []).length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">No admissions yet.</p>
      ) : (
        <div className="max-h-[520px] overflow-y-auto -mx-1 pr-1 space-y-3">
          {groups.map(([office, list]) => {
            const groupNet = list.reduce((n, r) => n + (r.net || 0), 0);
            const groupCount = list.reduce((n, r) => n + (r.count || 0), 0);
            const tone = OFFICE_TONE[office] || "border-border bg-muted text-muted-foreground";
            const groupNetCls = groupNet > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : groupNet < 0
                ? "text-rose-700 dark:text-rose-400"
                : "text-muted-foreground";
            const isOpen = expanded.has(office);
            return (
              <section key={office} data-testid={`office-group-${office}`}>
                <button
                  type="button"
                  onClick={() => toggle(office)}
                  aria-expanded={isOpen}
                  aria-controls={`office-body-${office}`}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded border ${tone} hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-amber-500 transition`}
                  data-testid={`office-toggle-${office}`}
                >
                  <CaretDown
                    size={13}
                    weight="bold"
                    className={`shrink-0 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`}
                    data-testid={`office-caret-${office}`}
                  />
                  <span className="text-[10px] uppercase tracking-[0.08em] font-semibold">
                    {officeHeading(office)}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums">
                    <span className="opacity-70 mr-2">{groupCount} · </span>
                    <span className={`font-semibold ${groupNetCls}`}>₹ {fmtInr(groupNet)}</span>
                  </span>
                </button>
                {isOpen && (
                  <table
                    id={`office-body-${office}`}
                    className="w-full text-sm mt-1"
                    data-testid={`office-body-${office}`}
                  >
                    <tbody className="divide-y divide-border/60">
                      {list.map((r, idx) => {
                        const netVal = Number(r.net || 0);
                        const netCls = netVal > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : netVal < 0
                            ? "text-rose-700 dark:text-rose-400"
                            : "text-muted-foreground";
                        return (
                          <tr
                            key={`${r.client}-${idx}`}
                            className="hover:bg-muted/40 transition-colors"
                            data-testid={`row-by-client-${office}-${idx}`}
                          >
                            <td className="py-2 pl-6">
                              <div className="flex flex-col gap-1 min-w-0">
                                <span
                                  className="truncate font-medium text-foreground"
                                  title={r.client}
                                >
                                  {r.client}
                                </span>
                                {r.client_type && (
                                  <div className="flex">
                                    <ClientTypeBadge type={r.client_type} />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="text-right py-2 tabular-nums text-muted-foreground w-12 whitespace-nowrap">
                              {r.count}
                            </td>
                            <td
                              className={`text-right py-2 pr-1 tabular-nums font-semibold whitespace-nowrap pl-3 ${netCls}`}
                            >
                              {fmtInr(netVal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

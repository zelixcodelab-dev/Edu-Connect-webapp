import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend, AreaChart, Area,
} from "recharts";
import {
  Target, GraduationCap, TrendUp, ClockCountdown, XCircle,
} from "@phosphor-icons/react";
import AnimatedNumber from "@/components/dashboard/AnimatedNumber";
import { ChartTooltip, activePieShape, usePieActive, CHART_CURSOR, CHART_CURSOR_LINE } from "@/components/dashboard/ChartInteractions";

const REDUCE_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const CHART_ANIM = !REDUCE_MOTION;

const PIE_COLORS = ["#f97316", "#0ea5e9", "#10b981", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6", "#6366f1"];
const FUNNEL_COLORS = { Leads: "#64748b", Interested: "#a855f7", Converted: "#10b981", Positive: "#0ea5e9", Lost: "#ef4444" };

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 10,
  fontSize: 12,
  color: "hsl(var(--foreground))",
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
};
const axisTick = { fontSize: 11, fill: "#94a3b8" };

const monthLabel = (ym) => {
  const [y, m] = (ym || "").split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return isNaN(d) ? ym : d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

function Kpi({ icon: Icon, label, value, tone, ring }) {
  return (
    <Card className="p-4 border border-border bg-card rounded-xl shadow-none" data-testid={`crm-kpi-${label.replace(/\W+/g, "-").toLowerCase()}`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${ring}`}>
        <Icon size={18} weight="duotone" className={tone} />
      </div>
      <p className={`font-display text-2xl tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </Card>
  );
}

function ChartCard({ eyebrow, title, children, testid, empty }) {
  return (
    <Card className="border border-border bg-card rounded-xl shadow-none p-5" data-testid={testid}>
      <p className="label-eyebrow">{eyebrow}</p>
      <h3 className="font-display text-lg leading-none mt-1 mb-4">{title}</h3>
      {empty ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
      ) : children}
    </Card>
  );
}

export default function CrmAnalytics({ office = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const coursePie = usePieActive();
  const lostPie = usePieActive();

  useEffect(() => {
    setLoading(true);
    const url = office ? `/leads/analytics?office=${office}` : "/leads/analytics";
    api.get(url)
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [office]);

  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground">Loading analytics…</div>;
  if (!data) return <Card className="p-10 text-center text-sm text-muted-foreground">Couldn't load CRM analytics.</Card>;

  const k = data.kpis || {};
  const funnel = data.funnel || [];
  const college = data.college_wise || [];
  const course = data.course_wise || [];
  const monthly = (data.monthly_trend || []).map((m) => ({ ...m, label: monthLabel(m.month) }));
  const lost = data.lost_reasons || [];
  const byStatus = data.by_status || {};

  return (
    <div className="space-y-5" data-testid="crm-analytics">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 dash-stagger">
        <Kpi icon={Target} label="Total leads" value={<AnimatedNumber value={k.total_leads ?? 0} format={(n) => String(Math.round(n))} />} tone="text-orange-600 dark:text-orange-400" ring="bg-orange-100/60 dark:bg-orange-500/15" />
        <Kpi icon={GraduationCap} label="Total admissions" value={<AnimatedNumber value={k.total_admissions ?? 0} format={(n) => String(Math.round(n))} />} tone="text-emerald-600 dark:text-emerald-400" ring="bg-emerald-100/60 dark:bg-emerald-500/15" />
        <Kpi icon={TrendUp} label="Conversion rate" value={<AnimatedNumber value={k.conversion_rate ?? 0} format={(n) => `${Math.round(n)}%`} />} tone="text-sky-600 dark:text-sky-400" ring="bg-sky-100/60 dark:bg-sky-500/15" />
        <Kpi icon={ClockCountdown} label="Pending follow-ups" value={<AnimatedNumber value={k.pending_followups ?? 0} format={(n) => String(Math.round(n))} />} tone="text-amber-600 dark:text-amber-400" ring="bg-amber-100/60 dark:bg-amber-500/15" />
        <Kpi icon={XCircle} label="Lost leads" value={<AnimatedNumber value={k.lost_leads ?? 0} format={(n) => String(Math.round(n))} />} tone="text-rose-600 dark:text-rose-400" ring="bg-rose-100/60 dark:bg-rose-500/15" />
      </div>

      {/* Funnel + Monthly trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard eyebrow="Pipeline" title="Lead funnel" testid="crm-funnel" empty={funnel.every((f) => !f.value)}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={funnel} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="stage" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={CHART_CURSOR} animationDuration={CHART_ANIM ? 200 : 0} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={64} activeBar={{ fillOpacity: 1 }} isAnimationActive={CHART_ANIM} animationDuration={900}>
                {funnel.map((f) => <Cell key={f.stage} fill={FUNNEL_COLORS[f.stage] || "#f97316"} fillOpacity={0.88} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard eyebrow="Growth" title="Monthly seat-closing trend" testid="crm-monthly" empty={monthly.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={monthly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="seatGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={CHART_CURSOR_LINE} animationDuration={CHART_ANIM ? 200 : 0} />
              <Area type="monotone" dataKey="value" name="Admissions" stroke="#f97316" strokeWidth={2.5} fill="url(#seatGrad)" dot={{ r: 3, fill: "#f97316" }} activeDot={{ r: 5, strokeWidth: 2 }} isAnimationActive={CHART_ANIM} animationDuration={900} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* College-wise + Course-wise */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard eyebrow="Performance" title="College-wise admissions" testid="crm-college" empty={college.length === 0}>
          <ResponsiveContainer width="100%" height={Math.max(240, college.length * 34)}>
            <BarChart data={college} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={axisTick} axisLine={false} tickLine={false} width={120} />
              <Tooltip content={<ChartTooltip />} cursor={CHART_CURSOR} animationDuration={CHART_ANIM ? 200 : 0} />
              <Bar dataKey="value" name="Admissions" fill="#0ea5e9" radius={[0, 6, 6, 0]} maxBarSize={26} activeBar={{ fillOpacity: 1 }} fillOpacity={0.88} isAnimationActive={CHART_ANIM} animationDuration={900} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard eyebrow="Demand" title="Course-wise admissions" testid="crm-course" empty={course.length === 0}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={course} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={48} paddingAngle={2} activeIndex={coursePie.activeIndex} activeShape={activePieShape} onMouseEnter={coursePie.onEnter} onMouseLeave={coursePie.onLeave} isAnimationActive={CHART_ANIM} animationDuration={900}>
                {course.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={coursePie.cellOpacity(i)} />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} animationDuration={CHART_ANIM ? 200 : 0} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Lost reasons + Pipeline snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard eyebrow="Drop-off" title="Lost reasons" testid="crm-lost" empty={lost.length === 0}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={lost} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={48} paddingAngle={2} activeIndex={lostPie.activeIndex} activeShape={activePieShape} onMouseEnter={lostPie.onEnter} onMouseLeave={lostPie.onLeave} isAnimationActive={CHART_ANIM} animationDuration={900}>
                {lost.map((_, i) => <Cell key={i} fill={PIE_COLORS[(i + 4) % PIE_COLORS.length]} fillOpacity={lostPie.cellOpacity(i)} />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} animationDuration={CHART_ANIM ? 200 : 0} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard eyebrow="Snapshot" title="Pipeline by stage" testid="crm-pipeline-snapshot">
          <div className="space-y-2.5">
            {[
              ["new", "New", "bg-slate-400"],
              ["not_connected", "Not Connected", "bg-slate-500"],
              ["interested", "Interested", "bg-violet-500"],
              ["follow_up", "Follow-up", "bg-sky-500"],
              ["converted", "Converted", "bg-emerald-500"],
              ["application_submitted", "Application", "bg-teal-500"],
              ["admission_confirmed", "Admission", "bg-indigo-500"],
              ["fee_paid", "Fee Paid", "bg-lime-500"],
              ["completed", "Completed", "bg-green-600"],
              ["not_turned", "Not Turned", "bg-orange-500"],
              ["lost", "Lost", "bg-rose-500"],
            ].map(([key, label, bar]) => {
              const total = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
              const v = byStatus[key] || 0;
              return (
                <div key={key} className="flex items-center gap-3" data-testid={`crm-snap-${key}`}>
                  <span className="w-24 text-xs text-muted-foreground shrink-0">{label}</span>
                  <div className="flex-1 h-6 rounded-md bg-muted/60 overflow-hidden">
                    <div className={`h-full ${bar} rounded-md transition-all`} style={{ width: `${Math.round((v / total) * 100)}%` }} />
                  </div>
                  <span className="w-8 text-right text-sm font-medium tabular-nums text-foreground">{v}</span>
                </div>
              );
            })}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

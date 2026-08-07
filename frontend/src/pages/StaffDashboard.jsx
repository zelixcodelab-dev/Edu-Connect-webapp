import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { buildApplyUrl, navigateToApply } from "@/lib/applyUrl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Target, ClockCountdown, GraduationCap, CalendarCheck, UserPlus, PaperPlaneTilt,
  Copy, ShareNetwork, ArrowRight, Student as StudentIcon,
} from "@phosphor-icons/react";
import LeaveRequestDialog from "@/components/leave/LeaveRequestDialog";

function StatTile({ icon: Icon, label, value, tone, onClick, testid, ariaLabel }) {
  const tones = {
    amber: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
    rose: "bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300",
    emerald: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    sky: "bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300",
  };
  const inner = (
    <>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tones[tone]}`}><Icon size={20} weight="duotone" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-2xl font-display font-semibold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
      {onClick && (
        <span aria-hidden="true"
          className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-all text-muted-foreground shrink-0"
        >
          <ArrowRight size={14} weight="bold" />
        </span>
      )}
    </>
  );
  if (!onClick) {
    return <Card className="p-4 flex items-center gap-3" data-testid={testid}>{inner}</Card>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-label={ariaLabel || label}
      className="group text-left w-full rounded-xl border border-border bg-card p-4 flex items-center gap-3 cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:ring-2 hover:ring-orange-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      {inner}
    </button>
  );
}

function MiniTile({ label, value, onClick, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-label={`View ${label} leads`}
      className="group text-left rounded-lg bg-muted/40 p-3 hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      <div className="flex items-start justify-between">
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        <span aria-hidden="true"
          className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-muted-foreground"
        >
          <ArrowRight size={12} weight="bold" />
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </button>
  );
}

function ActionButton({ icon: Icon, label, sub, onClick, testid }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
      className="text-left rounded-xl border border-border bg-card p-4 hover:border-orange-500/40 hover:shadow-md transition-all flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl bg-amber-gradient text-white flex items-center justify-center shrink-0"><Icon size={20} weight="bold" /></div>
      <div className="min-w-0">
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{sub}</p>
      </div>
    </button>
  );
}

export default function StaffDashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [stats, setStats] = useState({ total: 0, by_status: {}, missed: 0 });
  const [referrals, setReferrals] = useState([]);
  const [leaveStats, setLeaveStats] = useState({ pending_mine: 0 });
  const [leaveOpen, setLeaveOpen] = useState(false);

  const refreshLeave = () => api.get("/leave/stats").then(({ data }) => setLeaveStats(data)).catch(() => {});

  useEffect(() => {
    api.get("/leads/stats").then(({ data }) => setStats(data)).catch((e) => console.error("[staff] stats", e));
    api.get("/students/me/referrals").then(({ data }) => setReferrals(data)).catch((e) => console.error("[staff] referrals", e));
    refreshLeave();
  }, []);

  const referralLink = buildApplyUrl(user?.id);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(referralLink); toast.success("Referral link copied"); }
    catch { toast.error("Copy failed — long-press to copy"); }
  };
  const shareLink = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "Apply now", url: referralLink }); } catch { /* cancelled */ }
    } else { copyLink(); }
  };

  return (
    <div className="space-y-6" data-testid="staff-dashboard">
      <div>
        <p className="label-eyebrow">Welcome back</p>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">{user?.name?.split(" ")[0] || "Staff"}&apos;s desk</h1>
        <p className="text-sm text-muted-foreground mt-1">Your leads, referrals and quick actions in one place.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="staff-stats">
        <StatTile icon={Target} label="My leads" value={stats.total} tone="amber"
          testid="staff-stat-leads" onClick={() => nav("/leads")} />
        <StatTile icon={ClockCountdown} label="Missed follow-ups" value={stats.missed} tone="rose"
          testid="staff-stat-missed" onClick={() => nav("/leads?filter=missed")} />
        <StatTile icon={GraduationCap} label="Students referred" value={referrals.length} tone="emerald"
          testid="staff-stat-referrals" onClick={() => nav("/my-students")} />
        <StatTile icon={CalendarCheck} label="Pending leave" value={leaveStats.pending_mine} tone="sky"
          testid="staff-stat-leave" onClick={() => nav("/leave")} />
      </div>

      {/* Quick actions */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Quick actions</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ActionButton icon={UserPlus} label="Add student" sub="Open your referral application form" testid="staff-action-add-student"
            onClick={() => navigateToApply(nav, user?.id)} />
          <ActionButton icon={CalendarCheck} label="Request leave" sub="Casual / sick / earned / unpaid" testid="staff-action-leave"
            onClick={() => setLeaveOpen(true)} />
          <ActionButton icon={PaperPlaneTilt} label="Reminder to office admin" sub="Send a quick message" testid="staff-action-reminder"
            onClick={() => nav("/messages?compose=1")} />
        </div>
      </div>

      {/* Referral link */}
      <Card className="p-4" data-testid="staff-referral-card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5"><ShareNetwork size={16} className="text-orange-600 dark:text-orange-400" /> Your application link</p>
            <p className="text-xs text-muted-foreground mt-1 truncate max-w-md">{referralLink}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Anyone who applies through this link is credited to you.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyLink} data-testid="staff-copy-link"><Copy size={14} className="mr-1.5" /> Copy</Button>
            <Button size="sm" onClick={shareLink} data-testid="staff-share-link" className="btn-amber border-0"><ShareNetwork size={14} className="mr-1.5" /> Share</Button>
          </div>
        </div>
      </Card>

      {/* Two columns: leads shortcut + referred students */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-medium text-foreground flex items-center gap-1.5"><Target size={16} className="text-orange-600 dark:text-orange-400" /> Leads</p>
            <Button variant="ghost" size="sm" className="h-8 text-orange-600 dark:text-orange-400" onClick={() => nav("/leads")} data-testid="staff-view-leads">
              View all <ArrowRight size={14} className="ml-1" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <MiniTile label="Follow-up" value={stats.by_status?.follow_up || 0}
              onClick={() => nav("/leads?filter=follow_up")} testid="staff-mini-follow_up" />
            <MiniTile label="Interested" value={stats.by_status?.interested || 0}
              onClick={() => nav("/leads?filter=interested")} testid="staff-mini-interested" />
            <MiniTile label="New" value={stats.by_status?.new || 0}
              onClick={() => nav("/leads?filter=new")} testid="staff-mini-new" />
            <MiniTile label="Converted" value={stats.by_status?.converted || 0}
              onClick={() => nav("/leads?filter=converted")} testid="staff-mini-converted" />
          </div>
        </Card>

        <Card className="p-4" data-testid="staff-referrals-card">
          <div className="flex items-center justify-between mb-3">
            <p className="font-medium text-foreground flex items-center gap-1.5"><StudentIcon size={16} className="text-orange-600 dark:text-orange-400" /> Students referred</p>
            <Button variant="ghost" size="sm" className="h-8 text-orange-600 dark:text-orange-400" onClick={() => nav("/my-students")} data-testid="staff-view-students">
              View all <ArrowRight size={14} className="ml-1" />
            </Button>
          </div>
          {referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No referred students yet. Share your link or convert a lead.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {referrals.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 border-b border-border last:border-0 pb-2 last:pb-0" data-testid={`staff-referral-${s.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.course || "—"}</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize shrink-0">{s.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <LeaveRequestDialog open={leaveOpen} onOpenChange={setLeaveOpen} onSubmitted={refreshLeave} />
    </div>
  );
}

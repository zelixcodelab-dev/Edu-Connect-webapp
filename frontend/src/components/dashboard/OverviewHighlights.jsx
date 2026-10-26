import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, Buildings, Trophy, CaretRight, CaretLeft, EnvelopeSimple, Phone, MapPin, BellRinging, FileText, ChatCircleDots, UserMinus } from "@phosphor-icons/react";
import api from "@/lib/api";
import { officeName } from "@/lib/offices";
import AuthedImage from "@/components/AuthedImage";
import ApplicationsReviewDialog from "@/components/dashboard/ApplicationsReviewDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const roleLabel = (r) => (r || "").replace("_", " ");

function Face({ name, url, size = 28, ring = "ring-card" }) {
  return (
    <span className={`rounded-full bg-background text-foreground shadow-sm text-[10px] font-semibold flex items-center justify-center overflow-hidden ring-2 ${ring} shrink-0`} style={{ width: size, height: size }} title={name}>
      {url ? <AuthedImage url={url} alt={name} className="w-full h-full object-cover" fallback={initials(name)} /> : initials(name)}
    </span>
  );
}

function TrendCard({ tid, icon: Icon, eyebrow, data, sub, to, dark, faceUrl }) {
  const base = dark
    ? "bg-[hsl(var(--foreground))] text-[hsl(var(--background))]"
    : "bg-card text-foreground";
  return (
    <Link to={to} data-testid={tid} className={`group rounded-[22px] p-5 flex flex-col justify-between min-h-[168px] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-xl ${base}`}>
      <div>
        <div className="flex items-center gap-2">
          <Icon size={16} weight="bold" className="opacity-80" />
          <p className={`text-xs font-medium ${dark ? "opacity-70" : "text-muted-foreground"}`}>{eyebrow}</p>
        </div>
        <p className="mt-2 font-display text-lg font-semibold leading-tight line-clamp-2" data-testid={`${tid}-name`}>{data?.name || "No data yet"}</p>
        <p className={`mt-1 text-xs line-clamp-2 ${dark ? "opacity-70" : "text-muted-foreground"}`}>{data ? sub : "Close admissions to see who's trending."}</p>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex -space-x-2">
          {faceUrl !== undefined
            ? data && <Face name={data.name} url={faceUrl} ring={dark ? "ring-[hsl(var(--foreground))]" : "ring-card"} />
            : (data?.faces || []).map((n, i) => <Face key={`${n}-${i}`} name={n} ring={dark ? "ring-[hsl(var(--foreground))]" : "ring-card"} />)}
        </div>
        <span className="flex items-center gap-1 text-sm font-semibold tabular-nums" data-testid={`${tid}-count`}>
          <Trophy size={15} weight="fill" /> {data?.count ?? 0}
        </span>
      </div>
    </Link>
  );
}

export function TrendingRow() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/dashboard/trending").then((r) => setD(r.data)).catch(() => setD({})); }, []);
  if (!d) return <div className="grid sm:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-[168px] rounded-[22px] bg-card animate-pulse" />)}</div>;
  const n = (c) => `${c} admission${c === 1 ? "" : "s"} closed`;
  return (
    <div className="grid sm:grid-cols-3 gap-4 dash-stagger" data-testid="trending-row">
      <TrendCard tid="trend-course" icon={GraduationCap} eyebrow="Top course" data={d.top_course} sub={d.top_course && n(d.top_course.count)} to="/students" />
      <TrendCard tid="trend-college" icon={Buildings} eyebrow="Top college" data={d.top_college} sub={d.top_college && n(d.top_college.count)} to="/colleges" dark />
      <TrendCard tid="trend-closer" icon={Trophy} eyebrow="Best closer" data={d.best_closer} faceUrl={d.best_closer?.photo_url || ""}
        sub={d.best_closer && `${roleLabel(d.best_closer.role)} · ${n(d.best_closer.count)}`} to="/students" />
    </div>
  );
}

function ProfileDialog({ member, onClose }) {
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-3xl" data-testid="team-profile-dialog">
        {member && (
          <>
            <DialogHeader className="items-center text-center">
              <Face name={member.name} url={member.photo_url} size={84} />
              <DialogTitle className="mt-3 font-display" data-testid="team-profile-name">{member.name}</DialogTitle>
              <p className="text-xs capitalize text-muted-foreground">{roleLabel(member.role)}</p>
            </DialogHeader>
            <div className="rounded-2xl bg-card p-4 text-center">
              <p className="font-display text-2xl font-semibold tabular-nums">{member.admissions_closed}</p>
              <p className="text-xs text-muted-foreground">Admissions closed</p>
            </div>
            <div className="space-y-2 text-sm">
              {member.email && <p className="flex items-center gap-2"><EnvelopeSimple size={15} className="text-muted-foreground" /><a href={`mailto:${member.email}`} className="hover:underline truncate">{member.email}</a></p>}
              {member.phone && <p className="flex items-center gap-2"><Phone size={15} className="text-muted-foreground" />{member.phone}</p>}
              {member.office && <p className="flex items-center gap-2"><MapPin size={15} className="text-muted-foreground" />{officeName(member.office)}</p>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TeamStrip({ role }) {
  const [members, setMembers] = useState(null);
  const [open, setOpen] = useState(null);
  const scroller = React.useRef(null);
  const [edges, setEdges] = useState({ l: false, r: false });
  useEffect(() => { api.get("/dashboard/team").then((r) => setMembers(r.data.members)).catch(() => setMembers([])); }, []);
  const measure = React.useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [members, measure]);
  const scroll = (dir) => scroller.current?.scrollBy({ left: dir * 220, behavior: "smooth" });
  return (
    <div className="rounded-[22px] bg-card p-5" data-testid="team-strip">
      <div className="flex items-center justify-between mb-3">
        <p className="font-display text-sm font-semibold">Team</p>
        <Link to={role === "super_admin" ? "/users" : "/employees"} className="text-xs text-muted-foreground hover:text-foreground" data-testid="team-view-all">View all</Link>
      </div>
      {members === null ? <div className="h-[112px] rounded-2xl bg-background animate-pulse" /> : members.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No team members yet.</p>
      ) : (
        <div className="relative">
          <div ref={scroller} onScroll={measure} className="sidebar-scroll flex gap-2.5 overflow-x-auto scroll-smooth">
            {members.map((m) => (
              <button key={m.id} type="button" onClick={() => setOpen(m)} data-testid={`team-member-${m.id}`}
                className="group shrink-0 w-[92px] rounded-2xl overflow-hidden bg-background text-left transition-transform duration-200 hover:-translate-y-0.5">
                <div className="h-[84px] w-full bg-muted flex items-center justify-center overflow-hidden">
                  {m.photo_url
                    ? <AuthedImage url={m.photo_url} alt={m.name} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-[filter] duration-300" fallback={initials(m.name)} />
                    : <span className="font-display text-xl font-semibold text-muted-foreground">{initials(m.name)}</span>}
                </div>
                <p className="px-2 py-1.5 text-[11px] font-medium truncate">{m.name}</p>
              </button>
            ))}
          </div>
          {edges.l && (
            <button type="button" onClick={() => scroll(-1)} aria-label="Scroll left" className="absolute -left-2 top-[28px] w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center shadow-md ring-2 ring-card" data-testid="team-scroll-left"><CaretLeft size={13} weight="bold" /></button>
          )}
          {edges.r && (
            <button type="button" onClick={() => scroll(1)} aria-label="Scroll right" className="absolute -right-2 top-[28px] w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center shadow-md ring-2 ring-card" data-testid="team-scroll-right"><CaretRight size={13} weight="bold" /></button>
          )}
        </div>
      )}
      <ProfileDialog member={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// Right of the greeting card: what needs attention now.
export function HeroInbox({ role, showAttendance = false }) {
  const [d, setD] = useState(null);
  const [att, setAtt] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const load = () => api.get("/dashboard/inbox").then((r) => setD(r.data)).catch(() => setD({}));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!showAttendance) return;
    api.get("/attendance/board").then((r) => setAtt(r.data.counts || {})).catch(() => setAtt({}));
  }, [showAttendance]);
  const rows = [
    { k: "reminders", label: "Follow-up reminders", hint: "due now", value: d?.followups_due, to: "/leads", Icon: BellRinging },
    ...(["super_admin", "office_admin"].includes(role) ? [{ k: "applications", label: "New applications", hint: "pending review", value: d?.new_applications, Icon: FileText, onClick: () => setReviewOpen(true) }] : []),
    { k: "messages", label: "New messages", hint: "unread", value: d?.unread_messages, to: "/messages", Icon: ChatCircleDots },
    ...(showAttendance ? [{
      k: "absent", label: "Absent / on leave", to: "/attendance?tab=board", Icon: UserMinus, hint: "today",
      sub: att ? `${att.absent ?? 0} absent · ${att.leave ?? 0} leave` : null,
      value: att ? (att.absent ?? 0) + (att.leave ?? 0) : undefined,
    }] : []),
  ];
  return (
    <div className={`grid ${showAttendance ? "sm:grid-cols-2" : "sm:grid-cols-3"} lg:grid-cols-1 gap-3`} data-testid="hero-inbox">
      {rows.map(({ k, label, hint, value, to, Icon, onClick, sub }) => {
        const Tag = onClick ? "button" : Link;
        return (
        <Tag key={k} {...(onClick ? { type: "button", onClick } : { to })} data-testid={`hero-inbox-${k}`} className="group w-full text-left flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 hover:-translate-y-0.5 hover:shadow-lg transition-[transform,box-shadow] duration-200">
          <span className="relative w-10 h-10 rounded-xl bg-background flex items-center justify-center shrink-0 shadow-sm">
            <Icon size={18} />
            {value > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-card" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-muted-foreground truncate">{label} · {hint}</span>
            <span className="block font-display text-lg font-semibold tabular-nums" data-testid={`hero-inbox-${k}-count`}>{d && (k !== "absent" || att) ? value ?? 0 : "…"}
              {sub && <span className="ml-2 text-[11px] font-sans font-normal text-muted-foreground" data-testid={`hero-inbox-${k}-sub`}>{sub}</span>}
            </span>
          </span>
          <CaretRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Tag>
        );
      })}
      <ApplicationsReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} onChanged={load} />
    </div>
  );
}

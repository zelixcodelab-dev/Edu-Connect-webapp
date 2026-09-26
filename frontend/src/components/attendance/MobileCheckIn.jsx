import React, { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Clock, CaretRight, MapPin, Coffee } from "@phosphor-icons/react";
import { greetingForNow } from "@/lib/format";
import EmergencyLeaveDialog from "@/components/attendance/EmergencyLeaveDialog";

const TARGET_H = 9;

function fmtHM(secs) {
  const s = Math.max(0, Math.floor(secs));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${h}:${m}`;
}
const fmtClockTime = (d) => {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return { hm: `${h}:${m}`, ap };
};
function GoalRing({ progress }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg width="76" height="76" viewBox="0 0 76 76" className="rotate-[-90deg]">
        <circle cx="38" cy="38" r={r} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="5" />
        <circle
          cx="38" cy="38" r={r} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <span className="text-[10px] leading-none opacity-80">Goal</span>
        <span className="text-sm font-bold leading-tight">{TARGET_H}h</span>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-white/70">{label}</p>
      <p className="text-sm font-semibold text-white flex items-center gap-1 mt-0.5 truncate">
        {Icon && <Icon size={13} className="opacity-80 shrink-0" />}
        {value}
      </p>
    </div>
  );
}

// Mobile-only attendance hero + big tappable check-in dial (crimson / near-black brand).
export default function MobileCheckIn({ today, elapsed, netWorked, breakTotal, onBreak, checkedIn, checkedOut, busy, loading, onCheckIn, onCheckOut, onToggleBreak }) {
  const { user } = useAuth();
  const [emgOpen, setEmgOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { hm, ap } = fmtClockTime(now);
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const progress = checkedIn && !checkedOut ? elapsed / (TARGET_H * 3600) : (checkedOut ? 1 : 0);

  const statusLabel = !checkedIn ? "Absent" : checkedOut ? "Completed" : today?.status === "late" ? "Late" : "Present";
  const statusTone = !checkedIn
    ? "bg-white/15 text-white/90"
    : checkedOut
    ? "bg-white/20 text-white"
    : today?.status === "late"
    ? "bg-amber-400/90 text-amber-950"
    : "bg-emerald-400/90 text-emerald-950";

  const checkInTime = checkedIn && today?.check_in
    ? (() => { const d = new Date(today.check_in); const t = fmtClockTime(d); return `${t.hm} ${t.ap}`; })()
    : "--:--";

  const dialLabel = checkedOut ? "Done" : onBreak ? "On Break" : checkedIn ? "Check Out" : "Check In";
  const dialDisabled = busy || loading || checkedOut || onBreak;
  const onDial = () => {
    if (dialDisabled) return;
    if (!checkedIn) onCheckIn();
    else if (!checkedOut) onCheckOut();
  };

  // Press-and-hold to confirm (avoids accidental taps). Uses pointer capture so
  // small finger movements on touch devices don't cancel the hold.
  const HOLD_MS = 1000;
  const [holdPct, setHoldPct] = useState(0);
  const holdRef = React.useRef(null);
  const firedRef = React.useRef(false);
  const startHold = (e) => {
    if (dialDisabled) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    firedRef.current = false;
    const start = Date.now();
    if (holdRef.current) clearInterval(holdRef.current);
    holdRef.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / HOLD_MS) * 100);
      setHoldPct(pct);
      if (pct >= 100 && !firedRef.current) {
        firedRef.current = true;
        clearInterval(holdRef.current);
        holdRef.current = null;
        setHoldPct(0);
        onDial();
      }
    }, 30);
  };
  const endHold = () => {
    if (holdRef.current) { clearInterval(holdRef.current); holdRef.current = null; }
    setHoldPct(0);
  };
  useEffect(() => () => { if (holdRef.current) clearInterval(holdRef.current); }, []);
  const showHoldHint = !dialDisabled;

  return (
    <div className="space-y-6 pb-24" data-testid="mobile-checkin">
      {/* Greeting */}
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground truncate">{greetingForNow()}, {user?.name?.split(" ")[0] || "there"}</p>
          <p className="text-xs text-muted-foreground">Have a productive day</p>
        </div>
      </div>

      {/* Hero status card */}
      <div
        className="rounded-3xl p-5 text-white shadow-xl relative overflow-hidden"
        style={{ background: "linear-gradient(150deg, #9f1239 0%, #7f1d1d 55%, #1c1917 100%)" }}
        data-testid="mobile-status-card"
      >
        <div className="absolute -top-10 -right-8 h-40 w-40 rounded-full bg-white/5" />
        <div className="flex items-start justify-between gap-3 relative">
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ${statusTone}`} data-testid="mobile-status-pill">
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" /> {statusLabel}
            </span>
            <div className="flex items-end gap-2 mt-3">
              <span className="text-4xl font-bold leading-none tabular-nums" data-testid="mobile-clock">{hm}</span>
              <span className="text-lg font-semibold pb-0.5">{ap}</span>
            </div>
            <p className="text-xs text-white/70 mt-1">{dateLabel}</p>
          </div>
          <GoalRing progress={progress} />
        </div>

        <div className="grid grid-cols-3 gap-3 mt-5 relative">
          <Stat label="Worked Hrs" value={fmtHM(checkedIn ? (netWorked ?? elapsed) : 0)} icon={Clock} />
          <Stat label="Check In" value={checkInTime} icon={Clock} />
          <Stat label="Lunch Break" value={fmtHM(breakTotal || 0)} icon={Clock} />
        </div>

        <button
          onClick={() => setEmgOpen(true)}
          data-testid="mobile-emergency-leave"
          className="mt-5 w-full rounded-2xl bg-white/10 hover:bg-white/15 transition-colors py-3 flex items-center justify-center gap-1.5 text-sm font-semibold relative"
        >
          Emergency Leave <CaretRight size={15} weight="bold" />
        </button>
      </div>

      <EmergencyLeaveDialog open={emgOpen} onOpenChange={setEmgOpen} />

      {/* Big concentric press-and-hold dial */}
      <div className="flex flex-col items-center pt-2 pb-1">
        <button
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onContextMenu={(e) => e.preventDefault()}
          disabled={dialDisabled}
          data-testid="mobile-dial-btn"
          className={`relative h-64 w-64 rounded-full flex items-center justify-center transition-transform select-none touch-none ${holdPct > 0 ? "scale-95" : ""} ${dialDisabled ? "opacity-70" : ""}`}
          style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", touchAction: "none" }}
          aria-label={dialLabel}
        >
          <span className="absolute inset-0 rounded-full bg-rose-500/10" />
          <span className="absolute inset-8 rounded-full bg-rose-500/15" />
          {/* hold-progress fill */}
          <span
            className="absolute inset-0 rounded-full"
            style={{ background: `conic-gradient(#e11d48 ${holdPct * 3.6}deg, transparent 0deg)`, opacity: 0.35 }}
          />
          <span
            className="relative h-32 w-32 rounded-full flex flex-col items-center justify-center text-white text-lg font-semibold shadow-lg text-center px-2"
            style={{ background: checkedIn && !checkedOut ? "linear-gradient(150deg,#e11d48,#9f1239)" : "linear-gradient(150deg,#f43f5e,#be123c)" }}
          >
            {dialLabel}
            {showHoldHint && <span className="block text-[10px] font-normal opacity-80 mt-0.5">press &amp; hold</span>}
          </span>
        </button>
        {today?.check_in_lat != null && (
          <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1">
            <MapPin size={12} /> {today.check_in_lat.toFixed(4)}, {today.check_in_lng?.toFixed(4)}
          </p>
        )}
        {checkedIn && !checkedOut && (
          <button
            onClick={onToggleBreak}
            disabled={busy}
            data-testid="mobile-break-btn"
            className={`mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors ${
              onBreak
                ? "bg-amber-500 text-white"
                : "bg-muted text-foreground hover:bg-muted/70"
            }`}
          >
            <Coffee size={16} weight="bold" /> {onBreak ? "End break" : "Start break"}
          </button>
        )}
      </div>
    </div>
  );
}

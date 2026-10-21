import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeft, ArrowRight, Compass } from "@phosphor-icons/react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { hasModule } from "@/lib/perm";
import { Button } from "@/components/ui/button";

export const START_TOUR_EVENT = "educonnect:start-tour";

const ADMIN = ["super_admin", "office_admin"];

// Each step lists candidate selectors; the first visible one is highlighted.
const STEPS = [
  { id: "welcome", title: "Welcome to your workspace", body: "Here's a quick look around. It takes under a minute, and you can skip any time." },
  { id: "nav", sel: ['[data-testid="nav-overview"]', '[data-testid="bottom-nav"]'], title: "Navigation", body: "Every area of the app is listed here. Your menu only shows what your role and company can use." },
  { id: "year", module: "academic_year", sel: ['[data-testid="academic-year-select"]'], title: "Academic year", body: "Pick a year to scope every page's numbers, lists and reports. \"All years\" removes the filter." },
  { id: "students", module: "students", sel: ['[data-testid="nav-students"]', '[data-testid="nav-my-students"]', '[data-testid="bottom-nav-students"]', '[data-testid="bottom-nav-my-students"]'], title: "Students", body: "Admissions, fees, payments and documents for every student." },
  { id: "leads", module: "leads", sel: ['[data-testid="nav-leads"]', '[data-testid="bottom-nav-crm"]', '[data-testid="bottom-nav-leads"]'], title: "CRM & leads", body: "Track enquiries through the pipeline, run campaigns and convert leads into students." },
  { id: "attendance", module: "attendance", sel: ['[data-testid="nav-attendance"]', '[data-testid="bottom-nav-attendance"]'], title: "Attendance & leave", body: "Check in and out, apply for leave and see payroll from one place." },
  { id: "messages", module: "messages", sel: ['[data-testid="nav-messages"]', '[data-testid="topbar-messages-btn"]', '[data-testid="bottom-nav-messages"]'], title: "Messages", body: "Chat with your team. Unread counts show up right here." },
  { id: "team", roles: ADMIN, sel: ['[data-testid="nav-users"]', '[data-testid="nav-office-staff"]'], title: "Your team", body: "Invite colleagues and control what each person can see or edit." },
  { id: "profile", sel: ['[data-testid="profile-menu-btn"]'], title: "Profile & settings", body: "Switch light/dark mode, open settings, or replay this tour any time from here." },
  { id: "done", title: "You're all set", body: "That's the tour. You can replay it from the profile menu whenever you like." },
];

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function findTarget(step) {
  for (const s of step.sel || []) {
    const el = [...document.querySelectorAll(s)].find(visible);
    if (el) return el;
  }
  return null;
}

function useTargetRect(step, tick) {
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    if (!step?.sel) { setRect(null); return undefined; }
    const el = findTarget(step);
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const update = () => {
      const cur = findTarget(step);
      setRect(cur ? cur.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [step, tick]);
  return rect;
}

function cardStyle(rect) {
  if (!rect) return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  const W = Math.min(340, window.innerWidth - 24);
  const below = rect.bottom + 12 + 190 < window.innerHeight;
  const rightSide = rect.right + 16 + W < window.innerWidth && rect.width < 320;
  if (rightSide) return { left: rect.right + 16, top: Math.max(12, Math.min(rect.top, window.innerHeight - 220)), width: W };
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - W - 12));
  return below ? { left, top: rect.bottom + 12, width: W } : { left, top: Math.max(12, rect.top - 12 - 190), width: W };
}

export default function ProductTour() {
  const { user, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const enabled = user && user !== false && user.scope !== "platform" && hasModule(user, "product_tour");

  const steps = useMemo(() => {
    if (!open) return [];
    return STEPS.filter((s) => (!s.module || hasModule(user, s.module))
      && (!s.roles || s.roles.includes(user?.role))
      && (!s.sel || findTarget(s)));
  }, [open, user]);

  useEffect(() => {
    if (enabled && !user.tour_status) {
      const t = setTimeout(() => { setIdx(0); setOpen(true); }, 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [enabled, user?.tour_status]);

  useEffect(() => {
    const start = () => { setIdx(0); setOpen(true); setTick((n) => n + 1); };
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);

  const finish = useCallback(async (status) => {
    setOpen(false);
    try { await api.post("/auth/tour", { status }); refresh?.(); } catch { /* best-effort */ }
  }, [refresh]);

  const step = steps[idx];
  const rect = useTargetRect(open ? step : null, tick);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") finish("skipped"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!enabled || !open || !step) return null;
  const last = idx === steps.length - 1;
  const pad = 6;

  return createPortal(
    <div className="fixed inset-0 z-[9998]" data-testid="product-tour">
      {rect ? (
        <div
          className="absolute rounded-xl ring-2 ring-[hsl(var(--primary))] transition-all duration-300 ease-out pointer-events-none"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgba(10,10,10,0.55)" }}
          data-testid="product-tour-spotlight"
        />
      ) : <div className="absolute inset-0 bg-black/55" />}
      <div
        key={step.id}
        className="absolute rounded-2xl border bg-card text-card-foreground shadow-2xl p-5 platform-pop"
        style={cardStyle(rect)}
        role="dialog"
        aria-label={step.title}
        data-testid="product-tour-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] flex items-center justify-center"><Compass size={16} weight="bold" /></span>
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-semibold" data-testid="product-tour-progress">{idx + 1} of {steps.length}</span>
          </div>
          <button type="button" onClick={() => finish("skipped")} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Close tour" data-testid="product-tour-close"><X size={16} /></button>
        </div>
        <h3 className="mt-3 font-display text-lg font-semibold tracking-tight" data-testid="product-tour-title">{step.title}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          {last ? <span /> : (
            <button type="button" onClick={() => finish("skipped")} className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" data-testid="product-tour-skip">Skip tour</button>
          )}
          <div className="flex items-center gap-2">
            {idx > 0 && (
              <Button variant="outline" size="sm" onClick={() => setIdx((i) => i - 1)} data-testid="product-tour-back"><ArrowLeft size={14} className="mr-1" /> Back</Button>
            )}
            {last ? (
              <Button size="sm" onClick={() => finish("completed")} className="btn-amber border-0" data-testid="product-tour-finish">Finish</Button>
            ) : (
              <Button size="sm" onClick={() => setIdx((i) => i + 1)} className="btn-amber border-0" data-testid="product-tour-next">Next <ArrowRight size={14} className="ml-1" /></Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import React, { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Check, X } from "@phosphor-icons/react";
import { subscribe, getSnapshot, setOverlayMounted, dismissCelebration } from "@/lib/celebrate";

const SUCCESS_MS = 1700;
const ERROR_MS = 2600;
const MILESTONE_MS = 2800;

const SUCCESS_SUBTITLE = {
  Added: "Your new record has been created.",
  Saved: "Your changes have been saved.",
  Updated: "Your changes have been saved.",
  Deleted: "The item has been removed.",
};

const CONFETTI_COLORS = ["#C70000", "#f59e0b", "#10b981", "#2f7d6b", "#e11d48", "#ffffff", "#34d399"];

/** Frosted-glass folder silhouette that sits inside the gradient hero. */
function GlassFolder() {
  return (
    <svg className="celebrate-folder" viewBox="0 0 156 126" aria-hidden="true">
      <path d="M22 32 Q22 21 33 21 L60 21 Q66 21 70 27 L75 35 Q77 38 82 38 L127 38 Q138 38 138 49 L138 96 Q138 107 127 107 L33 107 Q22 107 22 96 Z" />
    </svg>
  );
}

/** Full-screen festive confetti burst for milestone wins. */
function Confetti({ seed }) {
  const pieces = useMemo(() => {
    const rnd = (a, b) => a + Math.random() * (b - a);
    return Array.from({ length: 70 }, (_, i) => ({
      key: `${seed}-${i}`,
      style: {
        left: `${rnd(0, 100)}%`,
        width: `${rnd(6, 11)}px`,
        height: `${rnd(9, 16)}px`,
        background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        animationDelay: `${rnd(0, 0.35).toFixed(2)}s`,
        animationDuration: `${rnd(1.6, 2.6).toFixed(2)}s`,
        "--dx": `${rnd(-140, 140).toFixed(0)}px`,
        "--rot": `${rnd(360, 1080).toFixed(0)}deg`,
      },
    }));
  }, [seed]);
  return (
    <div className="celebrate-confetti" aria-hidden="true" data-testid="celebration-confetti">
      {pieces.map((p) => (
        <span key={p.key} className="confetti-piece" style={p.style} />
      ))}
    </div>
  );
}

/**
 * Single, app-wide centered feedback overlay. Success shows a green gradient
 * hero card with a folder + white check; milestone wins (lead converted, fee
 * paid) add a festive confetti burst and tailored wording; errors mirror the
 * card in crimson with a white X. Auto-dismisses, non-blocking, honors reduced
 * motion.
 */
export default function CelebrationOverlay() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const timerRef = useRef(null);

  useEffect(() => {
    setOverlayMounted(true);
    return () => setOverlayMounted(false);
  }, []);

  useEffect(() => {
    if (!state) return undefined;
    const ttl = state.kind === "error" ? ERROR_MS : state.milestone ? MILESTONE_MS : SUCCESS_MS;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => dismissCelebration(state.id), ttl);
    return () => clearTimeout(timerRef.current);
  }, [state]);

  if (!state) return null;

  const isError = state.kind === "error";
  const caption = state.caption || (isError ? "Didn't go through" : "Saved");
  const title = state.title || (isError ? caption : `${caption} successfully!`);
  const subtitle = isError
    ? state.message || "Something went wrong. Please try again."
    : state.subtitle || SUCCESS_SUBTITLE[caption] || "All done.";

  return (
    <div
      className="celebrate-backdrop"
      data-kind={state.kind}
      data-milestone={state.milestone ? "1" : undefined}
      data-testid="celebration-overlay"
      aria-live="polite"
      role="status"
    >
      {state.milestone && !isError ? <Confetti seed={state.id} /> : null}
      <div
        className="celebrate-card"
        data-testid={isError ? "celebration-error" : "celebration-success"}
      >
        <div className="celebrate-hero">
          <GlassFolder />
          <div className="celebrate-check-badge">
            {isError ? (
              <X size={30} weight="bold" className="celebrate-icon" />
            ) : (
              <Check size={32} weight="bold" className="celebrate-icon" />
            )}
          </div>
        </div>
        <div className="celebrate-body">
          <h3 className="celebrate-title" data-testid="celebration-caption">{title}</h3>
          <p className="celebrate-subtitle" data-testid="celebration-message">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

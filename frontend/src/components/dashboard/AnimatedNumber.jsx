import React, { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Counts a numeric figure up to its target value on mount and whenever `value`
 * changes (e.g. the academic year or period filter re-scopes the data).
 * Animates from the previously displayed number to the new one; on first mount
 * that means 0 → target. Respects "reduce motion": shows the final value
 * instantly with no movement.
 *
 * `format(n)` turns the animated number into the display string (currency,
 * count, etc.) so grouping/symbols always match the dashboard's formatting.
 */
export default function AnimatedNumber({ value, format = (n) => String(n), duration = 1200 }) {
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(null);
  const mountedOnce = useRef(false);

  useEffect(() => {
    // First mount: start from zero for the signature count-up.
    const from = mountedOnce.current ? fromRef.current : 0;
    mountedOnce.current = true;

    if (prefersReducedMotion() || from === target) {
      fromRef.current = target;
      setDisplay(target);
      return undefined;
    }

    const start = performance.now();
    const delta = target - from;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      const current = from + delta * eased;
      setDisplay(t >= 1 ? target : current);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    fromRef.current = target;

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  // Round intermediate frames so currency/count formatting stays clean; the
  // final frame uses the exact target (preserves any decimals).
  const shown = display === target ? target : Math.round(display);
  return <span className="tabular-nums">{format(shown)}</span>;
}

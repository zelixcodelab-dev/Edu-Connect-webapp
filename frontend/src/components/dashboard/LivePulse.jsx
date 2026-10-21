import React from "react";

/**
 * Soft pulsing dot that marks a "live"/real-time figure (e.g. today's spend).
 * Purely a visual cue — it does not change refresh behaviour. The pulse ring is
 * disabled under prefers-reduced-motion (see `.live-dot` in index.css); the dot
 * itself always stays visible.
 */
export default function LivePulse({ className = "", title = "Live" }) {
  return (
    <span className={`live-dot ${className}`} title={title} aria-label={title} role="img" />
  );
}

import React, { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Fades + slides its children in once they scroll into view (Intersection
 * Observer). Reveals only the first time, then stays put. Honours "reduce
 * motion" by rendering the content visible immediately with no movement.
 *
 * Props:
 *   as        element/tag to render (default "div")
 *   className extra classes merged with the reveal base
 *   testid    data-testid passthrough
 */
export default function Reveal({ as: Tag = "div", className = "", children, testid, ...rest }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) { setVisible(true); return undefined; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return undefined; }

    // Reveal as soon as any part of the element enters the viewport. A low
    // threshold (0) is essential: a tall element (e.g. a long list of cards)
    // can never show 12% of its own height on screen, which would otherwise
    // leave it stuck at opacity:0 forever.
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { setVisible(true); obs.disconnect(); }
        });
      },
      { threshold: 0, rootMargin: "0px 0px -5% 0px" }
    );
    obs.observe(el);

    // Safety net: if the element is already on screen at mount (common for
    // above-the-fold lists) or the observer never fires, reveal anyway so
    // content is never permanently hidden.
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top < vh && rect.bottom > 0) { setVisible(true); obs.disconnect(); }
    const fallback = setTimeout(() => { setVisible(true); obs.disconnect(); }, 700);

    return () => { clearTimeout(fallback); obs.disconnect(); };
  }, []);

  return (
    <Tag
      ref={ref}
      data-testid={testid}
      className={`reveal-on-scroll${visible ? " reveal-in" : ""} ${className}`.trim()}
      {...rest}
    >
      {children}
    </Tag>
  );
}

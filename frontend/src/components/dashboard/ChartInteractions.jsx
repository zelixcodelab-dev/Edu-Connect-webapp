import React from "react";
import { Sector } from "recharts";

/**
 * Shared chart interaction helpers used across every dashboard so hovering a
 * chart feels consistent: a styled tooltip that glides to the cursor (the glide
 * itself is a CSS transition on `.recharts-tooltip-wrapper` in index.css), an
 * active-slice highlight for donuts, and common cursor/active styling.
 *
 * Everything degrades to a static final state under prefers-reduced-motion
 * (handled by the CSS guards) — no behaviour here is required for the data to
 * be readable.
 */

/** Styled, theme-aware tooltip content. `formatter(value, name)` is optional. */
export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 shadow-lg text-xs">
      {label != null && label !== "" && (
        <p className="font-medium text-foreground mb-1">{label}</p>
      )}
      <div className="space-y-0.5">
        {payload.map((p, i) => {
          const val = formatter ? formatter(p.value, p.name, p) : p.value;
          const color = p.color || p.payload?.color || p.fill;
          return (
            <div key={`${p.name}-${i}`} className="flex items-center gap-2">
              {color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />}
              <span className="text-muted-foreground">{p.name}</span>
              <span className="ml-auto font-semibold text-foreground tabular-nums">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Active donut/pie slice: expands slightly + draws a thin outer ring. */
export function activePieShape(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector
        cx={cx} cy={cy}
        innerRadius={innerRadius} outerRadius={outerRadius + 6}
        startAngle={startAngle} endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx} cy={cy}
        innerRadius={outerRadius + 8} outerRadius={outerRadius + 11}
        startAngle={startAngle} endAngle={endAngle}
        fill={fill} opacity={0.4}
      />
    </g>
  );
}

/** Subtle highlight rectangle shown behind the hovered bar. */
export const CHART_CURSOR = { fill: "hsl(var(--muted-foreground))", fillOpacity: 0.08, radius: 4 };
export const CHART_CURSOR_LINE = { stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.3, strokeWidth: 1 };

/** Hook: track the hovered index for a pie/donut to dim the non-active slices. */
export function usePieActive() {
  const [active, setActive] = React.useState(-1);
  return {
    active,
    activeIndex: active >= 0 ? active : undefined,
    onEnter: (_, i) => setActive(i),
    onLeave: () => setActive(-1),
    cellOpacity: (i) => (active < 0 || active === i ? 1 : 0.35),
  };
}

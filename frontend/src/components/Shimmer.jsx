import React from "react";

/**
 * Lightweight shimmer-skeleton primitives used as loading placeholders while a
 * page fetches its data. The sweep animation (`.shimmer` in index.css) is
 * disabled under prefers-reduced-motion, leaving a calm static block.
 */

export function ShimmerBlock({ className = "" }) {
  return <div className={`shimmer rounded-md ${className}`} />;
}

/** A row of stat-card placeholders (dashboards). */
export function StatRowSkeleton({ count = 4, testid = "stat-skeleton" }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid={testid}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-5 rounded-xl bg-card border border-border">
          <ShimmerBlock className="w-10 h-10 rounded-lg" />
          <ShimmerBlock className="h-7 w-24 mt-4" />
          <ShimmerBlock className="h-3 w-20 mt-3" />
        </div>
      ))}
    </div>
  );
}

/** A grid of card placeholders (Students / Leads lists). */
export function CardGridSkeleton({ count = 6, cols = "sm:grid-cols-2 lg:grid-cols-3", testid = "cards-skeleton" }) {
  return (
    <div className={`grid grid-cols-1 ${cols} gap-4`} data-testid={testid}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-5 rounded-xl bg-card border border-border space-y-3">
          <div className="flex items-center gap-3">
            <ShimmerBlock className="w-11 h-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <ShimmerBlock className="h-4 w-2/3" />
              <ShimmerBlock className="h-3 w-1/3" />
            </div>
          </div>
          <ShimmerBlock className="h-3 w-full" />
          <ShimmerBlock className="h-3 w-5/6" />
          <ShimmerBlock className="h-8 w-full rounded-lg mt-2" />
        </div>
      ))}
    </div>
  );
}

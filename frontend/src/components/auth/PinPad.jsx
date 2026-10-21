/**
 * 4-digit numeric PIN pad.
 *
 * Renders the current PIN as 4 filled/empty dots plus a large 3-column
 * numeric keypad (mobile-friendly). Calls ``onSubmit(pin)`` the instant the
 * user types the 4th digit. Parent controls the value via ``value`` +
 * ``onChange`` so it can be cleared on failed attempts.
 */
import React from "react";
import { Backspace } from "@phosphor-icons/react";

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "back"],
];

export default function PinPad({
  value = "",
  onChange,
  onSubmit,
  disabled = false,
  error = "",
  autoSubmit = true,
  testid = "pin-pad",
}) {
  const press = (k) => {
    if (disabled) return;
    if (k === "back") {
      onChange(value.slice(0, -1));
      return;
    }
    if (!/^\d$/.test(k)) return;
    if (value.length >= 4) return;
    const next = value + k;
    onChange(next);
    if (autoSubmit && next.length === 4) {
      // Defer to next tick so the 4th dot renders filled before the parent
      // triggers the network call (feels snappier).
      queueMicrotask(() => onSubmit?.(next));
    }
  };

  return (
    <div className="flex flex-col items-center gap-5 select-none w-full" data-testid={testid}>
      {/* Dots */}
      <div className="flex items-center gap-3" data-testid="pin-dots" aria-label={`PIN ${value.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => {
          const filled = i < value.length;
          return (
            <span
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-all ${
                error
                  ? "bg-rose-500 ring-4 ring-rose-500/20"
                  : filled
                    ? "bg-amber-500 ring-4 ring-amber-500/20 scale-110"
                    : "bg-muted"
              }`}
            />
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-300 font-medium" data-testid="pin-error">
          {error}
        </p>
      )}

      {/* Keypad — grid tracks are 1fr each so buttons ALWAYS fill the row
          regardless of parent width. Aspect-square makes them consistent
          taps on any viewport. Max width guards against ultra-wide screens. */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-xs mx-auto">
        {KEYS.flat().map((k, idx) => {
          if (!k) return <span key={`e-${idx}`} />;
          if (k === "back") {
            return (
              <button
                key="back"
                type="button"
                onClick={() => press("back")}
                disabled={disabled || value.length === 0}
                aria-label="Delete last digit"
                data-testid="pin-key-back"
                className="aspect-square min-h-[64px] w-full rounded-2xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Backspace size={28} weight="duotone" />
              </button>
            );
          }
          return (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              disabled={disabled}
              data-testid={`pin-key-${k}`}
              className="aspect-square min-h-[64px] w-full rounded-2xl bg-muted text-2xl font-semibold text-foreground shadow-sm border border-border/50 transition-all active:scale-95 active:bg-muted/80 hover:bg-muted/90 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation"
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, LockOpen, ShieldCheck, Warning, KeyReturn } from "@phosphor-icons/react";
import { toast } from "sonner";

const DIGITS = 4;

/**
 * Wraps a page/section with a 4-digit PIN lock. The unlocked state lives
 * only in local React state — the moment the component unmounts (user
 * navigates away, hits back, refreshes the tab) the page re-locks and the
 * PIN must be entered again.
 *
 * On first mount:
 *   - Check /api/{basePath}/pin-status:
 *       - is_set=false → "Set your 4-digit PIN" screen (first-time setup)
 *       - is_set=true, not locked → "Enter PIN" screen
 *       - is_set=true, locked     → "Locked, try again in Ns" screen
 *
 * Props:
 *   basePath  API prefix (default "admission-revenue")
 *   title     text shown on the lock screen
 *   subtitle  small paragraph under the title
 *   children  what to render once unlocked
 */
export default function PinLock({
  basePath = "admission-revenue",
  title = "Confidential page",
  subtitle = "Enter your 4-digit PIN to unlock.",
  children,
}) {
  const [status, setStatus] = useState(null); // null | {is_set, locked, seconds_remaining}
  const [mode, setMode] = useState("check"); // "check" | "setup" | "enter"
  // Deliberately NOT persisted — re-locks on every navigation back to the page.
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (unlocked) return;
    (async () => {
      try {
        const r = await api.get(`/${basePath}/pin-status`);
        setStatus(r.data);
        setMode(r.data?.is_set ? "enter" : "setup");
      } catch (err) {
        toast.error("Could not read PIN status");
        setStatus({ is_set: false, locked: false });
      }
    })();
  }, [basePath, unlocked]);

  const doUnlock = () => setUnlocked(true);

  if (unlocked) return <>{children}</>;
  if (!status) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground" data-testid="pin-loading">
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-10" data-testid="pin-gate">
      <Card className="p-6 sm:p-8 border border-amber-500/40 bg-gradient-to-b from-amber-500/5 to-transparent shadow-none">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center">
            <Lock size={20} weight="fill" className="text-amber-700 dark:text-amber-400" />
          </div>
          <div>
            <p className="label-eyebrow flex items-center gap-1"><ShieldCheck size={11} weight="fill" /> Confidential</p>
            <h2 className="font-display text-xl sm:text-2xl">{title}</h2>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-6">{subtitle}</p>

        {mode === "setup" ? (
          <SetupPin basePath={basePath} onDone={doUnlock} />
        ) : (
          <EnterPin
            basePath={basePath}
            status={status}
            onSuccess={doUnlock}
            onStatusRefresh={setStatus}
          />
        )}
      </Card>
    </div>
  );
}

/* ── Enter PIN (existing PIN) ────────────────────────────────────────────── */

function EnterPin({ basePath, status, onSuccess, onStatusRefresh }) {
  const [pin, setPin] = useState(Array(DIGITS).fill(""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [lockRemaining, setLockRemaining] = useState(status?.seconds_remaining || 0);
  const inputs = useRef([]);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  // Countdown when locked
  useEffect(() => {
    if (!(status?.locked)) return;
    setLockRemaining(status.seconds_remaining || 0);
    const t = setInterval(() => {
      setLockRemaining((n) => {
        if (n <= 1) {
          clearInterval(t);
          // Re-check server-side status when the timer hits 0
          api.get(`/${basePath}/pin-status`).then((r) => onStatusRefresh(r.data)).catch(() => {});
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [basePath, status, onStatusRefresh]);

  const combined = useMemo(() => pin.join(""), [pin]);
  const isLocked = (status?.locked && lockRemaining > 0);

  const setDigit = (idx, v) => {
    const digit = (v || "").replace(/\D/g, "").slice(0, 1);
    setPin((prev) => {
      const next = [...prev];
      next[idx] = digit;
      return next;
    });
    setError("");
    if (digit && idx < DIGITS - 1) inputs.current[idx + 1]?.focus();
  };

  const onKeyDown = (idx, e) => {
    if (e.key === "Backspace" && !pin[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  };

  const onPaste = (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
    const digits = text.replace(/\D/g, "").slice(0, DIGITS).split("");
    if (digits.length) {
      e.preventDefault();
      const next = Array(DIGITS).fill("");
      digits.forEach((d, i) => { next[i] = d; });
      setPin(next);
      inputs.current[Math.min(digits.length, DIGITS - 1)]?.focus();
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (isLocked) return;
    if (combined.length !== DIGITS) { setError("Enter all 4 digits"); return; }
    setSubmitting(true);
    setError("");
    try {
      await api.post(`/${basePath}/pin/verify`, { pin: combined });
      onSuccess();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const code = err?.response?.status;
      setPin(Array(DIGITS).fill(""));
      inputs.current[0]?.focus();
      setError(typeof detail === "string" ? detail : "Wrong PIN");
      if (code === 429) {
        // Server says we're now locked — refresh status.
        try {
          const r = await api.get(`/${basePath}/pin-status`);
          onStatusRefresh(r.data);
        } catch { /* ignore */ }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="pin-enter-form">
      <label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
        Enter 4-digit PIN
      </label>
      <div className="flex gap-2 justify-center" onPaste={onPaste}>
        {pin.map((v, i) => (
          <input
            key={i}
            ref={(el) => { inputs.current[i] = el; }}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={1}
            disabled={submitting || isLocked}
            value={v}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            className={`w-14 h-16 text-center text-2xl font-display rounded-lg border-2 bg-card focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all ${
              error ? "border-rose-500/60" : "border-border focus:border-amber-500"
            } ${isLocked ? "opacity-50" : ""}`}
            data-testid={`pin-digit-${i}`}
          />
        ))}
      </div>

      {isLocked ? (
        <div
          className="flex items-center gap-2 text-sm text-rose-700 dark:text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-md p-3"
          data-testid="pin-locked-banner"
        >
          <Warning size={16} weight="fill" />
          Too many wrong attempts. Try again in <strong className="tabular-nums">{lockRemaining}s</strong>.
        </div>
      ) : (
        error && (
          <p className="text-sm text-rose-700 dark:text-rose-400 text-center" data-testid="pin-error">
            {error}
          </p>
        )
      )}

      <Button
        type="submit"
        className="w-full btn-amber border-0 h-11"
        disabled={submitting || isLocked || combined.length !== DIGITS}
        data-testid="pin-submit-btn"
      >
        <LockOpen size={16} className="mr-1.5" />
        {submitting ? "Verifying…" : "Unlock"}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1">
        <KeyReturn size={11} /> Press Enter to submit
      </p>
    </form>
  );
}

/* ── Set up PIN (first time) ────────────────────────────────────────────── */

function SetupPin({ basePath, onDone }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (pin.length !== DIGITS || !/^\d{4}$/.test(pin)) {
      setError("PIN must be 4 digits");
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs don't match");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.post(`/${basePath}/pin/set`, { pin });
      toast.success("PIN set — page unlocked");
      onDone();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not set PIN");
    } finally {
      setSubmitting(false);
    }
  };

  const onlyDigits = (v) => (v || "").replace(/\D/g, "").slice(0, 4);

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="pin-setup-form">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-[11px] text-amber-900 dark:text-amber-200">
        <strong>First-time setup.</strong> Pick a 4-digit PIN — you'll enter it every
        time you open this page in a new tab.
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">New PIN</label>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => { setPin(onlyDigits(e.target.value)); setError(""); }}
          maxLength={4}
          className="w-full mt-1.5 h-12 text-2xl text-center tracking-[0.6em] font-display rounded-lg border-2 border-border bg-card focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          placeholder="••••"
          data-testid="pin-setup-new"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Confirm PIN</label>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={confirmPin}
          onChange={(e) => { setConfirmPin(onlyDigits(e.target.value)); setError(""); }}
          maxLength={4}
          className="w-full mt-1.5 h-12 text-2xl text-center tracking-[0.6em] font-display rounded-lg border-2 border-border bg-card focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          placeholder="••••"
          data-testid="pin-setup-confirm"
        />
      </div>
      {error && (
        <p className="text-sm text-rose-700 dark:text-rose-400 text-center" data-testid="pin-error">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full btn-amber border-0 h-11"
        disabled={submitting || pin.length !== 4 || confirmPin.length !== 4}
        data-testid="pin-setup-submit"
      >
        <ShieldCheck size={16} className="mr-1.5" />
        {submitting ? "Setting PIN…" : "Set PIN & unlock"}
      </Button>
    </form>
  );
}

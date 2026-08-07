import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Lock, ShieldCheck, Key, Trash, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";

const DIGITS = 4;
const onlyDigits = (v) => (v || "").replace(/\D/g, "").slice(0, DIGITS);

/**
 * "Admission Revenue PIN" section for the Settings page. Super admin only.
 * Lets the user (a) set a PIN if none exists, (b) rotate it with the current
 * PIN, (c) recover a forgotten PIN using the login password, or (d) remove
 * the PIN entirely (requires the current PIN).
 */
export default function AdmissionRevenuePinSettings({ userEmail }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(null); // "set" | "change" | "forgot" | "remove" | null

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admission-revenue/pin-status");
      setStatus(r.data);
    } catch {
      toast.error("Could not read PIN status");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, []);

  return (
    <Card
      className="p-6 border border-amber-500/40 bg-gradient-to-b from-amber-500/5 to-transparent rounded-lg shadow-none"
      data-testid="pin-settings-card"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
          <Lock size={20} weight="fill" className="text-amber-700 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <p className="label-eyebrow flex items-center gap-1"><ShieldCheck size={11} weight="fill" /> Confidential</p>
          <h2 className="font-display text-lg sm:text-xl mt-0.5">Admission Revenue PIN</h2>
          <p className="text-xs text-muted-foreground mt-1">
            A 4-digit PIN protects the Admission Revenue page. It's asked every time
            you open the page. Locks for 5 minutes after 5 wrong attempts.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <>
          <StatusBadge status={status} data-testid="pin-status-badge" />

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {!status?.is_set ? (
              <Button
                type="button"
                onClick={() => setOpenDialog("set")}
                className="btn-amber border-0 justify-start col-span-full"
                data-testid="pin-btn-set"
              >
                <Key size={16} className="mr-1.5" />
                Set a 4-digit PIN
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpenDialog("change")}
                  className="justify-start"
                  data-testid="pin-btn-change"
                >
                  <Key size={15} className="mr-1.5" />
                  Change PIN
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpenDialog("forgot")}
                  className="justify-start"
                  data-testid="pin-btn-forgot"
                >
                  <ShieldCheck size={15} className="mr-1.5" />
                  Forgot PIN? Reset with password
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpenDialog("remove")}
                  className="justify-start text-rose-700 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/10 col-span-full"
                  data-testid="pin-btn-remove"
                >
                  <Trash size={15} className="mr-1.5" />
                  Remove PIN (page becomes unlocked)
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {openDialog === "set" && (
        <SetPinDialog
          open
          onOpenChange={(v) => !v && setOpenDialog(null)}
          onDone={() => { setOpenDialog(null); refresh(); }}
        />
      )}
      {openDialog === "change" && (
        <ChangePinDialog
          open
          onOpenChange={(v) => !v && setOpenDialog(null)}
          onDone={() => { setOpenDialog(null); refresh(); }}
        />
      )}
      {openDialog === "forgot" && (
        <ForgotPinDialog
          open
          userEmail={userEmail}
          onOpenChange={(v) => !v && setOpenDialog(null)}
          onDone={() => { setOpenDialog(null); refresh(); }}
        />
      )}
      {openDialog === "remove" && (
        <RemovePinDialog
          open
          onOpenChange={(v) => !v && setOpenDialog(null)}
          onDone={() => { setOpenDialog(null); refresh(); }}
        />
      )}
    </Card>
  );
}

/* ── Status pill ─────────────────────────────────────────────────────────── */

function StatusBadge({ status }) {
  if (!status?.is_set) {
    return (
      <div
        className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-muted/60 text-muted-foreground border border-border"
        data-testid="pin-status-badge"
      >
        <Warning size={13} />
        No PIN set yet — the Admission Revenue page is <strong>unprotected</strong>.
      </div>
    );
  }
  if (status.locked) {
    return (
      <div
        className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30"
        data-testid="pin-status-badge"
      >
        <Warning size={13} weight="fill" />
        Currently locked (too many wrong attempts) — try again in <strong>{status.seconds_remaining}s</strong>, or reset with password below.
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
      data-testid="pin-status-badge"
    >
      <ShieldCheck size={13} weight="fill" />
      PIN is set — page is protected.
    </div>
  );
}

/* ── Reusable field ──────────────────────────────────────────────────────── */

function DigitInput({ label, value, onChange, testid, autoFocus }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(onlyDigits(e.target.value))}
        maxLength={4}
        className="w-full mt-1.5 h-12 text-2xl text-center tracking-[0.6em] font-display rounded-lg border-2 border-border bg-card focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
        placeholder="••••"
        data-testid={testid}
      />
    </div>
  );
}

/* ── Set (first-time) ────────────────────────────────────────────────────── */

function SetPinDialog({ open, onOpenChange, onDone }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pin.length !== 4) return toast.error("PIN must be 4 digits");
    if (pin !== confirmPin) return toast.error("PINs don't match");
    setSubmitting(true);
    try {
      await api.post("/admission-revenue/pin/set", { pin });
      toast.success("PIN set");
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not set PIN");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-sm" data-testid="pin-set-dialog">
        <DialogHeader>
          <DialogTitle>Set your Admission Revenue PIN</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            You'll enter this PIN every time you open the Admission Revenue page.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <DigitInput label="New PIN" value={pin} onChange={setPin} testid="pin-set-new" autoFocus />
          <DigitInput label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} testid="pin-set-confirm" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="btn-amber border-0" disabled={submitting || pin.length !== 4 || confirmPin.length !== 4} data-testid="pin-set-submit">
              {submitting ? "Saving…" : "Save PIN"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Change (with current PIN) ───────────────────────────────────────────── */

function ChangePinDialog({ open, onOpenChange, onDone }) {
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (currentPin.length !== 4 || pin.length !== 4) return toast.error("PINs must be 4 digits");
    if (pin !== confirmPin) return toast.error("New PINs don't match");
    if (pin === currentPin) return toast.error("Pick a different new PIN");
    setSubmitting(true);
    try {
      await api.post("/admission-revenue/pin/set", { pin, current_pin: currentPin });
      toast.success("PIN updated");
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not change PIN");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-sm" data-testid="pin-change-dialog">
        <DialogHeader>
          <DialogTitle>Change your PIN</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Enter your current PIN, then pick a new one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <DigitInput label="Current PIN" value={currentPin} onChange={setCurrentPin} testid="pin-change-current" autoFocus />
          <DigitInput label="New PIN" value={pin} onChange={setPin} testid="pin-change-new" />
          <DigitInput label="Confirm New PIN" value={confirmPin} onChange={setConfirmPin} testid="pin-change-confirm" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              className="btn-amber border-0"
              disabled={submitting || currentPin.length !== 4 || pin.length !== 4 || confirmPin.length !== 4}
              data-testid="pin-change-submit"
            >
              {submitting ? "Updating…" : "Update PIN"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Forgot (reset with login password) ─────────────────────────────────── */

function ForgotPinDialog({ open, userEmail, onOpenChange, onDone }) {
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!password) return toast.error("Enter your login password");
    if (pin.length !== 4) return toast.error("PIN must be 4 digits");
    if (pin !== confirmPin) return toast.error("PINs don't match");
    setSubmitting(true);
    try {
      await api.post("/admission-revenue/pin/reset-with-password", {
        password,
        new_pin: pin,
      });
      toast.success("PIN reset — new PIN is active");
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not reset PIN");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-sm" data-testid="pin-forgot-dialog">
        <DialogHeader>
          <DialogTitle>Reset PIN with password</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Verify your login password to pick a fresh PIN. This also clears any active lockout.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Login password for <span className="text-foreground">{userEmail}</span>
            </Label>
            <Input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your login password"
              className="mt-1.5"
              data-testid="pin-forgot-password"
            />
          </div>
          <DigitInput label="New PIN" value={pin} onChange={setPin} testid="pin-forgot-new" />
          <DigitInput label="Confirm New PIN" value={confirmPin} onChange={setConfirmPin} testid="pin-forgot-confirm" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              className="btn-amber border-0"
              disabled={submitting || !password || pin.length !== 4 || confirmPin.length !== 4}
              data-testid="pin-forgot-submit"
            >
              {submitting ? "Resetting…" : "Reset PIN"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Remove (requires current PIN) ──────────────────────────────────────── */

function RemovePinDialog({ open, onOpenChange, onDone }) {
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pin.length !== 4) return toast.error("PIN must be 4 digits");
    setSubmitting(true);
    try {
      await api.post("/admission-revenue/pin/remove", { pin });
      toast.success("PIN removed — page is unlocked");
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not remove PIN");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-sm" data-testid="pin-remove-dialog">
        <DialogHeader>
          <DialogTitle>Remove PIN?</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            The Admission Revenue page will no longer require a PIN to open. You
            can set a new one anytime.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <DigitInput label="Enter current PIN to confirm" value={pin} onChange={setPin} testid="pin-remove-current" autoFocus />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={submitting || pin.length !== 4}
              data-testid="pin-remove-submit"
            >
              {submitting ? "Removing…" : "Remove PIN"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

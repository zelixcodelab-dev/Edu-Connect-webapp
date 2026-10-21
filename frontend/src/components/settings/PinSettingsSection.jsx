/**
 * "App PIN" section for the Profile / Settings page.
 * Lets the caller set / change / disable their 4-digit unlock PIN.
 * The PIN unlock itself only kicks in on mobile viewports, but we still
 * offer the setting on desktop so the user can prep before leaving their
 * desk.
 */
import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LockKey, Fingerprint } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import PinPad from "@/components/auth/PinPad";
import { enrolPasskey, disableBiometric, isBiometricSupported } from "@/lib/webauthn";

export default function PinSettingsSection() {
  const { user, refresh } = useAuth();
  const enabled = !!user?.pin_enabled;
  const bioEnabled = !!user?.biometric_enabled;
  const [mode, setMode] = useState("idle"); // idle | set | confirm
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    isBiometricSupported().then(setBioSupported);
  }, []);

  const enableBiometric = async () => {
    if (!enabled) { toast.error("Set a PIN first — it's the biometric fallback"); return; }
    setBioBusy(true);
    try {
      await enrolPasskey();
      toast.success("Biometric unlock enabled");
      await refresh?.();
    } catch (e) {
      const name = e?.name || "";
      if (name === "NotAllowedError" || name === "AbortError") {
        // User cancelled the OS prompt — no toast noise
      } else {
        toast.error(e?.response?.data?.detail || e?.message || "Could not enable biometric unlock");
      }
    } finally {
      setBioBusy(false);
    }
  };

  const turnOffBiometric = async () => {
    if (!window.confirm("Turn off biometric unlock on this account?")) return;
    setBioBusy(true);
    try {
      await disableBiometric();
      toast.success("Biometric unlock turned off");
      await refresh?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not turn off biometric unlock");
    } finally {
      setBioBusy(false);
    }
  };

  const reset = () => {
    setMode("idle"); setPin(""); setConfirm(""); setPassword(""); setError(""); setBusy(false);
  };

  const doSave = async () => {
    if (confirm !== pin) { setError("PINs don't match"); setConfirm(""); return; }
    if (!password) { setError("Confirm your account password"); return; }
    setBusy(true); setError("");
    try {
      await api.post("/auth/pin", { pin, current_password: password });
      toast.success(enabled ? "PIN updated" : "PIN set");
      await refresh?.();
      reset();
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not save PIN");
    } finally {
      setBusy(false);
    }
  };

  const doDisable = async () => {
    if (!window.confirm("Turn off PIN unlock? You'll sign in with password only.")) return;
    setBusy(true);
    try {
      await api.delete("/auth/pin");
      toast.success("PIN unlock disabled");
      await refresh?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not disable PIN");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-6 space-y-4" data-testid="app-pin-settings-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <LockKey size={20} weight="duotone" />
          </div>
          <div>
            <h3 className="font-display text-base font-semibold">App PIN</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              4-digit code to unlock the app on your phone. Auto-locks after 5 minutes of inactivity.
            </p>
          </div>
        </div>
        <Badge className={enabled
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
          : "bg-muted text-muted-foreground border-transparent"}
          data-testid="pin-settings-status"
        >
          {enabled ? "ON" : "OFF"}
        </Badge>
      </div>

      {mode === "idle" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => { setMode("set"); setPin(""); setConfirm(""); setError(""); }}
              className="btn-amber border-0"
              data-testid="pin-settings-open"
              disabled={busy}
            >
              {enabled ? "Change PIN" : "Set PIN"}
            </Button>
            {enabled && (
              <Button
                variant="outline"
                onClick={doDisable}
                disabled={busy}
                data-testid="pin-settings-disable"
              >
                Turn off
              </Button>
            )}
          </div>

          {/* Biometric unlock — only shown when supported AND a PIN exists */}
          {enabled && bioSupported && (
            <div
              className="rounded-lg border border-border p-3 sm:p-4 flex items-start gap-3 mt-3"
              data-testid="biometric-settings-block"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                <Fingerprint size={18} weight="duotone" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Biometric unlock</p>
                  <Badge className={bioEnabled
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                    : "bg-muted text-muted-foreground border-transparent"}
                    data-testid="biometric-status"
                  >
                    {bioEnabled ? "ON" : "OFF"}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Use Face ID / Touch ID / Windows Hello. Your PIN stays as a backup.
                </p>
                <div className="mt-2 flex gap-2">
                  {bioEnabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={turnOffBiometric}
                      disabled={bioBusy}
                      data-testid="biometric-disable"
                    >
                      Turn off biometric
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={enableBiometric}
                      disabled={bioBusy}
                      className="btn-amber border-0"
                      data-testid="biometric-enable"
                    >
                      {bioBusy ? "Waiting for prompt…" : "Enable biometric unlock"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {mode === "set" && (
        <div className="rounded-lg border border-border p-4 space-y-4 max-w-sm">
          <p className="text-sm font-medium">Enter new 4-digit PIN</p>
          <PinPad
            value={pin}
            onChange={(v) => { setPin(v); setError(""); }}
            onSubmit={() => { setMode("confirm"); }}
            error={error}
            testid="pin-settings-pad-1"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            data-testid="pin-settings-cancel-1"
          >
            Cancel
          </Button>
        </div>
      )}

      {mode === "confirm" && (
        <div className="rounded-lg border border-border p-4 space-y-4 max-w-sm">
          <p className="text-sm font-medium">Confirm PIN &amp; password</p>
          <PinPad
            value={confirm}
            onChange={(v) => { setConfirm(v); setError(""); }}
            onSubmit={() => { /* wait for password */ }}
            error={confirm.length === 4 && confirm !== pin ? "PINs don't match" : ""}
            autoSubmit={false}
            testid="pin-settings-pad-2"
          />
          <div className="space-y-1.5">
            <Label htmlFor="pin-settings-pw">Account password</Label>
            <Input
              id="pin-settings-pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              data-testid="pin-settings-password"
            />
            {error && confirm === pin && (
              <p className="text-xs text-rose-600 dark:text-rose-300" data-testid="pin-settings-error">{error}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} data-testid="pin-settings-cancel-2">
              Cancel
            </Button>
            <Button
              onClick={doSave}
              disabled={busy || confirm.length !== 4 || !password}
              className="btn-amber border-0"
              data-testid="pin-settings-save"
            >
              {busy ? "Saving…" : "Save PIN"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

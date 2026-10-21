/**
 * Dialog that walks a freshly-logged-in mobile user through creating their
 * 4-digit PIN. Two screens:
 *   1. Choose the PIN (4 taps → auto advance)
 *   2. Confirm by re-typing it + type the account password once
 *
 * The parent decides when to open (see AuthProvider.setupPinPromptOpen).
 */
import React, { useState } from "react";
import api from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import PinPad from "./PinPad";
import { LockKey, ArrowLeft } from "@phosphor-icons/react";

export default function PinSetupDialog({ open, onOpenChange, onDone }) {
  const [step, setStep] = useState(1);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setStep(1); setPin(""); setConfirm(""); setPassword(""); setError(""); setSaving(false);
  };

  const goStep2 = (finalPin) => {
    // PinPad forwards the new value on autoSubmit — trust that over the
    // possibly-stale ``pin`` closure state.
    const p = finalPin || pin;
    if (p.length !== 4) { setError("Enter 4 digits"); return; }
    setPin(p);
    setError(""); setStep(2);
  };

  const save = async () => {
    if (confirm !== pin) {
      setError("PINs don't match. Try again.");
      setConfirm("");
      return;
    }
    if (!password) { setError("Confirm your password"); return; }
    setSaving(true);
    try {
      await api.post("/auth/pin", { pin, current_password: password });
      toast.success("PIN set — you can unlock the app with it next time");
      reset();
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not save PIN");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="bg-card max-w-sm" data-testid="pin-setup-dialog">
        <DialogHeader>
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center justify-center mx-auto mb-2">
            <LockKey size={20} weight="duotone" />
          </div>
          <DialogTitle className="text-center font-display">
            {step === 1 ? "Set a 4-digit PIN" : "Confirm your PIN"}
          </DialogTitle>
          <DialogDescription className="text-center text-xs text-muted-foreground">
            {step === 1
              ? "Unlock the app quickly on this phone. You can change or turn it off any time in your profile."
              : "Re-type the same 4 digits and your password once."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="pt-2">
            <PinPad
              value={pin}
              onChange={(v) => { setPin(v); setError(""); }}
              onSubmit={goStep2}
              error={error}
              testid="pin-setup-pad-1"
            />
            <div className="flex justify-center mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                data-testid="pin-setup-skip"
              >
                Skip for now
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="pt-2 space-y-4">
            <PinPad
              value={confirm}
              onChange={(v) => { setConfirm(v); setError(""); }}
              onSubmit={() => { /* wait for password entry */ }}
              error={confirm.length === 4 && confirm !== pin ? "PINs don't match" : ""}
              autoSubmit={false}
              testid="pin-setup-pad-2"
            />
            <div className="space-y-1.5">
              <Label htmlFor="pin-pw">Account password</Label>
              <Input
                id="pin-pw"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                data-testid="pin-setup-password"
              />
              {error && confirm === pin && (
                <p className="text-xs text-rose-600 dark:text-rose-300" data-testid="pin-setup-error">{error}</p>
              )}
            </div>
            <div className="flex justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setStep(1); setConfirm(""); setError(""); }}
                data-testid="pin-setup-back"
              >
                <ArrowLeft size={14} className="mr-1" /> Back
              </Button>
              <Button
                onClick={save}
                disabled={saving || confirm.length !== 4 || !password}
                className="btn-amber border-0"
                data-testid="pin-setup-save"
              >
                {saving ? "Saving…" : "Save PIN"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

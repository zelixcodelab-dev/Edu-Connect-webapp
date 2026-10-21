/**
 * Full-screen PIN unlock overlay. Renders when a mobile viewport has a
 * "sleeping" session (via AuthProvider's inactivity/re-open detection) and
 * the user has PIN enabled on their account.
 *
 * On success we drop straight back into the app with a fresh JWT.
 * "Sign in with password instead" bails out to the normal /login page.
 */
import React, { useEffect, useState } from "react";
import api, { setStoredToken } from "@/lib/api";
import { toast } from "sonner";
import PinPad from "./PinPad";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { SignOut, Fingerprint } from "@phosphor-icons/react";
import { unlockWithBiometric, isBiometricSupported } from "@/lib/webauthn";

export default function PinLockScreen({ user, onUnlocked, onBailToLogin }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    isBiometricSupported().then(setBioSupported);
  }, []);

  // If biometric is enrolled + supported, auto-trigger the OS prompt as soon
  // as the lock screen mounts. The user can dismiss the sheet and fall back
  // to the PIN pad if they prefer.
  useEffect(() => {
    if (!bioSupported || !user?.biometric_enabled) return;
    tryBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bioSupported, user?.biometric_enabled]);

  const tryBiometric = async () => {
    if (bioBusy || checking) return;
    setBioBusy(true); setError("");
    try {
      const { data } = await unlockWithBiometric();
      if (data?.access_token) setStoredToken(data.access_token);
      toast.success("Unlocked");
      // Re-fetch /auth/me to keep the user object canonical
      const me = await api.get("/auth/me");
      onUnlocked?.(me.data);
    } catch (e) {
      const name = e?.name || "";
      if (name === "NotAllowedError" || name === "AbortError") {
        // User dismissed the OS prompt — no noise, they can retype PIN
      } else {
        setError(e?.response?.data?.detail || "Biometric unlock failed. Try your PIN.");
      }
    } finally {
      setBioBusy(false);
    }
  };

  const submit = async (val) => {
    if (checking) return;
    setChecking(true);
    setError("");
    try {
      const { data } = await api.post("/auth/pin/verify", {
        email: user.email,
        pin: val,
      });
      if (data?.access_token) setStoredToken(data.access_token);
      const { access_token: _t, ...rest } = data || {};
      toast.success("Unlocked");
      onUnlocked?.(rest);
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || "Wrong PIN";
      setPin("");
      if (status === 429) {
        toast.error(detail);
        setTimeout(() => onBailToLogin?.(), 900);
      } else {
        setError(detail);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background p-6"
      data-testid="pin-lock-screen"
    >
      <div className="flex flex-col items-center gap-2 mb-6">
        <UserAvatar name={user?.name} photoUrl={user?.photo_url} size="lg" className="w-14 h-14 !text-lg" />
        <h1 className="font-display text-xl font-semibold mt-1">Welcome back, {user?.name?.split(" ")[0] || "there"}</h1>
        <p className="text-xs text-muted-foreground">Enter your 4-digit PIN to unlock</p>
      </div>

      <PinPad
        value={pin}
        onChange={(v) => { setPin(v); setError(""); }}
        onSubmit={submit}
        error={error}
        disabled={checking || bioBusy}
        testid="pin-lock-pad"
      />

      <div className="mt-6 flex flex-col items-center gap-2">
        {bioSupported && user?.biometric_enabled && (
          <Button
            variant="outline"
            size="sm"
            onClick={tryBiometric}
            disabled={bioBusy || checking}
            data-testid="pin-lock-biometric"
            className="gap-1.5"
          >
            <Fingerprint size={16} weight="duotone" />
            {bioBusy ? "Waiting for prompt…" : "Use Face ID / Touch ID"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onBailToLogin}
          data-testid="pin-lock-signin-instead"
          className="text-xs text-muted-foreground"
        >
          <SignOut size={14} className="mr-1.5" />
          Sign in with password instead
        </Button>
      </div>
    </div>
  );
}

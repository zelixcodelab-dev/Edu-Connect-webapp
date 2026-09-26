import React, { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Fingerprint, CheckCircle, Trash, Warning } from "@phosphor-icons/react";
import { enrolPasskey, disableBiometric, isBiometricSupported } from "@/lib/webauthn";

export default function PasskeySettings() {
  const [status, setStatus] = useState(null);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/webauthn/status");
      setStatus(data);
    } catch { setStatus({ configured: false, biometric_enabled: false, count: 0 }); }
  }, []);

  useEffect(() => {
    load();
    isBiometricSupported().then(setSupported);
  }, [load]);

  const add = async () => {
    setBusy(true);
    try {
      await enrolPasskey();
      toast.success("Passkey added — you can now unlock with your fingerprint or face.");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Could not add passkey");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm("Remove all passkeys from this account?")) return;
    setBusy(true);
    try {
      await disableBiometric();
      toast.success("Passkeys removed");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to remove"); }
    finally { setBusy(false); }
  };

  if (!status) return null;

  return (
    <Card className="p-6 border border-border bg-card rounded-lg shadow-none" data-testid="passkey-settings">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary"><Fingerprint size={20} /></div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold">Passkey / Biometric unlock</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Add a passkey (Touch ID, Face ID, Windows Hello or a security key) to unlock your workspace without typing your password.</p>

          {!status.configured ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700" data-testid="passkey-not-configured">
              <Warning size={16} /> Passkeys aren’t configured on the server yet.
            </div>
          ) : !supported ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
              <Warning size={16} /> This device/browser doesn’t support platform passkeys.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {status.biometric_enabled && (
                <div className="flex items-center gap-2 text-sm text-emerald-600" data-testid="passkey-active">
                  <CheckCircle size={16} weight="fill" /> {status.count} passkey{status.count === 1 ? "" : "s"} enrolled on this account.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={add} disabled={busy} className="bg-primary text-primary-foreground border-0" data-testid="add-passkey-btn">
                  <Fingerprint size={16} className="mr-1.5" /> {busy ? "Waiting…" : status.biometric_enabled ? "Add another passkey" : "Add passkey"}
                </Button>
                {status.biometric_enabled && (
                  <Button onClick={remove} disabled={busy} variant="ghost" className="text-rose-600" data-testid="remove-passkey-btn">
                    <Trash size={16} className="mr-1.5" /> Remove all
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

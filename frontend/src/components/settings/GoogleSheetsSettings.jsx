import React, { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { GoogleLogo, CheckCircle, LinkSimpleBreak, Table as TableIcon, ArrowClockwise, Warning } from "@phosphor-icons/react";

export default function GoogleSheetsSettings() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/google/status");
      setStatus(data);
    } catch {
      setStatus({ configured: false, connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Handle the OAuth redirect back (?google=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get("google");
    if (g === "connected") {
      toast.success("Google account connected");
      load();
    } else if (g === "error") {
      toast.error("Google connection failed. Please try again.");
    }
    if (g) {
      params.delete("google");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [load]);

  const connect = async () => {
    setBusy(true);
    try {
      // No origin param: the backend uses its GOOGLE_REDIRECT_URI env, which
      // must point to the BACKEND's own callback (frontend + backend may be on
      // different domains in production).
      const { data } = await api.get("/google/connect");
      window.location.assign(data.authorization_url);
    } catch {
      toast.error("Could not start Google sign-in");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect your Google account? Sheet imports will stop working until you reconnect.")) return;
    setBusy(true);
    try {
      await api.delete("/google/disconnect");
      toast.success("Google account disconnected");
      await load();
    } catch {
      toast.error("Could not disconnect");
    } finally {
      setBusy(false);
    }
  };

  const createTemplate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/google/template", { title: "KM Connect — Leads Import" });
      toast.success("Lead sheet created in your Google Drive");
      if (data.url) window.open(data.url, "_blank", "noopener");
    } catch {
      toast.error("Could not create the template sheet");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  return (
    <Card className="p-6 border border-border bg-card rounded-lg shadow-none" data-testid="google-sheets-settings">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <GoogleLogo size={22} weight="bold" className="text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">Google Sheets</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Connect your Google account to import leads straight from a spreadsheet into a campaign.
          </p>

          {!status?.configured ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400" data-testid="google-not-configured">
              <Warning size={16} className="mt-0.5 shrink-0" />
              <span>Google Sheets isn’t configured on the server yet. Add the Google OAuth Client ID &amp; Secret to enable it.</span>
            </div>
          ) : status?.connected ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm" data-testid="google-connected-state">
                <CheckCircle size={18} weight="fill" className="text-emerald-600" />
                <span className="text-foreground font-medium">Connected</span>
                {status.google_email && <span className="text-muted-foreground">· {status.google_email}</span>}
              </div>
              {status.needs_reconnect && (
                <div className="flex items-center gap-2 text-xs text-amber-600" data-testid="google-needs-reconnect">
                  <Warning size={14} /> Authorization expired — please reconnect.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={createTemplate} disabled={busy} data-testid="google-create-template-btn">
                  <TableIcon size={15} className="mr-1.5" /> Create lead sheet
                </Button>
                <Button variant="outline" size="sm" onClick={connect} disabled={busy} data-testid="google-reconnect-btn">
                  <ArrowClockwise size={15} className="mr-1.5" /> Reconnect
                </Button>
                <Button variant="outline" size="sm" onClick={disconnect} disabled={busy} data-testid="google-disconnect-btn" className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10">
                  <LinkSimpleBreak size={15} className="mr-1.5" /> Disconnect
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Open any campaign → <span className="font-medium text-foreground">Import from Sheets</span> to pull leads in.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <Button onClick={connect} disabled={busy} data-testid="google-connect-btn" className="btn-amber border-0">
                <GoogleLogo size={16} weight="bold" className="mr-2" />
                {busy ? "Redirecting…" : "Sign in with Google"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

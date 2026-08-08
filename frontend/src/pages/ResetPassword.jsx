import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { useBranding } from "@/lib/branding";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Sun, Moon, Eye, EyeSlash, CheckCircle, Warning } from "@phosphor-icons/react";

export default function ResetPassword() {
  const { theme, toggle } = useTheme();
  const { branding } = useBranding();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      setDone(true);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(detail ? formatApiError(detail) : err?.message || formatApiError(null));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-6 relative">
      <button
        type="button"
        onClick={toggle}
        data-testid="reset-theme-toggle"
        className="absolute top-6 right-6 w-10 h-10 rounded-full bg-muted/60 hover:bg-muted text-foreground flex items-center justify-center transition-colors"
        title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      >
        {theme === "dark" ? <Sun size={18} weight="fill" className="text-amber-400" /> : <Moon size={18} weight="fill" className="text-orange-600" />}
      </button>

      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="flex items-center gap-2.5">
          <BrandMark size={40} />
          <div className="flex flex-col">
            <span className="font-display text-base font-semibold leading-tight">{branding?.app_name || "EduConnect Pro"}</span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{branding?.company_line || ""}</span>
          </div>
        </div>

        {!token ? (
          <div className="space-y-5" data-testid="reset-no-token">
            <div className="space-y-3">
              <p className="label-eyebrow">Invalid link</p>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Missing reset token</h2>
            </div>
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 dark:bg-rose-500/10 p-5 flex gap-4">
              <Warning size={28} weight="duotone" className="text-rose-600 dark:text-rose-400 shrink-0" />
              <p className="text-sm text-muted-foreground">This page needs a valid reset link. Please request a new one from the forgot-password page.</p>
            </div>
            <Link to="/forgot-password" data-testid="reset-request-new" className="inline-flex items-center gap-1.5 text-sm text-orange-600 dark:text-orange-400 font-medium hover:text-orange-700">
              Request a new link <ArrowRight size={14} />
            </Link>
          </div>
        ) : done ? (
          <div className="space-y-5" data-testid="reset-done-screen">
            <div className="space-y-3">
              <p className="label-eyebrow">All set</p>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Password updated</h2>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10 p-5 flex gap-4">
              <CheckCircle size={28} weight="duotone" className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <p className="text-sm text-muted-foreground">Your password has been reset successfully. You can now sign in with your new password.</p>
            </div>
            <Button onClick={() => nav("/login")} data-testid="reset-go-to-login" className="w-full h-12 btn-amber border-0 font-medium text-base">
              Go to sign in <ArrowRight size={16} className="ml-2" />
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <p className="label-eyebrow">Reset password</p>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Choose a new password</h2>
              <p className="text-muted-foreground text-sm">Pick a strong password you haven't used before. At least 8 characters.</p>
            </div>

            <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Input id="password" type={show ? "text" : "password"} data-testid="reset-password-input" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="new-password" className="h-11 pr-11" />
                  <button type="button" onClick={() => setShow((s) => !s)} data-testid="reset-toggle-visibility" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title={show ? "Hide" : "Show"}>
                    {show ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input id="confirm" type={show ? "text" : "password"} data-testid="reset-confirm-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="••••••••" autoComplete="new-password" className="h-11" />
              </div>

              {error && (
                <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5" data-testid="reset-error">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={submitting} data-testid="reset-submit-btn" className="w-full h-12 btn-amber border-0 font-medium text-base">
                {submitting ? "Updating…" : "Reset password"}
                <ArrowRight size={16} className="ml-2" />
              </Button>
            </form>

            <div className="text-sm text-muted-foreground">
              <Link to="/login" data-testid="link-login" className="text-orange-600 dark:text-orange-400 font-medium underline underline-offset-4 hover:text-orange-700">Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

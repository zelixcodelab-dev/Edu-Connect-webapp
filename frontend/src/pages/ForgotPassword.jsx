import React, { useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { useBranding } from "@/lib/branding";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Sun, Moon, EnvelopeSimple, CheckCircle } from "@phosphor-icons/react";

export default function ForgotPassword() {
  const { theme, toggle } = useTheme();
  const { branding } = useBranding();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
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
        data-testid="forgot-theme-toggle"
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

        {sent ? (
          <div className="space-y-5" data-testid="forgot-sent-screen">
            <div className="space-y-3">
              <p className="label-eyebrow">Check your inbox</p>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Reset link sent</h2>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10 p-5 flex gap-4">
              <CheckCircle size={28} weight="duotone" className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">If an account exists for that email, a reset link is on its way.</p>
                <p className="text-sm text-muted-foreground">Open the email and click the button to set a new password. The link expires in 30 minutes.</p>
              </div>
            </div>
            <Link to="/login" data-testid="forgot-back-to-login" className="inline-flex items-center gap-1.5 text-sm text-orange-600 dark:text-orange-400 font-medium hover:text-orange-700">
              <ArrowRight size={14} className="rotate-180" /> Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <p className="label-eyebrow">Forgot password</p>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Reset your password</h2>
              <p className="text-muted-foreground text-sm">Enter the email tied to your account and we'll send you a secure reset link.</p>
            </div>

            <form onSubmit={submit} className="space-y-4" data-testid="forgot-form">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" data-testid="forgot-email-input" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" className="h-11" />
              </div>

              {error && (
                <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5" data-testid="forgot-error">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={submitting} data-testid="forgot-submit-btn" className="w-full h-12 btn-amber border-0 font-medium text-base">
                <EnvelopeSimple size={16} className="mr-2" />
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
            </form>

            <div className="text-sm text-muted-foreground">
              Remembered it?{" "}
              <Link to="/login" data-testid="link-login" className="text-orange-600 dark:text-orange-400 font-medium underline underline-offset-4 hover:text-orange-700">Sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

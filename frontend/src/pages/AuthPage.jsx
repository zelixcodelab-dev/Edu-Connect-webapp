import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useBranding } from "@/lib/branding";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Sun, Moon, Sparkle, ShieldCheck, ChartBar, GraduationCap } from "@phosphor-icons/react";

export default function AuthPage({ mode }) {
  const isLogin = mode === "login";
  const { login, error, setError } = useAuth();
  const { theme, toggle } = useTheme();
  const { branding } = useBranding();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  const handle = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const ok = await login(form.email, form.password);
    setSubmitting(false);
    if (ok) nav("/");
  };

  const appName = branding?.app_name || "EduConnect Pro";
  const appShort = branding?.app_short || appName;

  return (
    <div
      className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-5 bg-background text-foreground"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Hero — brand gradient side */}
      <div className="relative hidden lg:flex lg:col-span-2 flex-col justify-between p-12 overflow-hidden bg-amber-gradient text-white">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 w-[28rem] h-[28rem] rounded-full bg-black/20 blur-3xl" />
        <div className="absolute inset-0 grain-overlay opacity-30" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/30 overflow-hidden">
            {branding?.logo_url ? (
              <img src={branding.logo_url} alt={appName} className="w-9 h-9 object-contain" />
            ) : (
              <GraduationCap size={26} weight="fill" className="text-white" />
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-display text-xl tracking-tight font-semibold leading-tight" data-testid="auth-brand-name">{appName}</span>
            <span className="text-[11px] uppercase tracking-[0.18em] text-white/80">{branding?.company_line}</span>
          </div>
        </div>

        <div className="relative z-10 max-w-md space-y-6">
          <span className="inline-flex items-center gap-2.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-xs uppercase tracking-[0.18em] font-semibold">
            <Sparkle size={14} weight="fill" /> {branding?.eyebrow}
          </span>
          <h1 className="font-display text-5xl xl:text-5xl font-bold leading-[1.20]">
            {branding?.hero_title}<br />
            <span className="text-white/90 font-light italic">{branding?.hero_accent}</span>
          </h1>
          <p className="text-white/70 text-base leading-relaxed">
            {branding?.hero_tagline}
          </p>
          <ul className="pt-2 space-y-3 text-sm text-white/90">
            <li className="flex items-center gap-3"><GraduationCap size={18} weight="duotone" /> Admissions, fees & student CRM</li>
            <li className="flex items-center gap-3"><ShieldCheck size={18} weight="duotone" /> Encrypted, role-based access</li>
            <li className="flex items-center gap-3"><ChartBar size={18} weight="duotone" /> Real-time dashboards & reports</li>
          </ul>
        </div>

        <div className="relative z-10 text-xs text-white/70">© {appName} · {new Date().getFullYear()}</div>
      </div>

      {/* Form */}
      <div className="lg:col-span-3 flex items-center justify-center p-6 lg:p-12 relative">
        <button
          type="button"
          onClick={toggle}
          data-testid="auth-theme-toggle"
          className="absolute top-6 right-6 w-10 h-10 rounded-full bg-muted/60 hover:bg-muted text-foreground flex items-center justify-center transition-colors"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {theme === "dark" ? <Sun size={18} weight="fill" className="text-amber-400" /> : <Moon size={18} weight="fill" className="text-orange-600" />}
        </button>

        <div className="w-full max-w-md space-y-8 animate-fade-in">
          <div className="space-y-3">
            {/* Mobile brand */}
            <div className="lg:hidden flex items-center gap-2.5 mb-6">
              <BrandMark size={40} />
              <div className="flex flex-col">
                <span className="font-display text-base font-semibold leading-tight">{appName}</span>
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{branding?.company_line}</span>
              </div>
            </div>
            <p className="label-eyebrow">{isLogin ? "Welcome back" : "Account access"}</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-foreground tracking-tight" data-testid="auth-heading">
              {isLogin ? `Sign in to ${appShort}` : "Request access"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {isLogin ? "Pick up where you left off." : "Accounts are created by your workspace administrator."}
            </p>
          </div>

          {!isLogin ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/40 p-5 text-sm text-muted-foreground">
                Self sign-up is disabled. Please ask your workspace administrator to create an account for you, then sign in.
              </div>
              <Link to="/login" data-testid="back-to-login" className="inline-flex items-center gap-1.5 text-sm text-orange-600 dark:text-orange-400 font-medium">
                <ArrowRight size={14} className="rotate-180" /> Back to sign in
              </Link>
            </div>
          ) : (
          <form onSubmit={submit} className="space-y-4" data-testid="auth-form">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" data-testid="auth-email-input" value={form.email} onChange={handle("email")} required placeholder="you@company.com" autoComplete="email" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" data-testid="auth-password-input" value={form.password} onChange={handle("password")} required placeholder="••••••••" autoComplete="current-password" className="h-11" />
            </div>

            <div className="flex justify-end -mt-1">
              <Link to="/forgot-password" data-testid="link-forgot-password" className="text-sm text-orange-600 dark:text-orange-400 font-medium hover:text-orange-700">
                Forgot password?
              </Link>
            </div>

            {error && (
              <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5" data-testid="auth-error">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              data-testid="auth-submit-btn"
              className="w-full h-12 btn-amber border-0 font-medium text-base"
            >
              {submitting ? "Please wait…" : "Sign in"}
              <ArrowRight size={16} className="ml-2" />
            </Button>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PLATFORM_MODULES } from "@/lib/platformModules";
import { PlatformTopBar } from "@/components/platform/PlatformShell";
import { AttentionCard, useHasPermission, LoadingState } from "@/components/platform/PlatformKit";
import { Bell } from "lucide-react";

export default function PlatformHome() {
  const nav = useNavigate();
  const { user } = useAuth();
  const has = useHasPermission(user);
  const [summary, setSummary] = useState({});
  const [attention, setAttention] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        api.get("/platform/summary"),
        api.get("/platform/attention"),
      ]);
      setSummary(s.data || {});
      setAttention(a.data.items || []);
    } catch { /* topbar still usable */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const modules = PLATFORM_MODULES.filter((m) => has(m.perm));
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PlatformTopBar title="Home" home />
      <main className="max-w-[1240px] mx-auto px-4 md:px-8 py-8 space-y-10 platform-fade-in">
        <div>
          <p className="text-sm text-muted-foreground">{greet},</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
            {user?.name || "Platform Owner"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Your SaaS control center — clients, apps, infrastructure and support, all in one place.</p>
        </div>

        {/* Needs Your Attention */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-primary" />
            <h3 className="font-display text-lg font-semibold">Needs your attention</h3>
            {attention.length > 0 && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary" data-testid="attention-count">{attention.length}</span>
            )}
          </div>
          {loading ? (
            <LoadingState />
          ) : attention.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground flex items-center gap-2" data-testid="attention-empty">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> All clear — nothing needs your attention right now.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="attention-list">
              {attention.map((it, i) => <AttentionCard key={it.id} item={it} index={i} />)}
            </div>
          )}
        </section>

        {/* Module launcher */}
        <section className="space-y-4">
          <h3 className="font-display text-lg font-semibold">Modules</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6" data-testid="module-grid">
            {modules.map((m) => {
              const Icon = m.icon;
              const count = m.countKey ? summary[m.countKey] : undefined;
              return (
                <button
                  key={m.key}
                  onClick={() => nav(m.path)}
                  data-testid={`module-card-${m.key}`}
                  className={`group relative rounded-2xl border border-border bg-card p-5 sm:p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${m.ring} focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`}
                >
                  {typeof count === "number" && count > 0 && (
                    <span className="absolute top-4 right-4 text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground" data-testid={`module-count-${m.key}`}>{count}</span>
                  )}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-105 ${m.accent}`}>
                    <Icon size={24} strokeWidth={1.9} />
                  </div>
                  <p className="font-display font-semibold text-base sm:text-lg">{m.label}</p>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-snug">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { Search, Sun, Moon, LogOut, ArrowLeft, LayoutGrid } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Avatar } from "@/components/platform/PlatformKit";
import CommandPalette from "@/components/platform/CommandPalette";

// Shared sticky top bar for the whole Platform Console. `home` mode renders the
// launcher header; otherwise it shows a back-to-home affordance + module title.
export function PlatformTopBar({ title, eyebrow = "Platform Console", home = false }) {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const doLogout = async () => { await logout(); nav("/login"); };

  return (
    <>
      <header
        className="sticky top-0 z-40 bg-background/85 backdrop-blur-xl border-b border-border"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="h-16 px-4 md:px-8 max-w-[1240px] mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {!home && (
              <button onClick={() => nav("/platform")} data-testid="back-to-home"
                className="w-9 h-9 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center shrink-0" title="Platform home">
                <ArrowLeft size={17} />
              </button>
            )}
            <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
              <LayoutGrid size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">{eyebrow}</p>
              <h1 className="font-display text-lg font-semibold leading-tight truncate">{title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setPaletteOpen(true)} data-testid="global-search-trigger"
              className="hidden sm:inline-flex items-center gap-2 h-9 pl-3 pr-2 rounded-full bg-muted/60 hover:bg-muted text-sm text-muted-foreground transition-colors">
              <Search size={15} /> <span className="hidden md:inline">Search…</span>
              <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border">⌘K</kbd>
            </button>
            <button onClick={() => setPaletteOpen(true)} className="sm:hidden w-9 h-9 rounded-full bg-muted/60 flex items-center justify-center" title="Search"><Search size={16} /></button>
            <button onClick={toggle} className="w-9 h-9 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center" title="Toggle theme" data-testid="theme-toggle">
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="hidden md:flex items-center gap-2 pl-1">
              <Avatar name={user?.name} size={32} />
              <div className="text-right">
                <p className="text-xs font-medium leading-tight">{user?.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{(user?.role || "platform_owner").replace("_", " ")}</p>
              </div>
            </div>
            <button onClick={doLogout} title="Sign out" data-testid="platform-logout"
              className="w-9 h-9 rounded-full bg-muted/60 hover:bg-rose-500/15 hover:text-rose-600 flex items-center justify-center">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}

// Module inner layout: top bar + left sub-navigation + scrollable content.
export default function PlatformShell({ module, title, active, children }) {
  const subnav = module?.subnav || [];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PlatformTopBar title={title || module?.label} />
      <div className="max-w-[1240px] mx-auto flex">
        {subnav.length > 0 && (
          <aside className="hidden lg:flex w-56 shrink-0 flex-col gap-1 p-4 border-r border-border min-h-[calc(100vh-4rem)]">
            {subnav.map((item, i) => (
              <button key={item} data-testid={`subnav-${item.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  (active ? active === item : i === 0)
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}>
                {item}
              </button>
            ))}
          </aside>
        )}
        <main className="flex-1 min-w-0 p-4 md:p-8 platform-fade-in">{children}</main>
      </div>
    </div>
  );
}

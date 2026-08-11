import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft } from "lucide-react";
import api from "@/lib/api";
import { PLATFORM_MODULES } from "@/lib/platformModules";

// Global command palette — opens on Ctrl/Cmd+K. Searches modules locally and
// clients/tickets/etc. server-side (/platform/search), grouped by entity type.
export default function CommandPalette({ open, onClose }) {
  const nav = useNavigate();
  const inputRef = useRef(null);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState([]);

  const moduleMatches = PLATFORM_MODULES.filter((m) =>
    !q || m.label.toLowerCase().includes(q.toLowerCase()) || m.desc.toLowerCase().includes(q.toLowerCase()),
  ).map((m) => ({ id: m.key, title: m.label, subtitle: m.desc, link: m.path }));

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
    else { setQ(""); setGroups([]); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      if (!q.trim()) { setGroups([]); return; }
      try {
        const { data } = await api.get(`/platform/search`, { params: { q } });
        setGroups(data.groups || []);
      } catch { setGroups([]); }
    }, 220);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = useCallback((link) => { onClose(); nav(link); }, [nav, onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const allGroups = [{ type: "Modules", items: moduleMatches }, ...groups].filter((g) => g.items.length);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4" data-testid="command-palette">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="platform-pop relative w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <Search size={18} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search modules, clients, users, tickets…"
            data-testid="command-palette-input"
            className="flex-1 h-14 bg-transparent outline-none text-base placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">ESC</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {allGroups.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {q ? "No results found." : "Type to search across the platform."}
            </p>
          ) : allGroups.map((g) => (
            <div key={g.type} className="mb-2">
              <p className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{g.type}</p>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => go(it.link)}
                  data-testid={`command-result-${it.id}`}
                  className="group w-full text-left px-3 py-2.5 rounded-lg hover:bg-primary/10 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{it.title}</p>
                    {it.subtitle && <p className="text-xs text-muted-foreground truncate">{it.subtitle}</p>}
                  </div>
                  <CornerDownLeft size={14} className="opacity-0 group-hover:opacity-100 text-primary shrink-0" />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

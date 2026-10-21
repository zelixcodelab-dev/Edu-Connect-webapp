import React, { useState } from "react";
import { House, GraduationCap, ChatCircle, Wallet, Plus, Check } from "@phosphor-icons/react";
import { brandSwatch } from "@/lib/branding";

const THEMES = {
  light: { page: "#ffffff", card: "#f7f7f7", text: "#121212", muted: "#737373", border: "#ebebeb", rail: "#0a0a0a" },
  dark: { page: "#0d0d0d", card: "#1a1a1a", text: "#f5f5f5", muted: "#9e9e9e", border: "#2b2b2b", rail: "#212121" },
};
const RAIL = [House, GraduationCap, ChatCircle, Wallet];

// Mini mock of the client app painted with the colour being picked.
export function BrandPreview({ color }) {
  const [mode, setMode] = useState("light");
  const t = THEMES[mode];
  const s = brandSwatch(color, mode === "dark");
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState(0);

  return (
    <div className="space-y-3" data-testid="brand-live-preview">
      <div className="flex items-center justify-between">
        <p className="label-eyebrow">Live preview</p>
        <div className="inline-flex rounded-full bg-muted p-0.5 text-xs" role="group">
          {["light", "dark"].map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} data-testid={`preview-mode-${m}`}
              className={`px-3 py-1 rounded-full capitalize transition-colors ${mode === m ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>{m}</button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl p-3 flex gap-3 transition-colors duration-300" style={{ background: t.page, color: t.text, border: `1px solid ${t.border}` }}>
        <div className="w-12 rounded-2xl py-3 flex flex-col items-center gap-2" style={{ background: t.rail }} data-testid="preview-rail">
          {RAIL.map((Icon, i) => (
            <span key={i} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors duration-300"
              style={i === 0 ? { background: s.bg, color: s.fg } : { color: "rgba(255,255,255,0.65)" }}>
              <Icon size={15} weight={i === 0 ? "fill" : "regular"} />
            </span>
          ))}
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex gap-3 text-xs" style={{ borderBottom: `1px solid ${t.border}` }}>
            {["Overview", "Students"].map((l, i) => (
              <button key={l} type="button" onClick={() => setTab(i)} data-testid={`preview-tab-${i}`} className="pb-1.5 transition-colors"
                style={tab === i ? { color: s.bg, boxShadow: `inset 0 -2px 0 ${s.bg}`, fontWeight: 600 } : { color: t.muted }}>{l}</button>
            ))}
          </div>
          <div className="rounded-xl p-3 space-y-2.5" style={{ background: t.card }}>
            <p className="text-sm font-semibold">New admission</p>
            <p className="text-xs" style={{ color: t.muted }}>Fee reminder sent · <span style={{ color: s.bg }} className="font-medium underline-offset-2 hover:underline">View student</span></p>
            <div className="flex items-center gap-3 text-xs">
              <button type="button" onClick={() => setOn((v) => !v)} data-testid="preview-switch" aria-pressed={on}
                className="w-8 h-[18px] rounded-full p-0.5 transition-colors" style={{ background: on ? s.bg : t.border }}>
                <span className="block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform" style={{ transform: on ? "translateX(14px)" : "none" }} />
              </button>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-4 rounded flex items-center justify-center" style={{ background: s.bg, color: s.fg }}><Check size={11} weight="bold" /></span>
                Paid
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="h-9 px-4 rounded-full text-xs font-medium inline-flex items-center gap-1.5 shadow-sm transition-colors duration-300" style={{ background: s.bg, color: s.fg }} data-testid="preview-primary-btn">
              <Plus size={13} weight="bold" /> Save changes
            </button>
            <button type="button" className="h-9 px-4 rounded-full text-xs font-medium" style={{ border: `1px solid ${t.border}`, color: t.text }}>Cancel</button>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Button text turns black or white automatically so it stays readable.</p>
    </div>
  );
}

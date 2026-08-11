import React from "react";
import { useParams, Navigate } from "react-router-dom";
import { MODULE_BY_KEY } from "@/lib/platformModules";
import PlatformShell from "@/components/platform/PlatformShell";
import { EmptyState } from "@/components/platform/PlatformKit";
import { Hammer } from "lucide-react";

// Generic shell for modules whose full build lands in a later phase. Shows the
// real sub-navigation + an honest empty state (no fake data).
const PHASE = {
  "my-apps": "Phase 3",
  database: "Phase 4",
  "vps-server": "Phase 4",
  connect: "Phase 2",
  settings: "Phase 3",
};

export default function PlatformModulePage() {
  const { moduleKey } = useParams();
  const module = MODULE_BY_KEY[moduleKey];
  if (!module) return <Navigate to="/platform" replace />;

  return (
    <PlatformShell module={module} title={module.label}>
      <div className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">{module.label}</p>
        <h2 className="font-display text-2xl font-semibold tracking-tight">{module.desc}</h2>
      </div>
      <EmptyState
        icon={Hammer}
        title={`${module.label} arrives in ${PHASE[moduleKey] || "an upcoming phase"}`}
        desc="The navigation and architecture are in place. This module will be built out next with fully functional, real data — no placeholders."
      />
    </PlatformShell>
  );
}

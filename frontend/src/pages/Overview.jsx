import React from "react";
import { useAuth } from "@/lib/auth";
import { greetingForNow } from "@/lib/format";
import { HubTile } from "@/pages/SectionHub";
import { launcherItems } from "@/pages/AppShell";
import Dashboard from "@/pages/Dashboard";

const LAUNCHER_ROLES = ["super_admin", "office_admin"];

export default function Overview() {
  const { user } = useAuth();
  if (!LAUNCHER_ROLES.includes(user?.role)) return <Dashboard />;
  const items = launcherItems(user);
  return (
    <div className="space-y-7" data-testid="overview-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{greetingForNow()}</p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-1" data-testid="overview-greeting">
            Hi {user?.name?.split(" ")[0] || "there"}.
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Where would you like to go today?</p>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="overview-count">{items.length} destinations</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-5" data-testid="home-launcher-grid">
        {items.map((item, i) => <HubTile key={item.tid} item={item} index={i} />)}
      </div>
    </div>
  );
}

import React from "react";
import OfficeDashboard from "./OfficeDashboard";

// Super Admin view of an office's overview (Lead CRM + Admissions & Incentive)
// with an office switcher. Reuses the OfficeDashboard component in `superView`.
export default function OfficeOverview() {
  return <OfficeDashboard superView />;
}

import { useEffect, useState } from "react";
import api from "@/lib/api";

const MAP = {
  "/messages": ["unread_messages", "unread"],
  "/leads": ["followups_due", "due"],
  "/students": ["new_applications", "new"],
  "/expense-requests": ["pending_approvals", "pending"],
};

// Live attention counts for launcher tiles; section tiles sum their pages.
export function useTileAlerts(childrenOf) {
  const [d, setD] = useState({});
  useEffect(() => {
    let off = false;
    const load = () => api.get("/dashboard/inbox").then((r) => { if (!off) setD(r.data || {}); }).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => { off = true; clearInterval(id); };
  }, []);
  const one = (to) => {
    const m = MAP[to];
    return m && d[m[0]] > 0 ? { n: d[m[0]], label: m[1] } : null;
  };
  return (item) => {
    const kids = childrenOf?.(item);
    if (!kids) return one(item.to);
    const n = kids.reduce((s, k) => s + (one(k.to)?.n || 0), 0);
    return n > 0 ? { n, label: "to do" } : null;
  };
}

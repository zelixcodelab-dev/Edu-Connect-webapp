import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  isPushSupported,
  permissionState,
  subscribeToPush,
  unsubscribeFromPush,
  currentSubscription,
} from "@/lib/push";
import {
  Bell, Check, ReceiptX, Receipt, GraduationCap, Trash, BellSlash, BellRinging,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import UserAvatar from "@/components/UserAvatar";

const TYPE_ICON = {
  expense_request: { icon: ReceiptX, palette: "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400" },
  transaction: { icon: Receipt, palette: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  student_enrolled: { icon: GraduationCap, palette: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
};

function timeAgo(iso) {
  try {
    const t = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - t);
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return ""; }
}

export default function NotificationsBell() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const popRef = useRef(null);

  const loadUnread = useCallback(async () => {
    if (!user || user === false) return;
    try {
      const { data } = await api.get("/notifications/unread-count");
      setUnread(data?.count || 0);
    } catch (err) {
      console.error("[notifications] unread fetch failed:", err?.message || err);
    }
  }, [user]);

  const loadList = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications?limit=25");
      setItems(data || []);
    } catch (err) {
      console.error("[notifications] list fetch failed:", err?.message || err);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => { loadUnread(); }, [loadUnread]);
  useEffect(() => {
    if (!user || user === false) return undefined;
    const id = setInterval(loadUnread, 30000);
    return () => clearInterval(id);
  }, [user, loadUnread]);

  // Refresh on tab focus
  useEffect(() => {
    if (!user || user === false) return undefined;
    const onVisible = () => { if (document.visibilityState === "visible") loadUnread(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user, loadUnread]);

  // Click-away
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onToggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  };

  const onClickItem = async (n) => {
    if (!n.read) {
      try {
        await api.post(`/notifications/${n.id}/read`);
      } catch (err) {
        console.error("[notifications] mark-read failed:", err?.message || err);
      }
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.link) nav(n.link);
  };

  const onMarkAll = async () => {
    try {
      await api.post("/notifications/read-all");
    } catch (err) {
      console.error("[notifications] mark-all failed:", err?.message || err);
    }
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
  };

  const onDelete = async (e, n) => {
    e.stopPropagation();
    try {
      await api.delete(`/notifications/${n.id}`);
    } catch (err) {
      console.error("[notifications] delete failed:", err?.message || err);
    }
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.read) setUnread((u) => Math.max(0, u - 1));
  };

  return (
    <div ref={popRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        data-testid="notifications-bell"
        className="relative w-10 h-10 rounded-full bg-muted/60 hover:bg-muted text-foreground flex items-center justify-center transition-colors"
        title="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span
            data-testid="notifications-badge"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-background"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notifications-popover"
          className="fixed sm:absolute right-3 sm:right-0 top-[60px] sm:top-auto sm:mt-2 w-[calc(100vw-1.5rem)] sm:w-[360px] max-h-[480px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/10 dark:shadow-black/40 z-50 flex flex-col"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <p className="label-eyebrow">Notifications</p>
              <p className="text-xs text-muted-foreground">
                {unread > 0 ? `${unread} unread` : "All caught up"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <PushToggle />
              {unread > 0 && (
                <button
                  onClick={onMarkAll}
                  data-testid="notifications-mark-all"
                  className="text-xs text-orange-600 dark:text-orange-400 hover:text-orange-700 inline-flex items-center gap-1"
                >
                  <Check size={12} weight="bold" /> Mark all read
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center" data-testid="notifications-empty">
                <BellSlash size={28} weight="duotone" className="mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground mt-2">No notifications yet.</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  You'll see new expense requests, transactions and student admissions here.
                </p>
              </div>
            ) : (
              items.map((n) => {
                const meta = TYPE_ICON[n.type] || TYPE_ICON.transaction;
                const Icon = meta.icon;
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onClickItem(n)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClickItem(n); } }}
                    data-testid={`notification-${n.id}`}
                    className={`group w-full text-left px-4 py-3 border-b border-border/60 hover:bg-muted/40 cursor-pointer transition-colors flex gap-3 outline-none focus:bg-muted/40 ${
                      n.read ? "" : "bg-orange-500/5 dark:bg-orange-500/10"
                    }`}
                  >
                    <div className={`relative w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.palette}`}>
                      <Icon size={16} weight="duotone" />
                      {n.actor_photo_url && (
                        <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-card">
                          <UserAvatar
                            name={n.actor_name}
                            photoUrl={n.actor_photo_url}
                            size="xs"
                            testid={`notification-actor-${n.id}`}
                          />
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className={`text-sm flex-1 ${n.read ? "text-muted-foreground" : "text-foreground font-medium"}`}>
                          {n.title}
                        </p>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-orange-500 mt-2 shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => onDelete(e, n)}
                      data-testid={`notification-delete-${n.id}`}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-rose-600 self-start p-1"
                      title="Delete"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Tiny toggle that flips the device's Web Push subscription on/off.
 * Always renders so the user can discover the feature; when the runtime
 * doesn't support Web Push (e.g. iOS Safari not yet installed as a PWA,
 * or an in-app webview), clicking explains how to enable it. */
function PushToggle() {
  const supported = isPushSupported();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supported) return;
      const sub = await currentSubscription();
      if (!cancelled) setEnabled(!!sub && permissionState() === "granted");
    })();
    return () => { cancelled = true; };
  }, [supported]);

  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent || "");
  const isStandalone = typeof window !== "undefined" && (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );

  const onClick = async () => {
    if (busy) return;
    if (!supported) {
      // Guide the user to enable push on platforms that need an extra step.
      if (isIOS && !isStandalone) {
        toast.message("Add to Home Screen to enable push", {
          description: "Tap the Share icon in Safari, then 'Add to Home Screen'. Open the app from the home-screen icon and tap Enable again.",
          duration: 8000,
        });
      } else {
        toast.message("Push notifications unavailable", {
          description: "This browser doesn't support push. Try Chrome, Edge, or open this site as an installed app.",
          duration: 6000,
        });
      }
      return;
    }
    if (permissionState() === "denied") {
      toast.message("Notifications are blocked", {
        description: "Open this site's settings in your browser and allow Notifications, then tap Enable again.",
        duration: 7000,
      });
      return;
    }
    setBusy(true);
    try {
      if (enabled) {
        await unsubscribeFromPush();
        setEnabled(false);
        toast.success("Push notifications turned off on this device");
      } else {
        await subscribeToPush();
        setEnabled(true);
        toast.success("Push notifications enabled");
      }
    } catch (e) {
      toast.error(e?.message || "Couldn't update push subscription");
    } finally {
      setBusy(false);
    }
  };

  const label = enabled ? "On" : "Enable";
  const title = !supported
    ? (isIOS && !isStandalone ? "Tap to learn how to enable push on iPhone" : "Push not supported in this browser")
    : enabled
      ? "Push notifications: ON (tap to disable)"
      : "Enable push notifications on this device";

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="push-toggle"
      title={title}
      className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 transition-colors ${
        enabled
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25"
          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <BellRinging size={12} weight={enabled ? "fill" : "regular"} />
      {label}
    </button>
  );
}

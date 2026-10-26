// Home-screen app icon badge = unread bell notifications + unread messages.
const parts = { notif: 0, msgs: 0 };

function apply() {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (!nav || !("setAppBadge" in nav)) return;
  const total = parts.notif + parts.msgs;
  const p = total > 0 ? nav.setAppBadge(total) : nav.clearAppBadge();
  p?.catch?.(() => {});
}

export function setBadgePart(key, n) {
  parts[key] = Math.max(0, Number(n) || 0);
  apply();
}

export function clearAppBadge() {
  parts.notif = 0;
  parts.msgs = 0;
  apply();
}

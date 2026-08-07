// Web Push helper — subscribe/unsubscribe the current device.
import api from "./api";

const urlBase64ToUint8Array = (b64) => {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const safe = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(safe);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
};

export const isPushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const permissionState = () =>
  isPushSupported() ? Notification.permission : "unsupported";

/** Returns the current PushSubscription on this device, or null. */
export async function currentSubscription() {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush() {
  if (!isPushSupported()) throw new Error("Push not supported on this device");
  const reg = await navigator.serviceWorker.ready;
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permission denied");
  const { data } = await api.get("/push/vapid-public-key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.public_key),
    });
  }
  const json = sub.toJSON();
  await api.post("/push/subscribe", {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    user_agent: navigator.userAgent.slice(0, 240),
  });
  return sub;
}

export async function unsubscribeFromPush() {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await api.delete(`/push/unsubscribe?endpoint=${encodeURIComponent(sub.endpoint)}`);
  } catch (_) { /* ignore */ }
  await sub.unsubscribe();
}

// EduConnect Pro — minimal service worker for PWA installability + basic offline shell.
// Strategy:
//   - Cache the app shell (HTML, CSS, JS, icons) on first load.
//   - Network-first for everything (so users always get fresh data when online).
//   - Fall back to cache when offline so the shell still loads.
//   - Handle Web Push events → show OS-level notifications even when the app
//     is closed.

const CACHE = "educonnect-shell-v3";
const SHELL = [
  "/manifest.json",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/pwa-icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => null)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.url.includes("/api/")) return;
  const dest = req.destination;
  // Never cache the HTML document — always go to the network so the user
  // never gets stuck on a stale shell pointing at obsolete JS bundle hashes.
  // We DO fall back to the cached "/" shell if completely offline.
  if (dest === "document" || req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/") || caches.match(req)),
    );
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && new URL(req.url).origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("/"))),
  );
});

// ── Web Push ─────────────────────────────────────────────────────────────
// Payload shape pushed by the server (see backend/lib/push.py):
//   { title, body, url, tag, icon, badge }

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { /* not JSON */ }
  const title = data.title || "EduConnect Pro";
  const options = {
    body: data.body || "",
    icon: data.icon || "/pwa-icon-192.png",
    badge: data.badge || "/favicon.png",
    tag: data.tag || "EduConnect Pro",
    data: { url: data.url || "/" },
    renotify: false,
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clientsList) {
        try {
          if (c.url && "focus" in c) {
            await c.focus();
            if ("navigate" in c) await c.navigate(url);
            return;
          }
        } catch (_) { /* ignore */ }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

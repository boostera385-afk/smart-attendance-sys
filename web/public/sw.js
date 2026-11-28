/* Pastry Presence service worker.
 * - Makes the app installable and opens instantly from the desktop / home screen.
 * - Caches only static build assets (/_next/static, icons). Pages, API calls and Supabase data are
 *   never cached: attendance, salary and selfies must always be live and private.
 * - Shows a branded offline page when there is no connection.
 * - Shows and handles clicks on break / shift-end notifications.
 */
const VERSION = "presence-v1";
const STATIC = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC).then((c) => c.addAll([OFFLINE_URL, "/icon-192.png", "/icon.svg"])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always network; offline page only when the network is down.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Immutable build assets + icons: cache first.
  if (url.pathname.startsWith("/_next/static/") || /^\/(icon[\w-]*\.(png|svg)|apple-touch-icon\.png)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/me", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin)) {
          client.focus();
          return client.navigate ? client.navigate(target) : undefined;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

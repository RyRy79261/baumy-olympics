// Baumy Olympics' service worker (SPEC §8, issue #29). It has ONE job: when
// the kitchen iPad cannot reach the server, show /offline.html instead of
// Safari's error page. There is no offline data: it caches nothing else, and
// never answers from the cache while the network answers. Registered by the
// kiosk shell (components/kiosk/service-worker.tsx); served with
// `Cache-Control: no-cache` (next.config.ts) so a change here ships at once.

const CACHE = "baumy-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Page loads only; everything else goes to the network untouched.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const page = await caches.match(OFFLINE_URL);
      return page ?? Response.error();
    }),
  );
});

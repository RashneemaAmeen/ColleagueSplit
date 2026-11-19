/* ColleagueSplit service worker.
 *
 * Deliberately conservative — this is a financial app:
 *  - Only immutable, public static assets are cached (/_next/static, icons, the offline page).
 *  - Page HTML, API calls, Supabase requests and anything authenticated are NEVER cached:
 *    navigations go to the network and fall back to a generic offline page.
 *  - Non-GET requests (all writes) are never intercepted, and there is no background sync:
 *    financial changes need a live, authenticated connection.
 * Bump VERSION to invalidate old caches.
 */
const VERSION = "v1";
const STATIC_CACHE = `cs-static-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cs-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"))
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase / third parties

  // Page navigations: network only, offline page as the fallback. HTML is never stored.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match(OFFLINE_URL)) || new Response("You are offline.", { status: 503 });
      }),
    );
    return;
  }

  // Immutable static assets: cache-first.
  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
  }
  // Everything else (RSC payloads, API routes, auth) falls through to the network untouched.
});

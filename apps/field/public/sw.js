/**
 * Service worker — the part that makes "offline-first" literally true.
 *
 * Without this the app cannot even load with no network, and everything in core/ that
 * carefully avoids the network is moot. Strategy:
 *
 *   - navigations      cache-first, falling back to the cached shell. The operator opens
 *                      the app in a dead spot and it must come up.
 *   - static assets    cache-first, then network. Hashed filenames make this safe.
 *   - the API          network-only. Never serve a stale reading or index value from a
 *                      cache; the outbox is the offline mechanism, not this.
 */
const CACHE = 'harrow-field-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ingest and session calls must never be answered from a cache.
  if (url.pathname.startsWith('/v1/') || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});

// Makes SthapnaCorp installable. Pages always come from the network; if the phone is offline,
// a cached copy of a page the visitor has opened before is shown instead.
const CACHE = 'sc-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin || req.url.includes('/api/')) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && (req.mode === 'navigate' || /\/assets\//.test(req.url))) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req)));
});

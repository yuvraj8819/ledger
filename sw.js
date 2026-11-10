// Offline cache. Bump VERSION when files change so phones pick up the update.
const VERSION = 'ledger-1.5.0';
const FILES = ['./', './index.html', './css/app.css', './js/app.js', './js/calc.js', './js/store.js', './js/health.js', './js/nutrition.js', './js/foods.js', './js/scan.js', './js/icons.js', './js/sfx.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

// GitHub Pages lets browsers reuse files for 10 minutes. Every request here asks the server
// whether the file changed ("no-cache" = revalidate), so a new version never gets stuck behind an old copy.
const fresh = (url) => fetch(url, { cache: 'no-cache', credentials: 'same-origin' });

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => Promise.all(FILES.map((f) => fresh(f).then((r) => { if (r.ok) return c.put(f, r); }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // network first so updates show up, cache when offline
  e.respondWith(fresh(e.request.url)
    .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});

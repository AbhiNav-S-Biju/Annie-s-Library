// Service worker: app shell offline, libraries/fonts cached, covers cached (capped).
// Bump VERSION whenever you change files in SHELL so phones pick up the new build.
const VERSION = 'v5';
const SHELL_CACHE = `shell-${VERSION}`;
const LIB_CACHE = 'libs-v1';
const COVER_CACHE = 'covers-v1';
const COVER_MAX = 80;

const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'featured.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/config.js',
  'js/storage.js',
  'js/net.js',
  'js/icons.js',
  'js/overlay.js',
  'js/reader.js',
  'js/vendor.js',
  'js/search/searchTypes.js',
  'js/search/normaliseQuery.js',
  'js/search/lexicon.js',
  'js/search/transliteration.js',
  'js/search/fuzzyMatcher.js',
  'js/search/queryExpansion.js',
  'js/search/relevanceScorer.js',
  'js/search/mergeResults.js',
  'js/search/searchCache.js',
  'js/search/suggestions.js',
  'js/search/intelligentSearch.js',
  'js/categories.js',
  'js/pdf.js',
  'js/sources/ia.js',
  'js/sources/google.js',
  'js/sources/openlibrary.js',
];

const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const COVER_HOSTS = ['covers.openlibrary.org', 'books.google.com', 'books.googleusercontent.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL_CACHE, LIB_CACHE, COVER_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App navigation: network first (fresh deploys), cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('index.html')));
    return;
  }

  // Our own files: network first (a new deploy shows up immediately), cache when offline or slow.
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, SHELL_CACHE, 3500));
    return;
  }

  // Pinned CDN libraries and fonts: cache first (versioned URLs never change).
  if (LIB_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req, LIB_CACHE));
    return;
  }

  // Covers: cache first, capped. IA covers are opaque (no CORS), so keep the cap small.
  if (COVER_HOSTS.includes(url.hostname) || (url.hostname === 'archive.org' && url.pathname.startsWith('/services/img/'))) {
    e.respondWith(cacheFirst(req, COVER_CACHE, COVER_MAX));
    return;
  }
  // Everything else (APIs, page images) goes straight to the network; the app caches API JSON itself.
});

async function networkFirst(req, name, timeoutMs) {
  const cache = await caches.open(name);
  const attempt = () => fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  // One quick retry: a request made while the device is waking up or switching networks often fails once.
  const net = attempt().catch(() => new Promise((r) => setTimeout(r, 800)).then(attempt));
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs, null));
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch { /* offline: fall through to cache */ }
  // Current cache first, then any older cache (e.g. right after an update replaced the shell cache).
  const hit = (await cache.match(req, { ignoreSearch: true })) || (await caches.match(req, { ignoreSearch: true }));
  if (hit) return hit;
  // Surface a real network error (fetch rejects) rather than inventing an HTTP status.
  try { return await net; } catch { return Response.error(); }
}

async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      if (max) trim(cache, max);
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

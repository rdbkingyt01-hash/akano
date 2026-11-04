/* আকানো! — offline support
   Put this file in the SAME folder as index.html (served over https). */
const VER = 'v1';
const SHELL = 'akano-shell-' + VER;
const IMG = 'akano-img-' + VER;
const MAX_IMG = 300;

const OFFLINE_HTML =
  '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">' +
  '<title>Offline</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;' +
  'min-height:100vh;margin:0;background:#fff;color:#111;text-align:center"><div><h1>ইন্টারনেট নেই</h1>' +
  '<p>সংযোগ ফিরলে আবার চেষ্টা করুন।</p></div></body>';

// never cache these (live data, auth, video players)
const SKIP = /(^|\.)(firestore|identitytoolkit|securetoken|firebaseinstallations)\.googleapis\.com$|vimeo|youtube|googletagmanager|google-analytics/i;
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif|svg)(\?|$)/i;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.add(new Request(self.registration.scope, { cache: 'reload' })))
      .catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== IMG).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_IMG) {
    await Promise.all(keys.slice(0, keys.length - MAX_IMG).map(k => cache.delete(k)));
  }
}

// pages: network first (so updates show up), cached copy when offline
async function page(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    return (
      (await cache.match(req, { ignoreSearch: true })) ||
      (await cache.match(self.registration.scope)) ||
      new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    );
  }
}

// images: cache first, fetch once and keep
async function image(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      cache.put(req.url, res.clone());
      trim(cache);
      return res;
    }
  } catch (_) {}
  try {
    return await fetch(req); // opaque fallback, not cached
  } catch (_) {
    return Response.error();
  }
}

// scripts / fonts / same-origin files: stale-while-revalidate
function swr(e) {
  const req = e.request;
  e.respondWith(
    caches.open(SHELL).then(async cache => {
      const hit = await cache.match(req);
      const net = fetch(req)
        .then(res => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        e.waitUntil(net);
        return hit;
      }
      return (await net) || Response.error();
    })
  );
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol) || SKIP.test(url.hostname)) return;

  if (req.mode === 'navigate') {
    e.respondWith(page(req));
    return;
  }
  if (req.destination === 'image' || (url.origin !== location.origin && IMG_EXT.test(url.pathname))) {
    e.respondWith(image(req));
    return;
  }
  if (
    url.origin === location.origin ||
    /(^|\.)(gstatic\.com|fonts\.googleapis\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)
  ) {
    swr(e);
  }
});

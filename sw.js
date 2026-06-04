const CACHE_NAME = 'spensada-cbt-v9-20260605';
const urlsToCache = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        urlsToCache.map(url =>
          fetch(url).then(r => { if (r.ok) return cache.put(url, r); })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => {
          console.log('🗑️ Clearing old cache:', n);
          return caches.delete(n);
        })
      )
    ).then(() => self.clients.claim())
  );
  // skipWaiting hanya perlu di install, tidak di activate
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // API & external — always network, never cache
  if (url.includes('/api/') ||
      url.includes('script.google.com') ||
      url.includes('tailwindcss.com') ||
      url.includes('cdn.jsdelivr.net') ||
      url.includes('cdnjs.cloudflare.com')) {
    return;
  }

  // HTML — network-first agar selalu dapat versi terbaru
  if (event.request.destination === 'document' || url.endsWith('.html')) {
    return event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }

  // Static assets — cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') return caches.match('./index.html');
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

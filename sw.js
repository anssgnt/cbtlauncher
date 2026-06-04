const CACHE_NAME = 'spensada-cbt-v8-20260605';
const urlsToCache = [
  './index.html',
  './manifest.json',
  'https://spensada.me/public/img/konfigurasi/logo/1758281903_cba80d84171bd85558c9.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return Promise.allSettled(
          urlsToCache.map(url => {
            return fetch(url).then(response => {
              if (response.ok) return cache.put(url, response);
            });
          })
        );
      })
  );
  // Force skip waiting untuk activate SW baru immediately
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Hapus SEMUA cache lama - AGGRESSIVE
          if (!cacheName.includes('v8') && !cacheName.includes('20260605')) {
            console.log('🗑️ Clearing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // API requests: always network, never cache
  if (event.request.url.includes('/api/') || event.request.url.includes('script.google.com')) {
    return;
  }

  // HTML documents: network-first (always check for updates)
  if (event.request.destination === 'document' || event.request.url.endsWith('.html')) {
    return event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }

  // Static assets: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response;
      return fetch(event.request).then(networkResponse => {
        // Cache successful responses for static assets
        if (networkResponse.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => {
        // Offline fallback
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

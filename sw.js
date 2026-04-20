const CACHE_NAME = 'spensada-cbt-v2';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  'https://spensada.me/public/img/konfigurasi/logo/1758281903_cba80d84171bd85558c9.png',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap'
];

// Fallback image in case the logo fails
const FALLBACK_LOGO = 'https://spensada.me/public/img/konfigurasi/logo/1758281903_cba80d84171bd85558c9.png';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return Promise.allSettled(
          urlsToCache.map(url => {
            return fetch(url).then(response => {
              if (response.ok) return cache.put(url, response);
            }).catch(err => console.warn('Pre-cache failed for:', url, err));
          })
        );
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  const url = event.request.url;

  // Only handle http and https schemes (ignore chrome-extension, etc.)
  if (!url.startsWith('http')) return;

  // Bypass cache for Google Apps Script API
  if (url.includes('script.google.com')) return;

  // Strategy: Stale-While-Revalidate for everything else
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // Cache successful network responses
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallback for failed network requests
        if (url.includes('logo')) return caches.match(FALLBACK_LOGO);
        return null;
      });

      return cachedResponse || fetchPromise;
    })
  );
});

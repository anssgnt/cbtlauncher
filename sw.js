const CACHE_NAME = 'spensada-cbt-v1';
const urlsToCache = [
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://spensada.me/public/img/konfigurasi/logo/1758281903_cba80d84171bd85558c9.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache files, but don't fail if some requests fail (like tailwind cdn)
        return Promise.allSettled(
            urlsToCache.map(url => {
                return fetch(url).then(response => {
                    if (response.ok) {
                        return cache.put(url, response);
                    }
                    throw new Error('Failed to fetch: ' + url);
                });
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
  // Hanya intercept GET requests, lewati POST (kalau ada API submission di masa depan)
  if (event.request.method !== 'GET') return;
  
  // Biarkan request ke API Script Google tetap langsung network-first
  if (event.request.url.includes('script.google.com')) {
      return; 
  }

  // Stale-while-revalidate pattern sederhana untuk statis
  event.respondWith(
    caches.match(event.request).then(response => {
      // Return cached version if found
      if (response) {
         return response;
      }
      return fetch(event.request).then(networkResponse => {
         // Optionally cache new requests, tp jangan cache sembarangan
         return networkResponse;
      }).catch(() => {
          // Fallback offline murni agar lulus PWA validation Chrome PC
          return new Response(
            "<!DOCTYPE html><html><body><h1>Sistem Ujian Offline</h1><p>Penyimpanan lokal diaktifkan. Silakan periksa koneksi internet Anda.</p></body></html>",
            { headers: { 'Content-Type': 'text/html' } }
          );
      });
    })
  );
});

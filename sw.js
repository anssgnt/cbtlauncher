// [OPT-SW-1] Naikkan versi cache jika ada perubahan file
const CACHE_NAME = 'spensada-cbt-v2';

// Hanya cache file statik milik sendiri. CDN & API dibiarkan network-first.
const STATIC_ASSETS = [
    './index.html',
    './manifest.json'
];

// ==========================================
// INSTALL: Pre-cache aset statik
// ==========================================
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // [OPT-SW-2] Gunakan addAll dengan catch individual agar satu kegagalan
            // tidak membatalkan seluruh instalasi SW
            return Promise.allSettled(
                STATIC_ASSETS.map(url =>
                    cache.add(url).catch(e => console.warn('SW cache miss:', url, e))
                )
            );
        })
    );
    // [OPT-SW-3] skipWaiting: SW baru langsung aktif tanpa nunggu tab lama ditutup
    self.skipWaiting();
});

// ==========================================
// ACTIVATE: Bersihkan cache lama
// ==========================================
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    // [OPT-SW-4] clients.claim: SW langsung kontrol semua tab tanpa reload
    self.clients.claim();
});

// ==========================================
// FETCH: Strategi berdasarkan jenis request
// ==========================================
self.addEventListener('fetch', event => {
    // Hanya tangani GET
    if (event.request.method !== 'GET') return;

    const url = event.request.url;

    // [OPT-SW-5] API Google Script & CDN: selalu network-first, tidak di-cache
    if (url.includes('script.google.com') || url.includes('cdn.tailwindcss.com') || url.includes('fonts.g')) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response('', { status: 503, statusText: 'Offline' })
            )
        );
        return;
    }

    // [OPT-SW-6] Aset statik milik sendiri: Cache-First dengan network fallback
    // Ini membuat halaman muat seketika dari cache, sambil tetap bisa update
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                // [OPT-SW-7] Stale-while-revalidate: kembalikan cache langsung,
                // sekaligus update cache di background (tanpa blok UI)
                const revalidate = fetch(event.request).then(networkRes => {
                    if (networkRes && networkRes.ok) {
                        caches.open(CACHE_NAME).then(c => c.put(event.request, networkRes.clone()));
                    }
                    return networkRes;
                }).catch(() => {});
                // Trigger revalidation tapi langsung kembalikan cache
                event.waitUntil(revalidate);
                return cached;
            }

            // Tidak ada cache: ambil dari network
            return fetch(event.request).then(networkRes => {
                // Cache respons baru untuk request berikutnya
                if (networkRes && networkRes.ok) {
                    const toCache = networkRes.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, toCache));
                }
                return networkRes;
            }).catch(() =>
                // Offline fallback murni
                new Response(
                    '<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9;color:#334155;text-align:center;padding:24px}h1{font-size:20px;font-weight:800;margin-bottom:8px}p{font-size:14px;color:#64748b;max-width:280px;line-height:1.6}</style></head><body><h1>Tidak Ada Koneksi</h1><p>Aplikasi Ujian membutuhkan internet. Periksa koneksi WiFi atau data Anda, lalu muat ulang halaman.</p></body></html>',
                    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                )
            );
        })
    );
});

/**
 * NETLIFY SERVERLESS FUNCTION: Proxy Cache untuk GAS API
 * 
 * - Siswa fetch dari sini (Netlify CDN edge, super cepat)
 * - Fungsi ini fetch dari GAS hanya jika cache expired
 * - Admin bisa force refresh via ?bust=1
 * - Cache TTL mengikuti config CACHE_DURATION dari Spreadsheet
 */

// In-memory cache
let cachedData = null;
let cacheTimestamp = 0;
let cacheTTL = 60 * 1000; // Default 60 detik, akan diupdate dari config

// URL Google Apps Script Web App
const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

export default async (req, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(req.url);
  const bustCache = url.searchParams.get('bust') === '1';
  const now = Date.now();

  // Force bust: admin minta refresh paksa
  if (bustCache) {
    cachedData = null;
    cacheTimestamp = 0;
  }

  // Cek in-memory cache
  if (cachedData && (now - cacheTimestamp) < cacheTTL) {
    return new Response(JSON.stringify({
      ...cachedData,
      _cache: "hit",
      _cacheAge: Math.round((now - cacheTimestamp) / 1000),
      _ttl: Math.round(cacheTTL / 1000)
    }), { status: 200, headers });
  }

  // Fetch dari GAS
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(GAS_URL, {
      method: "GET",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`GAS status ${response.status}`);

    const data = await response.json();
    if (data.error) throw new Error(data.message || "GAS error");

    // Update TTL dari config server (jika ada)
    if (data.config && data.config.cacheDuration) {
      cacheTTL = parseInt(data.config.cacheDuration) * 1000;
    }

    cachedData = data;
    cacheTimestamp = now;

    return new Response(JSON.stringify({
      ...data,
      _cache: "miss",
      _fetchedAt: new Date().toISOString(),
      _ttl: Math.round(cacheTTL / 1000)
    }), { status: 200, headers });

  } catch (err) {
    if (cachedData) {
      return new Response(JSON.stringify({
        ...cachedData,
        _cache: "stale",
        _error: err.message,
        _cacheAge: Math.round((now - cacheTimestamp) / 1000)
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({
      error: true,
      message: "Gagal menghubungi server ujian.",
      _detail: err.message
    }), { status: 502, headers });
  }
};

export const config = {
  path: "/api/exams"
};

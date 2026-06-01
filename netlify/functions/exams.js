/**
 * NETLIFY SERVERLESS FUNCTION: Proxy Cache untuk GAS API
 * Optimized for 500-1000 concurrent students.
 * 
 * Features:
 * - In-memory cache with configurable TTL
 * - Request coalescing (multiple requests during cache miss share one GAS fetch)
 * - Cache bust via ?bust=1 for admin
 * - Stale-while-revalidate pattern
 * - Aggressive CDN caching headers
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

// Cache state
let cachedData = null;
let cacheTimestamp = 0;
let cacheTTL = 60 * 1000; // Default 60s, updated from config
let inflightPromise = null; // Request coalescing

async function fetchFromGAS() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(GAS_URL, {
      method: "GET",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`GAS status ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.message || "GAS error");

    // Update TTL from config
    if (data.config && data.config.cacheDuration) {
      cacheTTL = Math.max(30, parseInt(data.config.cacheDuration)) * 1000;
    }

    cachedData = data;
    cacheTimestamp = Date.now();
    return data;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export default async (req, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    // Aggressive caching: browser 30s, CDN 60s, serve stale up to 5min while revalidating
    "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(req.url);
  const bustCache = url.searchParams.get('bust') === '1';
  const now = Date.now();

  // Admin cache bust
  if (bustCache) {
    cachedData = null;
    cacheTimestamp = 0;
    inflightPromise = null;
  }

  // Serve from cache if fresh
  if (cachedData && (now - cacheTimestamp) < cacheTTL) {
    return new Response(JSON.stringify({
      ...cachedData,
      _cache: "hit",
      _age: Math.round((now - cacheTimestamp) / 1000),
      _ttl: Math.round(cacheTTL / 1000)
    }), { status: 200, headers });
  }

  // REQUEST COALESCING: If another request is already fetching, wait for it
  // This prevents 100 simultaneous cache-miss requests from all hitting GAS
  if (inflightPromise) {
    try {
      await inflightPromise;
      // After waiting, cache should be fresh
      if (cachedData) {
        return new Response(JSON.stringify({
          ...cachedData,
          _cache: "coalesced",
          _age: Math.round((Date.now() - cacheTimestamp) / 1000)
        }), { status: 200, headers });
      }
    } catch (e) {
      // Inflight failed, we'll try ourselves below
    }
  }

  // Fetch from GAS (with coalescing lock)
  try {
    inflightPromise = fetchFromGAS();
    const data = await inflightPromise;
    inflightPromise = null;

    return new Response(JSON.stringify({
      ...data,
      _cache: "miss",
      _fetchedAt: new Date().toISOString(),
      _ttl: Math.round(cacheTTL / 1000)
    }), { status: 200, headers });

  } catch (err) {
    inflightPromise = null;

    // Serve stale cache if available (better than error)
    if (cachedData) {
      return new Response(JSON.stringify({
        ...cachedData,
        _cache: "stale",
        _error: err.message,
        _age: Math.round((now - cacheTimestamp) / 1000)
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({
      error: true,
      message: "Server ujian tidak merespons. Coba lagi.",
      _detail: err.message
    }), { status: 502, headers });
  }
};

export const config = {
  path: "/api/exams"
};

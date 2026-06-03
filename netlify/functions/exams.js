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

function buildHeaders(origin) {
  const allowedOrigin = origin && (origin.endsWith('.netlify.app') || origin.includes('spensada.me'))
    ? origin
    : 'https://spensada.netlify.app';
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
  };
}

export default async (req, context) => {
  const origin = req.headers.get('origin') || '';
  const headers = buildHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(req.url);
  const bustCache = url.searchParams.get('bust') === '1';
  const fullData = url.searchParams.get('full') === '1'; // Admin/internal use only
  const now = Date.now();

  // Admin cache bust
  if (bustCache) {
    cachedData = null;
    cacheTimestamp = 0;
    inflightPromise = null;
  }

  // Serve from cache if fresh
  if (cachedData && (now - cacheTimestamp) < cacheTTL) {
    const responseData = fullData ? cachedData : stripSensitiveData(cachedData);
    return new Response(JSON.stringify({
      ...responseData,
      _cache: "hit",
      _age: Math.round((now - cacheTimestamp) / 1000),
      _ttl: Math.round(cacheTTL / 1000)
    }), { status: 200, headers });
  }

  // REQUEST COALESCING
  if (inflightPromise) {
    try {
      await inflightPromise;
      if (cachedData) {
        const responseData = fullData ? cachedData : stripSensitiveData(cachedData);
        return new Response(JSON.stringify({
          ...responseData,
          _cache: "coalesced",
          _age: Math.round((Date.now() - cacheTimestamp) / 1000)
        }), { status: 200, headers });
      }
    } catch (e) {}
  }

  // Fetch from GAS
  try {
    inflightPromise = fetchFromGAS();
    const data = await inflightPromise;
    inflightPromise = null;

    const responseData = fullData ? data : stripSensitiveData(data);
    return new Response(JSON.stringify({
      ...responseData,
      _cache: "miss",
      _fetchedAt: new Date().toISOString(),
      _ttl: Math.round(cacheTTL / 1000)
    }), { status: 200, headers });

  } catch (err) {
    inflightPromise = null;

    if (cachedData) {
      const responseData = fullData ? cachedData : stripSensitiveData(cachedData);
      return new Response(JSON.stringify({
        ...responseData,
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

/**
 * Strip sensitive data (link, token, config) dari response publik.
 * Siswa hanya lihat jadwal + pwaEnforce (perlu untuk gate).
 */
function stripSensitiveData(data) {
  if (!data || !data.exams) return data;
  return {
    exams: data.exams.map(exam => ({
      id: exam.id,
      nama: exam.nama,
      start: exam.start,
      end: exam.end,
      status: exam.status,
      hasToken: !!(exam.token && exam.token.length > 0)
    })),
    config: {
      pwaEnforce: data.config?.pwaEnforce
    }
  };
}

export const config = {
  path: "/api/exams"
};

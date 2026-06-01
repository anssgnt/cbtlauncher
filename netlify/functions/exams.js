/**
 * NETLIFY SERVERLESS FUNCTION: Proxy Cache untuk GAS API
 * 
 * Fungsi ini bertindak sebagai perantara antara 400+ siswa dan Google Apps Script.
 * - Siswa fetch dari sini (Netlify CDN edge, super cepat)
 * - Fungsi ini fetch dari GAS hanya jika cache expired
 * - GAS hanya kena ~1 request per CACHE_TTL detik
 * 
 * Deploy: otomatis saat push ke Netlify (file harus di /netlify/functions/)
 */

// In-memory cache (bertahan selama function instance hidup di Netlify edge)
let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 120 * 1000; // 120 detik (2 menit) — sesuaikan kebutuhan

// URL Google Apps Script Web App kamu
const GAS_URL = "https://script.google.com/macros/s/AKfycbwalO-HqOZpSYlOjBXl9stx3PzZUWrTadTJeojZ_AuMWFNrJk44vlozgXXEUiNO5Fugog/exec";

export default async (req, context) => {
  // CORS Headers — agar frontend bisa fetch dari domain berbeda jika perlu
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    // Cache-Control: browser boleh cache 60 detik, CDN edge cache 120 detik
    "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300"
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const now = Date.now();

  // Cek apakah in-memory cache masih valid
  if (cachedData && (now - cacheTimestamp) < CACHE_TTL) {
    return new Response(JSON.stringify({
      ...cachedData,
      _cache: "hit",
      _cacheAge: Math.round((now - cacheTimestamp) / 1000)
    }), { status: 200, headers });
  }

  // Cache expired atau belum ada — fetch dari GAS
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 detik timeout

    const response = await fetch(GAS_URL, {
      method: "GET",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`GAS responded with status ${response.status}`);
    }

    const data = await response.json();

    // Validasi response — pastikan bukan error dari GAS
    if (data.error) {
      throw new Error(data.message || "GAS returned error");
    }

    // Update in-memory cache
    cachedData = data;
    cacheTimestamp = now;

    return new Response(JSON.stringify({
      ...data,
      _cache: "miss",
      _fetchedAt: new Date().toISOString()
    }), { status: 200, headers });

  } catch (err) {
    // Jika fetch gagal TAPI ada stale cache, kembalikan stale data (lebih baik daripada error)
    if (cachedData) {
      return new Response(JSON.stringify({
        ...cachedData,
        _cache: "stale",
        _error: err.message,
        _cacheAge: Math.round((now - cacheTimestamp) / 1000)
      }), { status: 200, headers });
    }

    // Tidak ada cache sama sekali — kembalikan error
    return new Response(JSON.stringify({
      error: true,
      message: "Gagal menghubungi server ujian. Silakan coba lagi dalam beberapa detik.",
      _detail: err.message
    }), { status: 502, headers });
  }
};

// Netlify Function config
export const config = {
  path: "/api/exams"
};

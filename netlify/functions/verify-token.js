/**
 * NETLIFY FUNCTION: Verify Token & Return Exam Link
 * 
 * Siswa kirim token → server cek → jika benar, baru kasih link.
 * Link TIDAK pernah dikirim ke frontend sebelum token diverifikasi.
 * 
 * Performa: Baca dari in-memory cache (sama dengan exams.js), 
 * TIDAK hit GAS per request. Aman untuk 1000 siswa.
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

// Shared cache (independent dari exams.js karena beda function instance)
let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 1000;

async function getExamData() {
  const now = Date.now();
  if (cachedData && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedData;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(GAS_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error("GAS error");
    const data = await res.json();
    if (!data.error) {
      cachedData = data;
      cacheTimestamp = now;
    }
    return data;
  } catch (e) {
    clearTimeout(timeout);
    // Return stale cache if available
    if (cachedData) return cachedData;
    throw e;
  }
}

export default async (req, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store" // NEVER cache token verification responses
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: true, message: "Method not allowed" }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { examId, token } = body;

    if (!examId || !token) {
      return new Response(JSON.stringify({ error: true, message: "examId dan token wajib diisi." }), { status: 400, headers });
    }

    // Get exam data from cache/GAS
    const data = await getExamData();
    if (!data || !data.exams) {
      return new Response(JSON.stringify({ error: true, message: "Data ujian tidak tersedia." }), { status: 503, headers });
    }

    // Find exam
    const exam = data.exams.find(e => e.id === examId);
    if (!exam) {
      return new Response(JSON.stringify({ error: true, message: "Ujian tidak ditemukan." }), { status: 404, headers });
    }

    // Verify token (case-insensitive)
    if (exam.token && exam.token.toUpperCase() !== token.toUpperCase()) {
      return new Response(JSON.stringify({ error: true, message: "Token salah." }), { status: 403, headers });
    }

    // Token benar — berikan link
    return new Response(JSON.stringify({
      success: true,
      link: exam.link,
      examName: exam.nama
    }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: true, message: "Server error: " + e.message }), { status: 500, headers });
  }
};

export const config = {
  path: "/api/verify-token"
};

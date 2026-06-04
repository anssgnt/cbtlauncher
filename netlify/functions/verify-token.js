/**
 * NETLIFY FUNCTION: Verify Token & Return Exam Link
 * 
 * Siswa kirim token server cek jika benar baru kasih link.
 * Link TIDAK pernah dikirim ke frontend sebelum token diverifikasi.
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

// In-memory rate limiter
const rateLimitMap = new Map();
const RL_WINDOW = 60000;
const RL_MAX = 10;

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimitMap) {
      if (now - val.windowStart > RL_WINDOW * 2) rateLimitMap.delete(key);
    }
  }, 300000);
}

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - record.windowStart > RL_WINDOW) {
    record.count = 0;
    record.windowStart = now;
  }
  record.count++;
  rateLimitMap.set(ip, record);
  return record.count > RL_MAX;
}

// Shared cache
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
    if (cachedData) return cachedData;
    throw e;
  }
}

function getClientIP(req) {
  return req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')
    || req.headers.get('client-ip')
    || 'unknown';
}

function buildHeaders(origin) {
  const allowedOrigin = origin && origin.endsWith('.netlify.app')
    ? origin
    : (origin && origin.includes('spensada.me'))
      ? origin
      : 'https://spensada.netlify.app';
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };
}

export default async (req, context) => {
  const origin = req.headers.get('origin') || '';
  const headers = buildHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: true, message: "Method not allowed" }), { status: 405, headers });
  }

  // Rate limiting
  const clientIp = getClientIP(req);
  if (isRateLimited(clientIp)) {
    return new Response(JSON.stringify({ error: true, message: "Terlalu banyak percobaan. Tunggu 1 menit." }), {
      status: 429, headers: { ...headers, "Retry-After": "60" }
    });
  }

  try {
    const body = await req.json();
    const { examId, token } = body;

    if (!examId || !token) {
      return new Response(JSON.stringify({ error: true, message: "examId dan token wajib diisi." }), { status: 400, headers });
    }

    const data = await getExamData();
    if (!data || !data.exams) {
      return new Response(JSON.stringify({ error: true, message: "Data ujian tidak tersedia." }), { status: 503, headers });
    }

    const exam = data.exams.find(e => e.id === examId);
    if (!exam) {
      return new Response(JSON.stringify({ error: true, message: "Ujian tidak ditemukan." }), { status: 404, headers });
    }

    if (!exam.link || exam.link.trim() === "") {
      return new Response(JSON.stringify({ error: true, message: "Link ujian belum dikonfigurasi oleh admin." }), { status: 400, headers });
    }

    if (exam.token && exam.token.toUpperCase() !== token.toUpperCase()) {
      // Catat failed attempt untuk monitoring
      console.log(`TOKEN_FAIL: ip=${clientIp} exam=${examId} token=${token}`);
      return new Response(JSON.stringify({ error: true, message: "Token salah." }), { status: 403, headers });
    }

    // Validasi link format
    let linkUrl = exam.link.trim();
    if (!linkUrl.startsWith('http://') && !linkUrl.startsWith('https://')) {
      linkUrl = 'https://' + linkUrl;
    }

    try {
      new URL(linkUrl);
    } catch (e) {
      console.error(`INVALID_LINK: exam=${examId} link=${exam.link}`);
      return new Response(JSON.stringify({ error: true, message: "Link ujian tidak valid. Hubungi admin." }), { status: 400, headers });
    }

    return new Response(JSON.stringify({
      success: true,
      link: linkUrl,
      examName: exam.nama
    }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: true, message: "Server error: " + e.message }), { status: 500, headers });
  }
};

export const config = {
  path: "/api/verify-token"
};

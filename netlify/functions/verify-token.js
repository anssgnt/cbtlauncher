/**
 * NETLIFY FUNCTION: Verify Token & Return Exam Link
 * 
 * Siswa kirim token server cek jika benar baru kasih link.
 * Link TIDAK pernah dikirim ke frontend sebelum token diverifikasi.
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

// In-memory rate limiter (cleanup by window expiry, no setInterval needed in serverless)
const rateLimitMap = new Map();
const RL_WINDOW = 60000;
const RL_MAX = 10;

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

// Request coalescing: 10 request bersamaan → hanya 1 ke GAS
const pendingRequests = new Map();
const COALESCE_WINDOW = 500; // ms

async function getExamData() {
  const now = Date.now();
  if (cachedData && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedData;
  }

  // Coalesce: kalau sudah ada pending request, tunggu hasilnya
  const pending = pendingRequests.get('examData');
  if (pending) return pending;

  const promise = fetchExamData();
  pendingRequests.set('examData', promise);
  try {
    const result = await promise;
    return result;
  } finally {
    pendingRequests.delete('examData');
  }
}

async function fetchExamData() {
  const now = Date.now();
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

// Token verification coalescing: same examId+token → share result
const pendingVerifications = new Map();

async function verifyToken(examId, token, clientIp) {
  const key = `${examId}:${token}`;

  // Coalesce: kalau sudah ada request sama, tunggu
  const pending = pendingVerifications.get(key);
  if (pending) {
    console.log(`COALESCED: ip=${clientIp} exam=${examId} (shared with existing request)`);
    return pending;
  }

  const promise = doVerify(examId, token, clientIp);
  pendingVerifications.set(key, promise);
  try {
    const result = await promise;
    return result;
  } finally {
    pendingVerifications.delete(key);
  }
}

async function doVerify(examId, token, clientIp) {
  const data = await getExamData();
  if (!data || !data.exams) {
    return { error: true, message: "Data ujian tidak tersedia.", status: 503 };
  }

  const exam = data.exams.find(e => e.id === examId);
  if (!exam) {
    return { error: true, message: "Ujian tidak ditemukan.", status: 404 };
  }

  if (!exam.link || exam.link.trim() === "") {
    return { error: true, message: "Link ujian belum dikonfigurasi oleh admin.", status: 400 };
  }

  if (exam.token && exam.token.toUpperCase() !== token.toUpperCase()) {
    console.log(`TOKEN_FAIL: ip=${clientIp} exam=${examId} token=${token}`);
    return { error: true, message: "Token salah.", status: 403 };
  }

  let linkUrl = exam.link.trim();
  if (!linkUrl.startsWith('http://') && !linkUrl.startsWith('https://')) {
    linkUrl = 'https://' + linkUrl;
  }

  try {
    new URL(linkUrl);
  } catch (e) {
    console.error(`INVALID_LINK: exam=${examId} link=${exam.link}`);
    return { error: true, message: "Link ujian tidak valid. Hubungi admin.", status: 400 };
  }

  return { success: true, link: linkUrl, examName: exam.nama, status: 200 };
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

    // Coalesced verification: 10 request bersamaan → hanya 1 ke GAS
    const result = await verifyToken(examId, token, clientIp);
    return new Response(JSON.stringify(result), { status: result.status, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: true, message: "Server error: " + e.message }), { status: 500, headers });
  }
};

export const config = {
  path: "/api/verify-token"
};

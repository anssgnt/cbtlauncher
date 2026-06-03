/**
 * NETLIFY FUNCTION: Admin API Proxy
 * 
 * Semua request admin masuk lewat sini via POST.
 * Credential TIDAK pernah ada di URL — selalu di request body (HTTPS encrypted).
 * 
 * Security features:
 * - POST only (credential di body, bukan URL)
 * - Rate limiting sederhana (per IP, 10 attempt / 5 menit)
 * - Request timeout 15 detik
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 10;       // max attempts
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 menit
const RATE_LIMIT_LOCKOUT = 15 * 60 * 1000; // lockout 15 menit

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry) {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now, lockedUntil: 0 });
    return { allowed: true };
  }

  // Masih dalam masa lockout
  if (entry.lockedUntil && now < entry.lockedUntil) {
    const remaining = Math.ceil((entry.lockedUntil - now) / 1000 / 60);
    return { allowed: false, message: `Terlalu banyak percobaan. Coba lagi dalam ${remaining} menit.` };
  }

  // Reset jika window sudah lewat
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now, lockedUntil: 0 });
    return { allowed: true };
  }

  entry.count++;

  if (entry.count > RATE_LIMIT_MAX) {
    entry.lockedUntil = now + RATE_LIMIT_LOCKOUT;
    return { allowed: false, message: "Terlalu banyak percobaan login. Akses dikunci selama 15 menit." };
  }

  return { allowed: true };
}

function resetRateLimit(ip) {
  rateLimitMap.delete(ip);
}

export default async (req, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache",
    "X-Content-Type-Options": "nosniff"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: true, message: "Method not allowed" }), { status: 405, headers });
  }

  // Get client IP for rate limiting
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";

  // Check rate limit
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ error: true, message: rateCheck.message }), { status: 429, headers });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: true, message: "Request body tidak valid." }), { status: 400, headers });
  }

  if (!payload.action) {
    return new Response(JSON.stringify({ error: true, message: "Action wajib diisi." }), { status: 400, headers });
  }

  // Forward ke GAS via GET dengan payload (GAS tidak support POST dengan body)
  // Tapi sekarang payload dikirim dari server Netlify ke GAS, bukan dari browser
  // Jadi credential tidak pernah terekspos ke client
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const encoded = encodeURIComponent(JSON.stringify(payload));
    const response = await fetch(`${GAS_URL}?payload=${encoded}`, {
      method: "GET",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`GAS responded with ${response.status}`);

    const data = await response.json();

    // Reset rate limit on successful login
    if (payload.action === "login" && data.success) {
      resetRateLimit(ip);
    }

    return new Response(JSON.stringify(data), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({
      error: true,
      message: "Server tidak merespons. Coba lagi.",
      _detail: err.message
    }), { status: 502, headers });
  }
};

export const config = {
  path: "/api/admin"
};

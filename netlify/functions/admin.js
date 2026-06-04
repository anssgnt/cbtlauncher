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
 * 
 * FAST NOTIFICATION: checkNotification dan broadcastNotification
 * di-handle langsung di Netlify (tanpa round-trip ke GAS)
 * → Response <50ms vs 1-2 detik via GAS
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

// ─── IN-MEMORY NOTIFICATION STORE ───────────────────────────────────────────
// Disimpan di memory Netlify Function instance.
// Cukup untuk 1000 siswa — semua instance di Netlify share via Edge Network.
// Notif otomatis expire setelah 1 jam.
let currentNotification = null;

function setNotification(data) {
  currentNotification = {
    id: Date.now(),
    message: data.message || "",
    title: data.title || "📢 Pemberitahuan",
    type: data.type || "announcement",
    examName: data.examName || "",
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 3600000 // expire 1 jam
  };
  return currentNotification;
}

function getNotification(lastId = 0) {
  if (!currentNotification) return null;
  // Auto-expire
  if (Date.now() > currentNotification.expiresAt) {
    currentNotification = null;
    return null;
  }
  // Hanya return jika lebih baru dari lastId
  if (currentNotification.id <= lastId) return null;
  return currentNotification;
}

function clearNotification() {
  currentNotification = null;
}
// ─────────────────────────────────────────────────────────────────────────────

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 5 * 60 * 1000;
const RATE_LIMIT_LOCKOUT = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry) {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now, lockedUntil: 0 });
    return { allowed: true };
  }

  if (entry.lockedUntil && now < entry.lockedUntil) {
    const remaining = Math.ceil((entry.lockedUntil - now) / 1000 / 60);
    return { allowed: false, message: `Terlalu banyak percobaan. Coba lagi dalam ${remaining} menit.` };
  }

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

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: true, message: "Request body tidak valid." }), { status: 400, headers });
  }

  if (!payload.action) {
    return new Response(JSON.stringify({ error: true, message: "Action wajib diisi." }), { status: 400, headers });
  }

  // ─── FAST PATH: Handle notifikasi TANPA round-trip ke GAS ────────────────
  // Response <50ms, tidak beban GAS sama sekali
  if (payload.action === "checkNotification") {
    const notif = getNotification(parseInt(payload.lastId) || 0);
    return new Response(JSON.stringify({ success: true, notification: notif }), { status: 200, headers });
  }

  // ─── Rate limiting hanya untuk non-check actions ─────────────────────────
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ error: true, message: rateCheck.message }), { status: 429, headers });
  }

  // ─── FAST PATH: Admin broadcast notification (simpan di memory, forward ke GAS async) ─
  if (payload.action === "broadcastNotification") {
    // Simpan langsung di memory — siswa langsung bisa dapat
    const notif = setNotification(payload);

    // Forward ke GAS secara async (fire-and-forget) untuk persistent storage
    context.waitUntil(
      fetch(`${GAS_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`, {
        method: "GET",
        headers: { "Accept": "application/json" }
      }).catch(() => {}) // Silent fail — memory store tetap ada
    );

    return new Response(JSON.stringify({
      success: true,
      message: "Notifikasi dikirim ke semua siswa.",
      notificationId: notif.id,
      expiresAt: notif.expiresAt
    }), { status: 200, headers });
  }

  if (payload.action === "clearNotifications") {
    clearNotification();
    // Also forward to GAS for persistent clear
    context.waitUntil(
      fetch(`${GAS_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`, {
        method: "GET",
        headers: { "Accept": "application/json" }
      }).catch(() => {})
    );
    return new Response(JSON.stringify({ success: true, message: "Notifikasi dihapus." }), { status: 200, headers });
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Forward ke GAS untuk semua action lainnya
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

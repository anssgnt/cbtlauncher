/**
 * NETLIFY FUNCTION: Admin API Proxy
 *
 * - POST only, credential di body (bukan URL)
 * - Rate limiting per IP
 * - checkNotification & broadcastNotification di-handle lokal (tanpa GAS)
 *   → response <50ms, tidak bebankan GAS quota
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

// ─── IN-MEMORY NOTIFICATION STORE ────────────────────────────────────────────
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
  if (Date.now() > currentNotification.expiresAt) { currentNotification = null; return null; }
  if (currentNotification.id <= lastId) return null;
  return currentNotification;
}

function clearNotification() {
  currentNotification = null;
}

// ─── RATE LIMITER ─────────────────────────────────────────────────────────────
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

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async (req, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache",
    "X-Content-Type-Options": "nosniff"
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
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

  // ── FAST PATH: checkNotification — tanpa GAS, tanpa rate limit ────────────
  if (payload.action === "checkNotification") {
    const notif = getNotification(parseInt(payload.lastId) || 0);
    return new Response(JSON.stringify({ success: true, notification: notif }), { status: 200, headers });
  }

  // ── Rate limiting untuk semua action lainnya ──────────────────────────────
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ error: true, message: rateCheck.message }), { status: 429, headers });
  }

  // ── FAST PATH: broadcastNotification — simpan di memory, forward async ────
  if (payload.action === "broadcastNotification") {
    const notif = setNotification(payload);
    context.waitUntil(
      fetch(`${GAS_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`, {
        method: "GET", headers: { "Accept": "application/json" }
      }).catch(() => {})
    );
    return new Response(JSON.stringify({
      success: true,
      message: "Notifikasi dikirim ke semua siswa.",
      notificationId: notif.id
    }), { status: 200, headers });
  }

  // ── FAST PATH: clearNotifications ────────────────────────────────────────
  if (payload.action === "clearNotifications") {
    clearNotification();
    context.waitUntil(
      fetch(`${GAS_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`, {
        method: "GET", headers: { "Accept": "application/json" }
      }).catch(() => {})
    );
    return new Response(JSON.stringify({ success: true, message: "Notifikasi dihapus." }), { status: 200, headers });
  }

  // ── Forward semua action lain ke GAS ─────────────────────────────────────
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${GAS_URL}?payload=${encodeURIComponent(JSON.stringify(payload))}`, {
      method: "GET",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error(`GAS responded with ${response.status}`);

    const data = await response.json();

    if (payload.action === "login" && data.success) resetRateLimit(ip);

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

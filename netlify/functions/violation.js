/**
 * NETLIFY FUNCTION: Violation Report Queue
 * 
 * Menerima violation report dari siswa batch ke memory
 * lalu forward ke GAS secara berkala.
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

// In-memory rate limiter
const rateLimitMap = new Map();
const RL_WINDOW = 60000;
const RL_MAX = 20;

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

// In-memory queue
let violationQueue = [];
let lastFlush = 0;
const FLUSH_INTERVAL = 30000;

async function flushQueue() {
  if (violationQueue.length === 0) return;
  const batch = [...violationQueue];
  violationQueue = [];
  lastFlush = Date.now();
  for (const item of batch) {
    try {
      await fetch(GAS_URL + '?payload=' + encodeURIComponent(JSON.stringify({
        action: 'reportViolation', ...item
      })), { method: 'GET' });
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
}

function getClientIP(req) {
  return req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')
    || req.headers.get('client-ip')
    || 'unknown';
}

function buildHeaders(origin) {
  const allowedOrigin = origin && (origin.endsWith('.netlify.app') || origin.includes('spensada.me'))
    ? origin
    : 'https://spensada.netlify.app';
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
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

  const clientIp = getClientIP(req);
  if (isRateLimited(clientIp)) {
    return new Response(JSON.stringify({ error: true, message: "Terlalu banyak permintaan." }), { status: 429, headers });
  }

  try {
    const body = await req.json();

    violationQueue.push({
      examId: body.examId || "",
      examName: body.examName || "",
      studentName: body.studentName || "",
      studentClass: body.studentClass || "",
      violationCount: body.violationCount || 0,
      userAgent: body.userAgent || navigator?.userAgent || ""
    });

    const now = Date.now();
    if ((now - lastFlush) > FLUSH_INTERVAL || violationQueue.length >= 20) {
      context.waitUntil(flushQueue());
    }

    return new Response(JSON.stringify({ success: true, queued: violationQueue.length }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: true, message: e.message }), { status: 400, headers });
  }
};

export const config = {
  path: "/api/violation"
};

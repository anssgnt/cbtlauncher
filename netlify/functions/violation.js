/**
 * NETLIFY FUNCTION: Violation Report Queue
 * 
 * Menerima violation report dari siswa, batch ke memory,
 * lalu forward ke GAS secara berkala (bukan per-request).
 * Ini melindungi GAS dari ratusan POST serentak.
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/exec";

// In-memory queue (bertahan selama function instance hidup)
let violationQueue = [];
let lastFlush = 0;
const FLUSH_INTERVAL = 30000; // Flush ke GAS setiap 30 detik max

async function flushQueue() {
  if (violationQueue.length === 0) return;
  
  const batch = [...violationQueue];
  violationQueue = [];
  lastFlush = Date.now();

  // Kirim satu per satu ke GAS (GAS tidak support batch natively)
  // Tapi kita kirim sequential, bukan parallel, agar tidak overload
  for (const item of batch) {
    try {
      await fetch(GAS_URL + '?payload=' + encodeURIComponent(JSON.stringify({
        action: 'reportViolation',
        ...item
      })), { method: 'GET' });
    } catch (e) {
      // Gagal kirim — tidak retry, data hilang (acceptable untuk violation)
    }
    // Delay 200ms antar request agar tidak spam GAS
    await new Promise(r => setTimeout(r, 200));
  }
}

export default async (req, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: true, message: "Method not allowed" }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    
    // Tambahkan ke queue
    violationQueue.push({
      examId: body.examId || "",
      examName: body.examName || "",
      studentName: body.studentName || "",
      deviceId: body.deviceId || "",
      violationCount: body.violationCount || 0,
      userAgent: body.userAgent || ""
    });

    // Flush jika sudah lewat interval atau queue besar
    const now = Date.now();
    if ((now - lastFlush) > FLUSH_INTERVAL || violationQueue.length >= 20) {
      // Non-blocking flush (jangan tunggu selesai)
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

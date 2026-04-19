// =======================
// PWA INSTALL SYSTEM FIX
// =======================

let deferredPrompt = null;

// REGISTER SW
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log("SW registered"))
      .catch(err => console.log("SW failed", err));
  });
}

// DETECT INSTALL PROMPT
window.addEventListener('beforeinstallprompt', (e) => {
  console.log("Install prompt ready");
  e.preventDefault();
  deferredPrompt = e;

  // tampilkan tombol install
  document.getElementById("pwaInstallBtn").style.display = "flex";
});

// INSTALL BUTTON CLICK
document.getElementById("pwaInstallBtn").addEventListener("click", async () => {

  if (!deferredPrompt) {
    alert("Jika tombol tidak muncul:\nKlik ⋮ → Install App / Tambahkan ke layar utama");
    return;
  }

  deferredPrompt.prompt();

  const choice = await deferredPrompt.userChoice;

  if (choice.outcome === 'accepted') {
    console.log("User accepted install");
  } else {
    console.log("User dismissed install");
  }

  deferredPrompt = null;
});

// =======================
// DELAY INSTALL GATE (PENTING)
// =======================

setTimeout(() => {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (!isStandalone) {
    document.getElementById('pwaInstallGate').classList.remove('hidden');
  }
}, 4000);

// =======================
// USER ENGAGEMENT TRIGGER
// =======================

document.body.addEventListener('click', () => {
  console.log("User engaged");
}, { once: true });

// =======================
// DETEKSI WEBVIEW (WA/IG)
// =======================

const isWebView = /(wv|WhatsApp|Instagram|FBAN|FBAV|Line)/i.test(navigator.userAgent);

if (isWebView) {
  alert("⚠️ Buka di Chrome agar bisa install aplikasi");
}

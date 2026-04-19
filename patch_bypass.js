const fs = require('fs');
let content = fs.readFileSync('c:/laragon/www/cbtl/index.html', 'utf8');

const bypassHtml = `        <button id="pwaBypassBtn" class="mt-6 text-[11px] text-slate-400 underline underline-offset-2 hover:text-indigo-500 transition-colors" onclick="document.getElementById('pwaBypassConfirm').classList.remove('hidden')" style="display:none">
            Sudah install tapi halaman ini masih muncul?
        </button>
        <div id="pwaBypassConfirm" class="hidden mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 max-w-xs text-left">
            <p class="text-[12px] font-bold text-amber-700 mb-2">&#9888; Konfirmasi</p>
            <p class="text-[11px] text-amber-600 mb-3 leading-snug">Hanya untuk yg sudah install. Jika BELUM install, ujian tidak berfungsi.</p>
            <button onclick="bypassAndEnter()" class="w-full py-2 bg-amber-500 text-white text-[12px] font-bold rounded-xl">Sudah Install: Masuk</button>
        </div>`;

const marker = '    </div>\n\n    <!-- Top App Background';
const replacement = bypassHtml + '\n' + marker;

if (content.includes(marker)) {
    content = content.replace(marker, replacement);
    fs.writeFileSync('c:/laragon/www/cbtl/index.html', content, 'utf8');
    console.log('Done - bypass button injected');
} else {
    const idx = content.indexOf('Top App Background');
    console.log('Marker not found. Context: ' + JSON.stringify(content.slice(idx - 100, idx + 20)));
}

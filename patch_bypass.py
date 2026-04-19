import re

with open('c:/laragon/www/cbtl/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the closing of pwaManualWrapper div and the outer gate div
# We want to insert bypass button between them
old = '        </div>\n    </div>\n\n    <!-- Top App Background'

new = """        </div>
        <button id="pwaBypassBtn" class="mt-6 text-[11px] text-slate-400 underline underline-offset-2 hover:text-indigo-500 transition-colors" onclick="document.getElementById('pwaBypassConfirm').classList.remove('hidden')" style="display:none">
            Sudah install tapi halaman ini masih muncul?
        </button>
        <div id="pwaBypassConfirm" class="hidden mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 max-w-xs text-left">
            <p class="text-[12px] font-bold text-amber-700 mb-2">&#9888; Konfirmasi</p>
            <p class="text-[11px] text-amber-600 mb-3 leading-snug">Hanya untuk yang sudah install. Jika BELUM install, ujian tidak berfungsi.</p>
            <button onclick="bypassAndEnter()" class="w-full py-2 bg-amber-500 text-white text-[12px] font-bold rounded-xl hover:bg-amber-600 active:scale-95 transition-all">Sudah Install &rarr; Masuk</button>
        </div>
    </div>

    <!-- Top App Background"""

if old in content:
    content = content.replace(old, new, 1)
    print("Bypass button injected successfully!")
else:
    print("Pattern not found, trying alternate search...")
    idx = content.find('Top App Background')
    print(repr(content[idx-120:idx+30]))

with open('c:/laragon/www/cbtl/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

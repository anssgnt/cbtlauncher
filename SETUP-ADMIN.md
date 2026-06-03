# 🔐 Setup Admin Credentials (Aman)

## ⚠️ PENTING
**Password default sudah dihapus.** Anda WAJIB set password baru via Google Apps Script.

## Langkah-Langkah Setup

### 1. Buka Google Apps Script
```
https://script.google.com/macros/d/AKfycbyE9kxtudmZZv9FSj60yBlFVsH_j6f26lcKg3wVtOK2FLdkQ-UaZRFX5mHUDWNEHwJGOg/edit
```

### 2. Buka Project Settings
Klik **Project Settings** (gear icon) di sebelah kiri.

### 3. Scroll ke "Script properties"
Lihat tab **"Script properties"** di bawah "General settings".

### 4. Tambahkan ADMIN_USERS Property
**Key:** `ADMIN_USERS`  
**Value:** 
```json
[{"username":"admin","password":"PASSWORD_AMAN_ANDA"}]
```

Contoh dengan 2 admin:
```json
[
  {"username":"admin","password":"Password123!Kuat"},
  {"username":"proktor","password":"Proktor456!Aman"}
]
```

> ⚠️ Gunakan password yang KUAT:
> - Minimal 12 karakter
> - Campuran huruf besar, kecil, angka, simbol
> - Jangan gunakan nama sekolah atau kata mudah ditebak

### 5. Deploy
Tombol **Deploy** di sebelah kanan → pilih `doGet` function.

## 🔒 Keamanan

| Setting | Nilai |
|---------|-------|
| Login Attempts | 3 kali |
| Lockout Duration | 30 menit |
| Password Min | 12 karakter |
| Rate Limit | Per IP address |

### Fitur Keamanan:
✅ **Tidak ada default password** — harus set manual  
✅ **Rate limiting ketat** — 3 percobaan = lockout 30 min  
✅ **Logging lengkap** — semua login tercatat di Sheet "Log"  
✅ **Per-IP blocking** — blok perAttempts per IP  

## 🛡️ Best Practices

1. **Ganti password secara berkala** — setiap 3 bulan
2. **Jangan bagikan credential** — gunakan 1 akun per admin
3. **Monitor login attempts** — lihat di Sheet "Log"
4. **Gunakan password manager** — jangan catat di sticky notes

## 🚨 Troubleshooting

### "Sistem belum dikonfigurasi"
**Solusi:** ADMIN_USERS belum di-set di Script properties. Ikuti step 3-4 di atas.

### "Terlalu banyak percobaan"
**Solusi:** Tunggu 30 menit, atau clear di Script properties → hapus key `LOGIN_FAIL_*`

### Lupa password
**Solusi:** 
1. Buka Script properties
2. Edit value ADMIN_USERS dengan password baru
3. Deploy ulang

---

**Terakhir diupdate:** 2026-06-03  
**Status:** Wajib dikonfigurasi sebelum production

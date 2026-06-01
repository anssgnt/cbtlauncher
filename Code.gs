/**
 * BACKEND: GOOGLE APPS SCRIPT
 * REST API untuk Launcher Ujian Online CBT
 * 
 * ==============================================================================
 * CARA STANDUP (STANDALONE SCRIPT):
 * 1. Buka Google Spreadsheet baru untuk menampung tabel data jadwal ujian.
 * 2. Ambil "SPREADSHEET ID" dari URL Web Google Spreadsheet Anda.
 *    (Bentuk URL: https://docs.google.com/spreadsheets/d/[BAGIAN_INI_ADALAH_ID]/edit)
 *    Contoh: Jika URL-nya https://docs.google.com/spreadsheets/d/1abcXYZ123/edit
 *    Maka ID Anda adalah -> 1abcXYZ123
 * 
 * 3. Paste ID yang baru saja disalin ke variabel SPREADSHEET_ID pada baris kode di bawah.
 * 4. Simpan kode ini (Ctrl+S) di editor Apps Script.
 * 
 * 5. >>> PENTING: SETUP OTOMATIS <<<
 *    Pilih fungsi "setupSpreadsheet" di dropdown menu atas (sebelah tulisan Run/Jalankan).
 *    Lalu klik "Run". Sistem akan meminta otorisasi akun, setujui.
 *    Fungsi ini akan otomatis menyiapkan Sheet Anda lengkap dengan kolom & header!
 * 
 * 6. Klik tombol `Terapkan` (Deploy) biru di sudut kanan atas > `Deployment baru`.
 * 7. Konfigurasi: 
 *    - Pilih `Web app` (Aplikasi Web)
 *    - Jalankan sebagai (Execute as) : Me / Saya
 *    - Siapa yang memiliki akses : Anyone / Siapa Saja
 * 8. Klik `Deploy`.
 * 9. Terakhir, Copy URL Web App yang muncul, dan paste ke variabel `URL_API` di dalam `index.html`.
 * ==============================================================================
 */

// --- KONFIGURASI UTAMA ---
const SPREADSHEET_ID = "1WmISd-Raij-eNftAiJkHg9Rc694v8UTMpkYs-eU7DXo";
const SHEET_NAME = "Jadwal";
const CONFIG_SHEET_NAME = "Config";


/**
 * FUNGSI SETUP OTOMATIS (JALANKAN SEKALI SAJA)
 * Berfungsi membuat template Header & Sheet jika belum ada
 */
function setupSpreadsheet() {
  let ss;
  if (SPREADSHEET_ID && SPREADSHEET_ID !== "1WmISd-Raij-eNftAiJkHg9Rc694v8UTMpkYs-eU7DXo") {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet(); 
  }

  if (!ss) {
    Logger.log("❌ ERROR: Spreadsheet tidak ditemukan. Pastikan SPREADSHEET_ID sudah benar atau script menempel di spreadsheet.");
    return;
  }

  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    Logger.log("✔ Sheet '" + SHEET_NAME + "' berhasil dibuat.");
    
    // (Opsional) Hapus Sheet1 bawaan yang kosong jika diperlukan
    const sheet1 = ss.getSheetByName("Sheet1");
    if (sheet1) ss.deleteSheet(sheet1);
  } else {
    Logger.log("ℹ️ Sheet '" + SHEET_NAME + "' sudah tersedia.");
  }

  // --- Setup Sheet Config ---
  let configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!configSheet) {
    configSheet = ss.insertSheet(CONFIG_SHEET_NAME);
    configSheet.getRange(1, 1, 1, 2).setValues([["Key", "Value"]]).setBackground("#f59e0b").setFontColor("#ffffff").setFontWeight("bold");
    configSheet.getRange(2, 1, 1, 2).setValues([["PROCTOR_KEY", "2025"]]);
    Logger.log("✔ Sheet '" + CONFIG_SHEET_NAME + "' berhasil dibuat dengan default key.");
  }

  // Setup baris Headers
  const headers = ["ID", "Nama", "Link", "Start", "End", "Status", "Token"];
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  
  headerRange.setValues([headers]);
  headerRange.setBackground("#2563eb"); // Warna biru Tailwind
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  
  sheet.setFrozenRows(1); // Kunci baris atas (Freeze)

  // Isi Data Format Contoh (Jika sheet belum ada data lain)
  if (sheet.getLastRow() <= 1) {
    // Format Waktu yang direkomendasikan adalah Teks Plain YYYY-MM-DD HH:mm
    sheet.getRange("D:E").setNumberFormat("@"); // Set format tipe text agar tidak dirubah otomatis oleh google

    const nowStr = new Date().toISOString().split('T')[0]; // Format tanggal saat ini
    const dummyData = [
      ["1", "Ujian Demo Matematika (Sedang Berjalan)", "https://forms.gle/contoh1", `${nowStr} 05:00`, `${nowStr} 23:59`, "aktif", "MATH10"],
      ["2", "Ujian Demo B.Indonesia (Belum Mulai)", "https://forms.gle/contoh2", "2026-12-31 08:00", "2026-12-31 10:00", "aktif", "INDO10"],
      ["3", "Ujian Arsip Susulan (Non-aktif)", "https://forms.gle/contoh3", "2020-01-01 08:00", "2020-01-01 10:00", "nonaktif", ""]
    ];
    sheet.getRange(2, 1, dummyData.length, headers.length).setValues(dummyData);
    Logger.log("✔ Data ujian contoh (Dummy) telah ditambahkan.");
  }
  
  sheet.autoResizeColumns(1, headers.length);
  Logger.log("⭐ SETUP SELESAI! Silakan buka Spreadsheet Anda untuk melihat format yang terbentuk.");
}


/**
 * FUNGSI UTAMA API BACA DATA (doGet)
 */
function doGet(e) {
  try {
    // SCALING FIX: Cek Cache terlebih dulu untuk menghadapi ratusan/ribuan request serentak
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get("CBT_EXAM_DATA");
    
    if (cachedData) {
      // Jika data tersimpan di memory sementara, langsung balas tanpa membaca Spreadsheet! (Sangat Aman & Cepat)
      return responseJSON(JSON.parse(cachedData));
    }

    // THUNDERING HERD PROTECTION: Jika ratusan request jebol masuk bersamaan karena cache habis, 
    // kita kunci proses ini. Hanya 1 request pertama yang boleh membaca Spreadsheet, sisanya disuruh antre maksimal 5 detik.
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(5000); // Tunggu sampai 5 detik jika ada request lain yang sedang proses ambil data
    } catch (e) {
      // Jika ternyata > 5 detik masih antre (super extreme traffic), kembalikan response retry ke client
      return responseJSON({ 
        error: true, 
        message: "Server sedang sangat sibuk menangani ratusan siswa. Sistem akan otomatis me-refresh dalam 3 detik...",
        retryAlert: true
      });
    }

    // Double Check Cache! (Setelah sabar antre, jangan-jangan request pertama tadi sudah naruh datanya ke cache)
    const doubleCheckCache = cache.get("CBT_EXAM_DATA");
    if (doubleCheckCache) {
      lock.releaseLock();
      return responseJSON(JSON.parse(doubleCheckCache));
    }

    let ss;
    
    // Cek apakah user telah memasukkan SPREADSHEET_ID
    if (SPREADSHEET_ID && SPREADSHEET_ID !== "ISI_ID_SPREADSHEET_DI_SINI") {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID); // Membuka via ID
    } else {
      // Fallback: Jika script terikat kuat dengan spreadsheet (Container-bound)
      ss = SpreadsheetApp.getActiveSpreadsheet(); 
    }

    if (!ss) {
      return responseJSON({ 
        error: true, 
        message: "Spreadsheet tidak ditemukan. Pastikan SPREADSHEET_ID telah diisi dengan benar." 
      });
    }

    const sheet = ss.getSheetByName(SHEET_NAME);
    
    // Handling error jika sheet salah nama
    if (!sheet) {
      return responseJSON({ 
        error: true, 
        message: "Sheet dengan nama '" + SHEET_NAME + "' tidak ditemukan dalam Spreadsheet." 
      });
    }

    // Ambil seluruh data dari A1 sampai ujung
    const data = sheet.getDataRange().getValues();
    
    // Jika sheet kosong atau hanya berisi baris header saja
    if (data.length <= 1) {
      return responseJSON([]);
    }
    
    const exams = [];
    
    // Looping record (mulai index 1 untuk melewati baris header ke-0)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const idStr = String(row[0]).trim();
      
      // Mengabaikan baris kosong
      if (idStr === "") continue; 
      
      // Mapping cell ke struktur JSON Front-End
      const exam = {
        id: idStr,
        nama: String(row[1]).trim(),
        link: String(row[2]).trim(),
        start: formatDateTime(row[3]),
        end: formatDateTime(row[4]),
        status: String(row[5]).trim().toLowerCase(),
        token: String(row[6] !== undefined ? row[6] : "").trim()
      };
      
      exams.push(exam);
    }
    
    // Ambil Config (Proctor Key)
    const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    let proctorKey = "2025"; // Default if not found
    if (configSheet) {
      const configData = configSheet.getDataRange().getValues();
      for (let i = 1; i < configData.length; i++) {
        if (configData[i][0] === "PROCTOR_KEY") {
          proctorKey = configData[i][1].toString();
          break;
        }
      }
    }

    const result = {
      exams: exams,
      config: {
        proctorKey: proctorKey
      }
    };

    // Simpan hasil data ke Dalam memory Cache (Tahan selama 60 Detik)
    cache.put("CBT_EXAM_DATA", JSON.stringify(result), 60);

    // Buka Gembok Antrean (Lock) agar 199 siswa yang tadi tertahan bisa melesat membaca dari Cache
    if (lock.hasLock()) {
      lock.releaseLock();
    }

    return responseJSON(result);

  } catch (err) {
    // Pastikan gembok dibuka jika terjadi crash/error supaya tidak dead-lock
    try { 
      const lock = LockService.getScriptLock();
      if (lock.hasLock()) lock.releaseLock(); 
    } catch(e) {}

    // Tangkap interupsi tidak terduga, misal ID Spreadsheet tidak valid atau dibatasi izin
    let errMsg = err.toString();
    if (errMsg.includes("No item with the given ID could be found")) {
      errMsg = "Akses Ditolak: Pastikan SPREADSHEET_ID benar dan Script diotorisasi menggunakan akun yang memiliki akses ke Spreadseet.";
    }
    
    return responseJSON({
      error: true,
      message: errMsg
    });
  }
}

/**
 * FORMATH UTILITY
 * Bertugas mengembalikan string Tanggal Waktu dalam format aman YYYY-MM-DD HH:mm
 */
function formatDateTime(dateVal) {
  if (!dateVal) return "";
  
  if (Object.prototype.toString.call(dateVal) === '[object Date]') {
    const yyyy = dateVal.getFullYear();
    const MM = String(dateVal.getMonth() + 1).padStart(2, '0');
    const dd = String(dateVal.getDate()).padStart(2, '0');
    const HH = String(dateVal.getHours()).padStart(2, '0');
    const mm = String(dateVal.getMinutes()).padStart(2, '0');
    
    return yyyy + "-" + MM + "-" + dd + " " + HH + ":" + mm;
  }
  
  return String(dateVal).trim();
}

/**
 * JSON RESPONSE UTILITY
 * Bertugas mengonversi Array Object menjadi Output Website standar API
 */
function responseJSON(data) {
  const jsonString = JSON.stringify(data);
  return ContentService.createTextOutput(jsonString)
    .setMimeType(ContentService.MimeType.JSON);
}

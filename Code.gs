/**
 * BACKEND: GOOGLE APPS SCRIPT
 * REST API untuk Launcher Ujian Online CBT + Admin Panel
 * 
 * SETUP: Jalankan setupSpreadsheet() sekali, lalu deploy sebagai Web App.
 */

// --- KONFIGURASI UTAMA ---
const SPREADSHEET_ID = "1WmISd-Raij-eNftAiJkHg9Rc694v8UTMpkYs-eU7DXo";
const SHEET_NAME = "Jadwal";
const CONFIG_SHEET_NAME = "Config";
const VIOLATIONS_SHEET_NAME = "Violations";
const LOG_SHEET_NAME = "Log";

// --- ADMIN CREDENTIALS ---
const ADMIN_USERS = [
  { username: "admin", password: "spensada2025" },
  { username: "proktor", password: "proktor2025" }
];


/** SETUP OTOMATIS (Jalankan sekali) */
function setupSpreadsheet() {
  var ss = getSpreadsheet();
  if (!ss) { Logger.log("ERROR: Spreadsheet tidak ditemukan."); return; }

  // Sheet Jadwal
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(SHEET_NAME); }
  var headers = ["ID", "Nama", "Link", "Start", "End", "Status", "Token"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground("#2563eb").setFontColor("#fff").setFontWeight("bold");
  sheet.setFrozenRows(1);
  if (sheet.getLastRow() <= 1) {
    sheet.getRange("D:E").setNumberFormat("@");
    var nowStr = new Date().toISOString().split('T')[0];
    sheet.getRange(2, 1, 2, 7).setValues([
      ["1", "Ujian Demo Matematika", "https://forms.gle/contoh1", nowStr+" 05:00", nowStr+" 23:59", "aktif", "MATH10"],
      ["2", "Ujian Demo B.Indonesia", "https://forms.gle/contoh2", "2026-12-31 08:00", "2026-12-31 10:00", "aktif", "INDO10"]
    ]);
  }
  sheet.autoResizeColumns(1, headers.length);

  // Sheet Config
  var cfgSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!cfgSheet) {
    cfgSheet = ss.insertSheet(CONFIG_SHEET_NAME);
    cfgSheet.getRange(1,1,1,2).setValues([["Key","Value"]]).setBackground("#f59e0b").setFontColor("#fff").setFontWeight("bold");
    cfgSheet.getRange(2,1,3,2).setValues([["PROCTOR_KEY","2025"],["MAX_VIOLATIONS","5"],["CACHE_DURATION","120"]]);
  }

  // Sheet Violations
  var vSheet = ss.getSheetByName(VIOLATIONS_SHEET_NAME);
  if (!vSheet) {
    vSheet = ss.insertSheet(VIOLATIONS_SHEET_NAME);
    vSheet.getRange(1,1,1,6).setValues([["Timestamp","ExamID","ExamName","DeviceID","ViolationCount","UserAgent"]]).setBackground("#dc2626").setFontColor("#fff").setFontWeight("bold");
    vSheet.setFrozenRows(1);
  }

  // Sheet Log
  var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(LOG_SHEET_NAME);
    logSheet.getRange(1,1,1,4).setValues([["Timestamp","Action","User","Detail"]]).setBackground("#7c3aed").setFontColor("#fff").setFontWeight("bold");
    logSheet.setFrozenRows(1);
  }

  Logger.log("SETUP SELESAI!");
}


/** HELPERS */
function getSpreadsheet() {
  if (SPREADSHEET_ID && SPREADSHEET_ID !== "ISI_ID_SPREADSHEET_DI_SINI") {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function writeLog(action, user, detail) {
  try {
    var ss = getSpreadsheet();
    var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (logSheet) logSheet.appendRow([new Date().toISOString(), action, user, detail]);
  } catch(e) {}
}

function authenticateAdmin(payload) {
  if (!payload || !payload.username || !payload.password) return false;
  return ADMIN_USERS.some(function(u) {
    return u.username === payload.username && u.password === payload.password;
  });
}

function getConfig(ss) {
  var configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  var config = {};
  if (configSheet) {
    var data = configSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) config[data[i][0]] = String(data[i][1]);
    }
  }
  return config;
}

function generateToken(len) {
  len = len || 6;
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var r = "";
  for (var i = 0; i < len; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
  return r;
}

function formatDateTime(dateVal) {
  if (!dateVal) return "";
  if (Object.prototype.toString.call(dateVal) === '[object Date]') {
    var yyyy = dateVal.getFullYear();
    var MM = String(dateVal.getMonth()+1).padStart(2,'0');
    var dd = String(dateVal.getDate()).padStart(2,'0');
    var HH = String(dateVal.getHours()).padStart(2,'0');
    var mm = String(dateVal.getMinutes()).padStart(2,'0');
    return yyyy+"-"+MM+"-"+dd+" "+HH+":"+mm;
  }
  return String(dateVal).trim();
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}


/**
 * doGet — Endpoint utama.
 * Jika ada ?payload= → admin action. Jika tidak → return data ujian untuk siswa.
 */
function doGet(e) {
  try {
    // Admin action via GET ?payload=...
    if (e && e.parameter && e.parameter.payload) {
      var rawPayload = e.parameter.payload;
      var payload;
      try {
        // GAS sudah auto-decode URL parameters, jadi coba parse langsung
        payload = JSON.parse(rawPayload);
      } catch(pe) {
        // Fallback: mungkin masih encoded
        try {
          payload = JSON.parse(decodeURIComponent(rawPayload));
        } catch(pe2) {
          return responseJSON({ error: true, message: "Payload parse error: " + pe2.toString(), raw: rawPayload.substring(0,100) });
        }
      }
      return handleAdminAction(payload);
    }

    // Normal: return exam data
    var cache = CacheService.getScriptCache();
    var cachedData = cache.get("CBT_EXAM_DATA");
    if (cachedData) return responseJSON(JSON.parse(cachedData));

    var lock = LockService.getScriptLock();
    try { lock.waitLock(5000); } catch(le) {
      return responseJSON({ error: true, message: "Server sibuk, coba lagi.", retryAlert: true });
    }

    var doubleCheck = cache.get("CBT_EXAM_DATA");
    if (doubleCheck) { lock.releaseLock(); return responseJSON(JSON.parse(doubleCheck)); }

    var ss = getSpreadsheet();
    if (!ss) return responseJSON({ error: true, message: "Spreadsheet tidak ditemukan." });

    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return responseJSON({ error: true, message: "Sheet tidak ditemukan." });

    var data = sheet.getDataRange().getValues();
    var exams = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var idStr = String(row[0]).trim();
      if (idStr === "") continue;
      exams.push({
        id: idStr,
        nama: String(row[1]).trim(),
        link: String(row[2]).trim(),
        start: formatDateTime(row[3]),
        end: formatDateTime(row[4]),
        status: String(row[5]).trim().toLowerCase(),
        token: String(row[6] !== undefined ? row[6] : "").trim()
      });
    }

    var config = getConfig(ss);
    var result = {
      exams: exams,
      config: { proctorKey: config.PROCTOR_KEY || "2025", maxViolations: parseInt(config.MAX_VIOLATIONS) || 5 }
    };

    cache.put("CBT_EXAM_DATA", JSON.stringify(result), parseInt(config.CACHE_DURATION) || 120);
    if (lock.hasLock()) lock.releaseLock();
    return responseJSON(result);

  } catch(err) {
    try { var lk = LockService.getScriptLock(); if(lk.hasLock()) lk.releaseLock(); } catch(x){}
    return responseJSON({ error: true, message: err.toString() });
  }
}


/**
 * doPost — Fallback untuk admin actions & violation reports
 */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    return handleAdminAction(payload);
  } catch(err) {
    return responseJSON({ error: true, message: "Server Error: " + err.toString() });
  }
}

/**
 * ROUTER: Admin Actions
 */
function handleAdminAction(payload) {
  var action = payload.action;

  if (action === "reportViolation") return handleReportViolation(payload);
  if (action === "login") return handleLogin(payload);

  // Protected
  if (!authenticateAdmin(payload)) {
    return responseJSON({ error: true, message: "Akses ditolak. Kredensial tidak valid." });
  }
  var user = payload.username;

  switch(action) {
    case "getAdminData": return handleGetAdminData(user);
    case "addExam": return handleAddExam(payload, user);
    case "editExam": return handleEditExam(payload, user);
    case "deleteExam": return handleDeleteExam(payload, user);
    case "toggleStatus": return handleToggleStatus(payload, user);
    case "updateConfig": return handleUpdateConfig(payload, user);
    case "clearCache": return handleClearCache(user);
    case "killAll": return handleKillAll(user);
    case "getViolations": return handleGetViolations(user);
    case "clearViolations": return handleClearViolations(payload, user);
    case "getLogs": return handleGetLogs(user);
    default: return responseJSON({ error: true, message: "Action tidak dikenali: " + action });
  }
}


/** LOGIN */
function handleLogin(payload) {
  if (authenticateAdmin(payload)) {
    writeLog("LOGIN", payload.username, "Login berhasil");
    return responseJSON({ success: true, message: "Login berhasil" });
  }
  return responseJSON({ error: true, message: "Username atau password salah." });
}

/** GET ALL ADMIN DATA */
function handleGetAdminData(adminUser) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var exams = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[0]).trim() === "") continue;
    exams.push({
      id: String(row[0]).trim(), nama: String(row[1]).trim(), link: String(row[2]).trim(),
      start: formatDateTime(row[3]), end: formatDateTime(row[4]),
      status: String(row[5]).trim().toLowerCase(), token: String(row[6]!==undefined?row[6]:"").trim()
    });
  }
  var config = getConfig(ss);

  // Violations
  var vSheet = ss.getSheetByName(VIOLATIONS_SHEET_NAME);
  var violations = [];
  if (vSheet && vSheet.getLastRow() > 1) {
    var vData = vSheet.getDataRange().getValues();
    for (var j = 1; j < vData.length; j++) {
      violations.push({ timestamp:vData[j][0], examId:vData[j][1], examName:vData[j][2], deviceId:vData[j][3], count:vData[j][4], userAgent:vData[j][5] });
    }
  }

  // Logs (last 50)
  var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  var logs = [];
  if (logSheet && logSheet.getLastRow() > 1) {
    var lData = logSheet.getDataRange().getValues();
    var startIdx = Math.max(1, lData.length - 50);
    for (var k = lData.length - 1; k >= startIdx; k--) {
      logs.push({ timestamp:lData[k][0], action:lData[k][1], user:lData[k][2], detail:lData[k][3] });
    }
  }

  return responseJSON({
    success: true, exams: exams, config: config, violations: violations, logs: logs,
    stats: { totalExams: exams.length, activeExams: exams.filter(function(e){return e.status==="aktif"}).length, totalViolations: violations.length }
  });
}


/** ADD EXAM */
function handleAddExam(payload, adminUser) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var newId = payload.id || Date.now().toString(36) + Math.random().toString(36).substr(2,5);
  var token = payload.token || generateToken(6);
  sheet.appendRow([newId, payload.nama||"Ujian Baru", payload.link||"", payload.start||"", payload.end||"", payload.status||"aktif", token]);
  CacheService.getScriptCache().remove("CBT_EXAM_DATA");
  writeLog("ADD_EXAM", adminUser, "Menambah: " + (payload.nama||"") + " (ID:"+newId+")");
  return responseJSON({ success: true, message: "Ujian berhasil ditambahkan.", id: newId, token: token });
}

/** EDIT EXAM */
function handleEditExam(payload, adminUser) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(payload.id).trim()) { rowIndex = i+1; break; }
  }
  if (rowIndex === -1) return responseJSON({ error: true, message: "Ujian tidak ditemukan." });
  if (payload.nama !== undefined) sheet.getRange(rowIndex,2).setValue(payload.nama);
  if (payload.link !== undefined) sheet.getRange(rowIndex,3).setValue(payload.link);
  if (payload.start !== undefined) sheet.getRange(rowIndex,4).setValue(payload.start);
  if (payload.end !== undefined) sheet.getRange(rowIndex,5).setValue(payload.end);
  if (payload.status !== undefined) sheet.getRange(rowIndex,6).setValue(payload.status);
  if (payload.token !== undefined) sheet.getRange(rowIndex,7).setValue(payload.token);
  CacheService.getScriptCache().remove("CBT_EXAM_DATA");
  writeLog("EDIT_EXAM", adminUser, "Edit ID:"+payload.id+" - "+(payload.nama||""));
  return responseJSON({ success: true, message: "Ujian berhasil diperbarui." });
}

/** DELETE EXAM */
function handleDeleteExam(payload, adminUser) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1; var examName = "";
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(payload.id).trim()) { rowIndex = i+1; examName = data[i][1]; break; }
  }
  if (rowIndex === -1) return responseJSON({ error: true, message: "Ujian tidak ditemukan." });
  sheet.deleteRow(rowIndex);
  CacheService.getScriptCache().remove("CBT_EXAM_DATA");
  writeLog("DELETE_EXAM", adminUser, "Hapus: "+examName+" (ID:"+payload.id+")");
  return responseJSON({ success: true, message: "Ujian berhasil dihapus." });
}


/** TOGGLE STATUS */
function handleToggleStatus(payload, adminUser) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1; var currentStatus = ""; var examName = "";
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(payload.id).trim()) {
      rowIndex = i+1; currentStatus = String(data[i][5]).trim().toLowerCase(); examName = data[i][1]; break;
    }
  }
  if (rowIndex === -1) return responseJSON({ error: true, message: "Ujian tidak ditemukan." });
  var newStatus = currentStatus === "aktif" ? "nonaktif" : "aktif";
  sheet.getRange(rowIndex,6).setValue(newStatus);
  CacheService.getScriptCache().remove("CBT_EXAM_DATA");
  writeLog("TOGGLE_STATUS", adminUser, examName+": "+currentStatus+" -> "+newStatus);
  return responseJSON({ success: true, message: "Status diubah ke "+newStatus, newStatus: newStatus });
}

/** UPDATE CONFIG */
function handleUpdateConfig(payload, adminUser) {
  var ss = getSpreadsheet();
  var cfgSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!cfgSheet) return responseJSON({ error: true, message: "Sheet Config tidak ditemukan." });
  var data = cfgSheet.getDataRange().getValues();
  var updates = payload.config || {};
  Object.keys(updates).forEach(function(key) {
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) { cfgSheet.getRange(i+1,2).setValue(updates[key]); found = true; break; }
    }
    if (!found) cfgSheet.appendRow([key, updates[key]]);
  });
  CacheService.getScriptCache().remove("CBT_EXAM_DATA");
  writeLog("UPDATE_CONFIG", adminUser, JSON.stringify(updates));
  return responseJSON({ success: true, message: "Konfigurasi berhasil disimpan." });
}

/** CLEAR CACHE */
function handleClearCache(adminUser) {
  CacheService.getScriptCache().remove("CBT_EXAM_DATA");
  writeLog("CLEAR_CACHE", adminUser, "Cache di-flush manual");
  return responseJSON({ success: true, message: "Cache berhasil dibersihkan." });
}

/** KILL ALL */
function handleKillAll(adminUser) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][5]).trim().toLowerCase() === "aktif") { sheet.getRange(i+1,6).setValue("nonaktif"); count++; }
  }
  CacheService.getScriptCache().remove("CBT_EXAM_DATA");
  writeLog("KILL_ALL", adminUser, "DARURAT: "+count+" ujian dinonaktifkan");
  return responseJSON({ success: true, message: count+" ujian berhasil dinonaktifkan." });
}


/** REPORT VIOLATION (Public - dari siswa) */
function handleReportViolation(payload) {
  try {
    var ss = getSpreadsheet();
    var vSheet = ss.getSheetByName(VIOLATIONS_SHEET_NAME);
    if (vSheet) {
      vSheet.appendRow([new Date().toISOString(), payload.examId||"", payload.examName||"", payload.deviceId||"", payload.violationCount||0, payload.userAgent||""]);
    }
    return responseJSON({ success: true });
  } catch(e) {
    return responseJSON({ error: true, message: e.toString() });
  }
}

/** GET VIOLATIONS */
function handleGetViolations(adminUser) {
  var ss = getSpreadsheet();
  var vSheet = ss.getSheetByName(VIOLATIONS_SHEET_NAME);
  var violations = [];
  if (vSheet && vSheet.getLastRow() > 1) {
    var data = vSheet.getDataRange().getValues();
    for (var i = data.length-1; i >= 1; i--) {
      violations.push({ timestamp:data[i][0], examId:data[i][1], examName:data[i][2], deviceId:data[i][3], count:data[i][4], userAgent:data[i][5] });
    }
  }
  return responseJSON({ success: true, violations: violations });
}

/** CLEAR VIOLATIONS */
function handleClearViolations(payload, adminUser) {
  var ss = getSpreadsheet();
  var vSheet = ss.getSheetByName(VIOLATIONS_SHEET_NAME);
  if (vSheet && vSheet.getLastRow() > 1) vSheet.deleteRows(2, vSheet.getLastRow()-1);
  writeLog("CLEAR_VIOLATIONS", adminUser, "Semua data pelanggaran dihapus");
  return responseJSON({ success: true, message: "Data pelanggaran dihapus." });
}

/** GET LOGS */
function handleGetLogs(adminUser) {
  var ss = getSpreadsheet();
  var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  var logs = [];
  if (logSheet && logSheet.getLastRow() > 1) {
    var data = logSheet.getDataRange().getValues();
    for (var i = data.length-1; i >= 1; i--) {
      logs.push({ timestamp:data[i][0], action:data[i][1], user:data[i][2], detail:data[i][3] });
    }
  }
  return responseJSON({ success: true, logs: logs });
}

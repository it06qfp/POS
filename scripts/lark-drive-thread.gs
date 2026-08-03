// ============================================================================
// POS → Lark: เก็บรูปเป็นโฟลเดอร์รายวันใน Drive แล้วส่งเข้า thread เดียว (รอบเดียวจบ)
//
// โครงสร้างใน Drive:
//   Lark - POS - Report/            ← โฟลเดอร์แม่ (DRIVE_IMAGES_FOLDER_ID)
//     ├─ 2026-08-03/                ← โฟลเดอร์รายวัน (ชื่อ = วันที่ BKK yyyy-MM-dd)
//     │    ├─ 1_xxx.png  ..  4_xxx.png   ← GitHub Action (Coda → Pillow) อัปมาวาง
//     │    └─ 5_weekly.png               ← Apps Script เซฟรูปรายงานสัปดาห์มาวาง
//     └─ 2026-08-04/ ...
//
// flow ที่ตั้งใจ (รอบเดียว ไม่ต้องนัดเวลา ไม่ต้อง handoff):
//   1. GitHub Action วางรูป 1-4 ลงโฟลเดอร์ของวันนั้น
//   2. Apps Script: renderWeeklyReportImage_() → saveImageToDailyFolder_() (รูปที่ 5)
//   3. Apps Script: อ่านรูปทั้งโฟลเดอร์ของวันนั้น → createThreadRoot_() → reply ทุกรูป
//   เข้า runDailyLarkPost() ทำ 2+3 ต่อกันใน run เดียว
//
// ข้อดีเทียบแบบเดิม: ไม่ต้องอ่าน latest_thread.json (ไม่โดน CDN cache), ไม่ต้องหา thread เก่า,
// ไม่ต้องเว้นเวลาระหว่าง trigger, รูปเก่าถูกเก็บเป็นรายวันอยู่แล้วในตัว
//
// Script Properties:
//   LARK_APP_ID, LARK_APP_SECRET          (มีอยู่แล้ว)
//   LARK_CHAT_ID                          ห้องปลายทาง
//   DRIVE_IMAGES_FOLDER_ID                โฟลเดอร์แม่ "Lark - POS - Report"
//   Test_BOT_Webhook          (optional)  ถ้าตั้ง จะส่ง card 1 ใบ (รูปแรก) เข้าห้อง external
//
// ต้องอยู่โปรเจกต์เดียวกับ lark-appsscript-complete.gs (ใช้ค่า OWNER / REPO และ helper ร่วม: getLarkTenantToken_ /
// uploadImageToLark_ / createThreadRoot_ / replyImageInThread_ / sendCardToExternal_ /
// formatBangkokTimestamp_ / readWeeklySheetData_ / renderWeeklyReportImage_)
//
// งบเวลา (เพดาน GAS 360 วิ): render สัปดาห์ ~30-60 วิ + ต่อรูป ~3 RPC (getBlob+upload+reply)
// ≈ 1.0-1.5 วิ/รูป → 5 รูป ≈ 7 วิ, 20 รูป ≈ 30 วิ, ที่ cap 80 รูป ≈ 120 วิ → รวมสุดยัง < 200 วิ
// ============================================================================

const DRIVE_THREAD_TITLE = 'POS Report';
const MAX_IMAGES = 80;                     // กันโฟลเดอร์บวมแล้วรันชนเพดาน 6 นาที
const MAX_IMAGE_BYTES = 9 * 1024 * 1024;   // Lark รับรูป 10MB — กันไว้ 9MB
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'];
const WEEKLY_IMAGE_PREFIX = '5_weekly';    // ตั้งชื่อให้เรียงท้ายสุดหลังรูป 1-4 ของ Action
const IMAGES_BRANCH = 'daily-images';      // branch ที่ GitHub Action วางรูป 1-4 + manifest.json

// ค่าเริ่มต้นของโฟลเดอร์แม่ "Lark - POS - Report" (My Drive ของบัญชีที่รันสคริปต์นี้)
// ไม่ใช่ความลับ — เป็นแค่ id โฟลเดอร์ การเข้าถึงยังต้องมีสิทธิ์ใน Drive อยู่ดี
// ตั้ง Script Property ชื่อเดียวกันเพื่อ override ได้ถ้าย้ายโฟลเดอร์
const DEFAULT_IMAGES_FOLDER_ID = '1M988dUYfsu9re0PfhFS8SUuP7KRcrlU7';

function requiredProp_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('ยังไม่ได้ตั้ง Script Property ชื่อ ' + name);
  return v;
}

/** id โฟลเดอร์แม่: ใช้ Script Property ถ้ามี ไม่มีก็ใช้ค่าเริ่มต้น (รันครั้งแรกได้เลยไม่ต้องตั้งอะไร) */
function imagesFolderId_() {
  return PropertiesService.getScriptProperties().getProperty('DRIVE_IMAGES_FOLDER_ID')
    || DEFAULT_IMAGES_FOLDER_ID;
}

/**
 * ห้องปลายทาง: ใช้ Script Property ถ้ามี ไม่มีก็ใช้ const LARK_CHAT_ID ที่ประกาศใน
 * lark-appsscript-complete.gs — จำเป็น เพราะโปรเจกต์นี้เก็บ chat id เป็น const ไม่ใช่ property
 * (ถ้าบังคับอ่านจาก property เท่านั้น การรันครั้งแรกจะ throw ทั้งที่ค่ามีอยู่ในโค้ดแล้ว)
 */
function larkChatId_() {
  return PropertiesService.getScriptProperties().getProperty('LARK_CHAT_ID') || LARK_CHAT_ID;
}

/** ชื่อโฟลเดอร์รายวัน = วันที่ตามเวลาไทย (yyyy-MM-dd) — ฝั่ง Action ต้องใช้รูปแบบเดียวกัน */
function dailyFolderName_(date) {
  return Utilities.formatDate(date || new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

/**
 * หา/สร้างโฟลเดอร์รายวันใต้โฟลเดอร์แม่
 * ใช้ LockService กัน race กับ trigger ตัวอื่นของโปรเจกต์เดียวกัน
 * ถ้ามีชื่อซ้ำหลายอัน (Drive ยอมให้ซ้ำ — เช่นฝั่ง Action สร้างพร้อมกัน) เลือกอันที่สร้างก่อนสุด
 * เพื่อให้ทั้งสองระบบลงเอยที่โฟลเดอร์เดียวกันเสมอ
 */
function getOrCreateDailyFolder_(parent, name) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const it = parent.getFoldersByName(name);
    let chosen = null;
    while (it.hasNext()) {
      const f = it.next();
      if (!chosen || f.getDateCreated() < chosen.getDateCreated()) chosen = f;
    }
    if (chosen) return chosen;
    return parent.createFolder(name);
  } finally {
    lock.releaseLock();
  }
}

/** โฟลเดอร์ของวันนี้ (สร้างถ้ายังไม่มี) */
function todayFolder_() {
  const parent = DriveApp.getFolderById(imagesFolderId_());
  return getOrCreateDailyFolder_(parent, dailyFolderName_());
}

/** รวมไฟล์รูปในโฟลเดอร์ เรียงตามชื่อ (คุมลำดับด้วยการตั้งชื่อ 1_..5_) แล้วตามเวลาสร้าง */
function listDriveImages_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (IMAGE_MIME.indexOf(String(f.getMimeType()).toLowerCase()) === -1) continue;
    files.push(f);
  }
  files.sort(function (a, b) {
    const an = a.getName(), bn = b.getName();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.getDateCreated() - b.getDateCreated();
  });
  return files;
}

/** ดูก่อนส่ง (ไม่ส่งอะไร) — ใช้เช็คสิทธิ์ Drive + ดูว่าวันนี้มีรูปกี่ใบ ลำดับไหน */
function previewDriveImages() {
  const parent = DriveApp.getFolderById(imagesFolderId_());
  Logger.log('โฟลเดอร์แม่: ' + parent.getName() + ' (' + parent.getId() + ')');
  const name = dailyFolderName_();
  const it = parent.getFoldersByName(name);
  if (!it.hasNext()) {
    Logger.log('ยังไม่มีโฟลเดอร์ของวันนี้: ' + name + ' (จะถูกสร้างตอนส่ง)');
    return 0;
  }
  const folder = it.next();
  const files = listDriveImages_(folder);
  Logger.log('โฟลเดอร์วันนี้: ' + name + ' — เจอรูป ' + files.length + ' ใบ');
  files.forEach(function (f, i) {
    const mb = (f.getSize() / 1024 / 1024).toFixed(2);
    Logger.log((i + 1) + '. ' + f.getName() + '  (' + mb + ' MB)'
      + (f.getSize() > MAX_IMAGE_BYTES ? '  ⚠️ เกิน 9MB จะถูกข้าม' : ''));
  });
  return files.length;
}

/** เซฟ blob รูปลงโฟลเดอร์รายวัน — ถ้ามีชื่อเดิมอยู่แล้วให้ทับ (กันไฟล์ซ้ำตอนรันซ้ำ) */
function saveImageToDailyFolder_(blob, fileName) {
  const folder = todayFolder_();
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);
  const file = folder.createFile(blob.setName(fileName));
  console.log('เซฟรูปลง Drive: ' + dailyFolderName_() + '/' + fileName
    + ' (' + (file.getSize() / 1024).toFixed(0) + ' KB)');
  return file;
}

/**
 * ดึงรูป 1-4 ที่ GitHub Action วางไว้บน branch daily-images มาเซฟลงโฟลเดอร์วันนี้
 * ไม่ต้องมี credential Google ฝั่ง Actions — Apps Script เป็นเจ้าของโฟลเดอร์ Drive อยู่แล้ว
 * repo เป็น public จึงอ่านได้แม้ไม่มี GH_TOKEN (ถ้ามี token จะใช้เพื่อ rate limit ที่สูงกว่า)
 * manifest.json มี date → ถ้าไม่ใช่ของวันนี้จะไม่ดึง (กันเอารูปเมื่อวานมาโพสต์ซ้ำ)
 * คืนจำนวนรูปที่เซฟได้
 *
 * scale: 1 + N ครั้งของ UrlFetchApp (manifest + รูป N ใบ) — 4 รูป ≈ 2-4 วิ
 */
function pullActionImagesToDrive_() {
  const todayName = dailyFolderName_();
  const manifest = fetchFromImagesBranch_('manifest.json');
  if (!manifest) {
    console.log('อ่าน manifest.json จาก branch ' + IMAGES_BRANCH + ' ไม่ได้ → ข้ามการดึงรูปจาก Action');
    return 0;
  }
  let info;
  try {
    info = JSON.parse(manifest.getDataAsString());
  } catch (err) {
    console.log('manifest.json เสีย: ' + err);
    return 0;
  }
  if (info.date !== todayName) {
    console.log('manifest เป็นของวันที่ ' + info.date + ' (ไม่ใช่ ' + todayName
      + ') → ไม่ดึงรูป (Action อาจยังไม่รันวันนี้)');
    return 0;
  }

  const names = info.files || [];
  let saved = 0;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const blob = fetchFromImagesBranch_(name);
    if (!blob) {
      console.log('⚠️ ดึงรูป ' + name + ' ไม่ได้ → ข้าม');
      continue;
    }
    saveImageToDailyFolder_(blob, name);
    saved++;
  }
  console.log('ดึงรูปจาก Action มาเซฟใน Drive ' + saved + '/' + names.length + ' ใบ');
  return saved;
}

/** ดึงไฟล์จาก branch daily-images ผ่าน GitHub contents API (ไม่ผ่าน CDN cache) — คืน Blob หรือ null */
function fetchFromImagesBranch_(path) {
  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/'
    + encodeURIComponent(path) + '?ref=' + IMAGES_BRANCH;
  const headers = {
    Accept: 'application/vnd.github.raw',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (token) headers.Authorization = 'Bearer ' + token;
  try {
    const res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      console.log('GitHub ตอบ HTTP ' + res.getResponseCode() + ' สำหรับ ' + path);
      return null;
    }
    return res.getBlob();
  } catch (err) {
    console.log('ดึง ' + path + ' ไม่สำเร็จ: ' + err);
    return null;
  }
}

/** วาดรูปรายงานสัปดาห์แล้วเซฟลงโฟลเดอร์วันนี้ (ยังไม่ส่ง Lark) */
function saveWeeklyImageToDrive() {
  const today = new Date();
  if (Utilities.formatDate(today, 'Asia/Bangkok', 'u') === '7') {
    console.log('วันอาทิตย์ — ไม่วาดรูปรายงานสัปดาห์');
    return null;
  }
  const data = readWeeklySheetData_();
  const blob = renderWeeklyReportImage_(data.display, data.raw);
  return saveImageToDailyFolder_(blob, WEEKLY_IMAGE_PREFIX + '_' + dailyFolderName_() + '.png');
}

/**
 * ส่งรูปทุกใบในโฟลเดอร์ของวันนี้เข้า thread เดียว
 * ไม่ย้าย/ไม่ลบไฟล์ — โฟลเดอร์รายวันทำหน้าที่เก็บย้อนหลังอยู่แล้ว
 */
function sendTodayFolderToLark() {
  const chatId = larkChatId_();
  const dayName = dailyFolderName_();
  const folder = todayFolder_();

  const all = listDriveImages_(folder);
  if (all.length === 0) {
    console.log('โฟลเดอร์ ' + dayName + ' ไม่มีรูป → ไม่สร้าง thread เปล่า');
    return { sent: 0, skipped: 0, rootMessageId: null, folder: dayName };
  }
  const files = all.slice(0, MAX_IMAGES);
  if (all.length > files.length) {
    console.log('⚠️ โฟลเดอร์มี ' + all.length + ' ใบ เกิน MAX_IMAGES → ส่ง ' + files.length + ' ใบแรก');
  }

  const token = getLarkTenantToken_();
  const titleText = DRIVE_THREAD_TITLE + ' ' + dayName + ' — ข้อมูล ณ '
    + formatBangkokTimestamp_() + ' (' + files.length + ' รูป)';
  const rootMessageId = createThreadRoot_(token, chatId, titleText);
  console.log('สร้าง thread root: ' + rootMessageId);

  let sent = 0;
  let firstImageKey = null;
  const skipped = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const name = f.getName();
    try {
      if (f.getSize() > MAX_IMAGE_BYTES) {
        skipped.push(name + ' (เกิน 9MB)');
        continue;
      }
      const imageKey = uploadImageToLark_(f.getBlob(), token);
      replyImageInThread_(token, rootMessageId, imageKey);
      if (!firstImageKey) firstImageKey = imageKey;
      sent++;
      console.log('ส่งรูป ' + (i + 1) + '/' + files.length + ': ' + name);
    } catch (err) {
      // รูปเดียวพังไม่ควรทำให้รูปที่เหลือไม่ได้ส่ง
      skipped.push(name + ' (' + err + ')');
      console.log('⚠️ ข้ามรูป ' + name + ': ' + err);
    }
  }

  const externalWebhook = PropertiesService.getScriptProperties().getProperty('Test_BOT_Webhook');
  if (externalWebhook && firstImageKey) {
    // webhook ทำ thread ไม่ได้ → ห้อง external ได้ card ใบเดียว (ข้อจำกัดถาวรของ Lark ไทย)
    sendCardToExternal_(externalWebhook, titleText, firstImageKey);
    console.log('ส่ง card ไป external สำเร็จ');
  }

  console.log('สรุป: ส่ง ' + sent + '/' + files.length + ' รูป เข้า thread ' + rootMessageId
    + (skipped.length ? ' | ข้าม ' + skipped.length + ' ใบ: ' + skipped.join(', ') : ''));
  return { sent: sent, skipped: skipped.length, rootMessageId: rootMessageId, folder: dayName };
}

/**
 * ตัวที่ trigger เรียก (รอบเดียวจบ):
 *   1) ดึงรูป 1-4 จาก branch daily-images มาเซฟในโฟลเดอร์รายวัน
 *   2) วาดรูปรายงานสัปดาห์ (รูปที่ 5) เซฟลงโฟลเดอร์เดียวกัน
 *   3) สร้าง thread แล้วส่งรูปทุกใบในโฟลเดอร์นั้น
 * แต่ละขั้นพังแยกกันได้ — ยังส่งของที่มีอยู่ ไม่ล้มทั้งรอบ
 */
function runDailyLarkPost() {
  try {
    pullActionImagesToDrive_();
  } catch (err) {
    console.log('⚠️ ดึงรูปจาก Action ไม่สำเร็จ: ' + err + ' → ใช้รูปที่มีอยู่ในโฟลเดอร์');
  }
  try {
    saveWeeklyImageToDrive();
  } catch (err) {
    // ถ้ารูปสัปดาห์วาดไม่ได้ ยังควรส่งรูป 1-4 ที่ Action วางไว้ให้ครบ
    console.log('⚠️ เซฟรูปรายงานสัปดาห์ไม่สำเร็จ: ' + err + ' → ส่งเฉพาะรูปที่มีในโฟลเดอร์');
  }
  return sendTodayFolderToLark();
}

/** ตั้ง trigger รอบเดียว จันทร์-เสาร์ ~08:30 (ให้ Action วางรูปเสร็จก่อน) */
function setupDriveThreadTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyLarkPost') ScriptApp.deleteTrigger(t);
  });
  [
    ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.TUESDAY, ScriptApp.WeekDay.WEDNESDAY,
    ScriptApp.WeekDay.THURSDAY, ScriptApp.WeekDay.FRIDAY, ScriptApp.WeekDay.SATURDAY,
  ].forEach(function (day) {
    ScriptApp.newTrigger('runDailyLarkPost')
      .timeBased().onWeekDay(day).atHour(8).nearMinute(30).create();
  });
  Logger.log('ตั้ง trigger runDailyLarkPost จันทร์-เสาร์ ~08:30 เรียบร้อย');
}

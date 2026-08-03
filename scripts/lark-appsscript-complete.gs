// ============================================================================
// POS/Lark automation — Apps Script (ฉบับรวม: เดิม + pattern ใหม่)
// วางทั้งไฟล์นี้ทับลงในโปรเจกต์ Apps Script ได้เลย (paste once)
//
// เปลี่ยนจากเดิม:
//   - sendWeeklyProductionReport() ส่งรายงานสัปดาห์ด้วย pattern ใหม่
//     (thread → เทสโต้ + card → Test BOT) แทน webhook เดิม
//   - dispatchReport() คงเดิม ref:'main' (ตามที่เลือก option C)
//
// Script Properties ที่ต้องตั้ง:
//   LARK_APP_ID, LARK_APP_SECRET, GH_TOKEN          (มีอยู่แล้ว)
//   LARK_CHAT_ID = oc_837485ee2882cf4c9b0f6e8e06c872c3   (เทสโต้ — เพิ่มใหม่)
//   Test_BOT_Webhook = webhook ของ bot "Test POS"        (card ฝั่ง external)
//   WEEKLY_LARK_WEBHOOK_URL = webhook เดิม               (เฉพาะถ้าจะใช้ sendImageToLark_)
//
// GH_TOKEN ต้องมีสิทธิ์ contents:read ด้วย (ไม่ใช่แค่ actions:write)
// เพราะ findPosDailyThreadRoot_() อ่าน latest_thread.json ผ่าน GitHub contents API
// ============================================================================

const OWNER = 'it06qfp';
const REPO = 'POS';
const WORKFLOW = 'pos-daily-report.yml';

// ===== รายงานแผนการรับงานผลิตได้ประจำสัปดาห์ (Google Sheet -> รูปภาพ -> Lark) =====
const WEEKLY_SHEET_ID = '12cIDbt13wPfxqOCkX4l3x6O5wbudoB4KixycF1TgSX0';
const WEEKLY_SHEET_GID = 0;
const WEEKLY_SHEET_RANGE = 'B2:L14';
const WEEKLY_REPORT_TITLE = 'รายงานแผนการรับงานผลิตได้ประจำสัปดาห์ PD';
// webhook เดิม (ส่งรูปตรงเข้าห้อง ไม่ผ่าน thread) — ย้ายไปเก็บใน Script Property
// ชื่อ WEEKLY_LARK_WEBHOOK_URL แล้ว: repo นี้เป็น public repo ห้าม hardcode URL webhook
// เพราะใครก็โพสต์เข้าห้องได้ถ้ารู้ URL (ดู getWeeklyWebhook_())
const WEEKLY_NARROW_COLUMNS = ['วันที่(เริ่ม)', 'วันที่(ท้าย)'];
const WEEKLY_WIDE_COLUMNS = ['พิมพ์ม้วน P1', 'พิมพ์ม้วน P3-4', 'พิมพ์ใบ P2', 'ตัด 1-2-3-4-5', 'วนปาก', 'แพ็ค'];

// ===== pattern ใหม่: thread เทสโต้ + card Test BOT =====
const LARK_CHAT_ID = 'oc_837485ee2882cf4c9b0f6e8e06c872c3';           // เทสโต้ (internal)
// webhook สำหรับ card ฝั่ง external — อ่านจาก Script Property "Test_BOT_Webhook"
// (ตั้งค่าใน Project Settings → Script Properties; ใช้ bot "Test POS" ตัวใหม่ตอนทดสอบ)
const LARK_API_BASE = 'https://open.larksuite.com/open-apis';

/** อ่าน webhook URL จาก Script Property — ตั้งชื่อว่า Test_BOT_Webhook */
function getExternalWebhook_() {
  const url = PropertiesService.getScriptProperties().getProperty('Test_BOT_Webhook');
  if (!url) throw new Error('ยังไม่ได้ตั้ง Script Property ชื่อ Test_BOT_Webhook');
  return url;
}

/** webhook เดิม (ใช้กับ sendImageToLark_ เท่านั้น) — อ่านจาก Script Property */
function getWeeklyWebhook_() {
  const url = PropertiesService.getScriptProperties().getProperty('WEEKLY_LARK_WEBHOOK_URL');
  if (!url) throw new Error('ยังไม่ได้ตั้ง Script Property ชื่อ WEEKLY_LARK_WEBHOOK_URL');
  return url;
}

function sendWeeklyProductionReport() {
  // 0 = Sunday ใน Apps Script/JS Date — ข้ามการส่งถ้าวันนี้เป็นอาทิตย์
  const today = new Date();
  if (Utilities.formatDate(today, 'Asia/Bangkok', 'u') === '7') {
    Logger.log('ข้ามการส่งรายงาน: วันนี้เป็นวันอาทิตย์');
    return;
  }
  const { display, raw } = readWeeklySheetData_();
  const blob = renderWeeklyReportImage_(display, raw);
  sendWeeklyReportToLark_(blob);   // ← เปลี่ยนจาก sendImageToLark_(blob, WEEKLY_LARK_WEBHOOK_URL)
  console.log('ส่งรายงานแผนการรับงานผลิตประจำสัปดาห์เข้า Lark สำเร็จ (thread + card)');
}

/**
 * ส่งรายงานสัปดาห์: reply ต่อใน thread POS Daily ของวันนี้ (รูปที่ 5)
 * ถ้าหา thread ไม่เจอ (GH ยังไม่รัน/ไม่ใช่ workflow ใหม่) → สร้าง thread ใหม่เอง
 */
function sendWeeklyReportToLark_(blob) {
  const token = getLarkTenantToken_();
  const titleText = WEEKLY_REPORT_TITLE + ' — ข้อมูล ณ ' + formatBangkokTimestamp_();
  const imageKey = uploadImageToLark_(blob, token);

  // 1) หา thread POS Daily ของวันนี้ในเทสโต้
  const posRootId = findPosDailyThreadRoot_();
  if (posRootId) {
    replyImageInThread_(token, posRootId, imageKey);
    console.log('reply รูปสัปดาห์ต่อใน thread POS Daily (root=' + posRootId + ') — เป็นรูปที่ 5');
  } else {
    const rootMsgId = createThreadRoot_(token, LARK_CHAT_ID, titleText);
    replyImageInThread_(token, rootMsgId, imageKey);
    console.log('ไม่พบ thread POS Daily → สร้าง thread ใหม่ (root=' + rootMsgId + ')');
  }

  // 2) card ใบเดียว → Test BOT (text + รูปย่อ คลิกดูภาพเต็ม)
  sendCardToExternal_(getExternalWebhook_(), titleText, imageKey);
  console.log('ส่ง card ไป Test BOT สำเร็จ');
}

/**
 * ค้นหา root message ของ thread POS Daily วันนี้ (ข้อความ "POS Daily Report - dd/mm/yyyy")
 * คืน message_id (root) — reply_in_thread=true ใส่ root จะเข้าธีรดเดียวกัน; คืน null ถ้าไม่พบ
 */
function findPosDailyThreadRoot_() {
  const todayLabel = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy');

  // รอ handoff จาก GitHub Actions ได้สูงสุด 3 ครั้ง × 20 วิ = 60 วิ
  // (งานหนัก render+upload จบไปแล้วก่อนถึงจุดนี้ → 60 วิ ยังห่างจากเพดาน 6 นาทีของ GAS)
  for (let attempt = 1; attempt <= 4; attempt++) {
    const thread = readLatestThreadJson_();
    if (thread && thread.root_message_id && thread.date === todayLabel) {
      return thread.root_message_id;
    }
    const why = !thread ? 'อ่าน latest_thread.json ไม่ได้'
      : (thread.date !== todayLabel ? 'ข้อมูลเป็นของวันที่ ' + thread.date + ' (ไม่ใช่ ' + todayLabel + ')'
        : 'ไม่มี root_message_id');
    if (attempt < 4) {
      console.log(why + ' → รออีก 20 วิ แล้วลองใหม่ (ครั้งที่ ' + attempt + '/4)');
      Utilities.sleep(20000);
    } else {
      console.log(why + ' → เลิกรอ ไปสร้าง thread ใหม่');
    }
  }
  return null;
}

/**
 * อ่าน latest_thread.json ที่ GitHub Actions เขียนไว้ (tenant token อ่านประวัติห้องไม่ได้)
 * ใช้ GitHub contents API เป็นหลัก เพราะ raw.githubusercontent.com มี CDN cache สูงสุด ~5 นาที
 * ซึ่งทำให้ได้ค่าของเมื่อวานแล้วไปสร้าง thread ใหม่ทั้งที่ thread วันนี้มีอยู่แล้ว
 * คืน object หรือ null
 */
function readLatestThreadJson_() {
  const token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (token) {
    try {
      const apiUrl = 'https://api.github.com/repos/' + OWNER + '/' + REPO
        + '/contents/latest_thread.json?ref=main';
      const res = UrlFetchApp.fetch(apiUrl, {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github.raw',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() === 200) return JSON.parse(res.getContentText());
      console.log('GitHub contents API ตอบ HTTP ' + res.getResponseCode() + ' → fallback ไป raw');
    } catch (err) {
      console.log('GitHub contents API ล้มเหลว: ' + err + ' → fallback ไป raw');
    }
  }

  // fallback: raw (อาจได้ค่าเก่าจาก CDN cache — ใช้เมื่อ GH_TOKEN ใช้ไม่ได้)
  try {
    const res = UrlFetchApp.fetch('https://raw.githubusercontent.com/' + OWNER + '/' + REPO
      + '/main/latest_thread.json', {
      headers: { 'Cache-Control': 'no-cache' },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.log('raw latest_thread.json ตอบ HTTP ' + res.getResponseCode());
      return null;
    }
    return JSON.parse(res.getContentText());
  } catch (err) {
    console.log('อ่าน raw latest_thread.json ไม่ได้: ' + err);
    return null;
  }
}

/** สร้าง root message (text) ในห้อง แล้วคืน message_id — ใช้เป็นหัวข้อ thread */
function createThreadRoot_(token, chatId, text) {
  const res = UrlFetchApp.fetch(LARK_API_BASE + '/im/v1/messages?receive_id_type=chat_id', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: text }),
    }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.code !== 0) throw new Error('สร้าง thread root ไม่สำเร็จ: ' + res.getContentText());
  return data.data.message_id;
}

/** reply รูปใน thread (reply_in_thread=true) */
function replyImageInThread_(token, parentMessageId, imageKey) {
  const res = UrlFetchApp.fetch(LARK_API_BASE + '/im/v1/messages/' + parentMessageId + '/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      msg_type: 'image',
      content: JSON.stringify({ image_key: imageKey }),
      reply_in_thread: true,
    }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.code !== 0) throw new Error('reply รูปใน thread ไม่สำเร็จ: ' + res.getContentText());
}

/** card ใบเดียว (text + รูปย่อ preview) → external room ผ่าน webhook */
function sendCardToExternal_(webhookUrl, text, imageKey) {
  const card = {
    msg_type: 'interactive',
    card: {
      schema: '2.0',
      header: { title: { tag: 'plain_text', content: '📦 ' + WEEKLY_REPORT_TITLE }, template: 'blue' },
      body: {
        direction: 'vertical',
        elements: [
          { tag: 'markdown', content: text },
          {
            tag: 'column_set',
            flex_mode: 'none',
            background_style: 'default',
            columns: [{
              tag: 'column', width: 'weighted', weight: 1,
              elements: [
                { tag: 'img', img_key: imageKey, mode: 'small', preview: true },
                { tag: 'markdown', content: '**รายงานสัปดาห์**' },
              ],
            }],
          },
        ],
      },
    },
  };
  const res = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(card),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.code !== 0) throw new Error('ส่ง card ไป external ไม่สำเร็จ: ' + res.getContentText());
}

// ============================================================================
// ส่วนเดิม (ไม่แก้) — ตั้งแต่บรรทัดนี้ลงไปเหมือนเดิมทุกประการ
// ============================================================================

function readWeeklySheetData_() {
  const ss = SpreadsheetApp.openById(WEEKLY_SHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === WEEKLY_SHEET_GID) || ss.getSheets()[0];
  const range = sheet.getRange(WEEKLY_SHEET_RANGE);
  let display = range.getDisplayValues();
  let raw = range.getValues();

  // ตัดแถวว่างล้วน หรือแถวหัวข้อรวม (มีค่าแค่ช่องเดียว) ที่อยู่ก่อนแถวหัวตารางจริง ("ปี", "สัปดาห์ที่", ...) ออกไปเรื่อยๆ
  while (display.length > 1) {
    const filledCount = display[0].filter(v => v !== '').length;
    if (filledCount <= 1) {
      display = display.slice(1);
      raw = raw.slice(1);
    } else {
      break;
    }
  }

  // ตัดแถวว่างล้วนที่แซมอยู่ระหว่างแถวหัวตาราง (index 0) กับแถวข้อมูลจริงออกด้วย (เช่น แถวเว้นบรรทัดในชีตต้นฉบับ)
  while (display.length > 1 && display[1].every(v => v === '')) {
    display = [display[0]].concat(display.slice(2));
    raw = [raw[0]].concat(raw.slice(2));
  }

  // ตัดคอลัมน์ "สัปดาห์ที่" ออก (ซ้ำความหมายกับ Week PD)
  const dropIdx = display[0].findIndex(h => h.trim() === 'สัปดาห์ที่');
  if (dropIdx !== -1) {
    display = display.map(row => row.filter((_, i) => i !== dropIdx));
    raw = raw.map(row => row.filter((_, i) => i !== dropIdx));
  }
  return { display, raw };
}

function isZeroCell_(rawValue) {
  return rawValue === 0 || String(rawValue).trim() === '0';
}


// ตัวสระ/วรรณยุกต์ไทยที่เกาะซ้อนบน-ล่างพยัญชนะ (combining) ไม่มีความกว้างแนวนอนของตัวเอง
// ถ้านับเป็น 1.0 หน่วยเท่าตัวอักษรปกติ จะทำให้ประเมิน header ภาษาไทยกว้างเกินจริง
// เทียบกับคอลัมน์ตัวเลข/วันที่ (เช่น "26/07/26 (Sun)") ที่มีแต่ตัวเลข/สัญลักษณ์ล้วน
// ผลคือคอลัมน์ถูกจัดความกว้างผิด ทำให้วันที่ตัดขึ้นบรรทัดใหม่ทั้งที่ header พอดีบรรทัดเดียว
const THAI_COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/; // สระบน-ล่าง + วรรณยุกต์ + ทัณฑฆาต

function estimateTextWidth_(text) {
  const str = String(text || '');
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (THAI_COMBINING.test(ch)) width += 0;                 // สระ/วรรณยุกต์ลอย ไม่กินพื้นที่แนวนอน
    else if (ch >= '0' && ch <= '9') width += 0.62;           // ตัวเลข
    else if (ch === '/') width += 0.35;
    else if (ch === '(' || ch === ')') width += 0.4;
    else if (ch === ' ') width += 0.32;
    else if (ch === '.' || ch === ':' || ch === '-') width += 0.3;
    else if (ch >= 'A' && ch <= 'Z') width += 0.72;           // ตัวพิมพ์ใหญ่ละติน
    else if (ch >= 'a' && ch <= 'z') width += 0.58;           // ตัวพิมพ์เล็กละติน
    else width += 0.65;                                      // พยัญชนะไทย/อักษรอื่นๆ (ตัวเต็ม)
  }
  return width;
}

function computeWeeklyColumnWidths_(display, totalWidth) {
  const numCols = display[0].length;
  const HEADER_FACTOR = 1.05; // ลดจาก 1.15 เพราะตัด combining marks ออกแล้วตัวประมาณแม่นขึ้น
  const headers = [];
  const rawWidths = [];

  for (let c = 0; c < numCols; c++) {
    const header = String(display[0][c] || '').trim();
    headers.push(header);

    let maxW = estimateTextWidth_(header) * HEADER_FACTOR;
    for (let r = 1; r < display.length; r++) {
      const w = estimateTextWidth_(display[r][c]);
      if (w > maxW) maxW = w;
    }
    rawWidths.push(maxW + 2); // เผื่อ buffer กันเบียดขอบเซลล์ (เพิ่มจาก 1.5 เป็น 2 เผื่อ margin ปลอดภัย)
  }

  const wideIndices = headers
    .map((h, i) => i)
    .filter(i => WEEKLY_WIDE_COLUMNS.indexOf(headers[i]) !== -1);
  if (wideIndices.length > 0) {
    const maxWideWidth = Math.max.apply(null, wideIndices.map(i => rawWidths[i])) * 1.4;
    wideIndices.forEach(i => { rawWidths[i] = maxWideWidth; });
  }

  const sum = rawWidths.reduce((a, b) => a + b, 0);
  const widths = rawWidths.map(w => (w / sum) * totalWidth);

  const MIN_WIDTH = 40;
  for (let iter = 0; iter < numCols; iter++) {
    let totalDeficit = 0;
    for (let i = 0; i < numCols; i++) {
      if (widths[i] < MIN_WIDTH) {
        totalDeficit += MIN_WIDTH - widths[i];
        widths[i] = MIN_WIDTH;
      }
    }
    if (totalDeficit === 0) break;
    const flexIndices = [];
    let flexSum = 0;
    for (let i = 0; i < numCols; i++) {
      if (widths[i] > MIN_WIDTH) {
        flexIndices.push(i);
        flexSum += widths[i];
      }
    }
    if (flexSum <= 0) break;
    flexIndices.forEach(i => {
      widths[i] -= (widths[i] / flexSum) * totalDeficit;
    });
  }
  return widths;
}

function testSundaySkip() {
  const testDate = new Date('2026-08-02T10:00:00+07:00'); // อาทิตย์ที่ 2 ส.ค. 2026
  Logger.log(Utilities.formatDate(testDate, 'Asia/Bangkok', 'u')); // ควรได้ '7'
}

//////////////////////////////////////////////////////////////////////////////////////////////////////

function renderWeeklyReportImage_(display, raw) {
  const numRows = display.length;
  const numCols = display[0].length;
  const margin = 10;
  const titleHeight = 24;
  const headerHeight = 32;

  const presResource = Slides.Presentations.create({
    title: 'tmp_weekly_report_' + new Date().getTime(),
  });
  const presentationId = presResource.presentationId;
  try {
    let pres = SlidesApp.openById(presentationId);
    let slide = pres.getSlides()[0];
    const slideId = slide.getObjectId();
    slide.getShapes().forEach(shape => shape.remove());

    const pageWidth = pres.getPageWidth();
    const pageHeight = pres.getPageHeight();
    const tableWidth = pageWidth - margin * 2;
    const numDataRows = numRows - 1;
    const maxAvailableRowHeight = (pageHeight - margin * 2 - titleHeight - headerHeight) / numDataRows;

    // ไม่ cap ที่ 22 แล้ว — ให้ table ยืดเต็มพื้นที่ page พอดีเสมอ (405 - margin*2 - titleHeight)
    // วิธีนี้ไม่มีพื้นที่ขาวเหลือโดย design ไม่ต้องพึ่งการ crop ทีหลังอีก
    const rowHeight = maxAvailableRowHeight;
    const tableHeight = headerHeight + numDataRows * rowHeight;
    const colWidths = computeWeeklyColumnWidths_(display, tableWidth);

    const titleBox = slide.insertTextBox(
      WEEKLY_REPORT_TITLE + ' — ข้อมูล ณ ' + formatBangkokTimestamp_(),
      margin, margin / 2, tableWidth, titleHeight
    );
    titleBox.getText().getTextStyle().setBold(true).setFontSize(12).setForegroundColor('#1E3A5F');

    const table = slide.insertTable(numRows, numCols, margin, margin / 2 + titleHeight, tableWidth, tableHeight);
    const tableId = table.getObjectId();
    pres.saveAndClose();

    const sizeRequests = [];
    for (let c = 0; c < numCols; c++) {
      sizeRequests.push({
        updateTableColumnProperties: {
          objectId: tableId,
          columnIndices: [c],
          tableColumnProperties: { columnWidth: { magnitude: colWidths[c], unit: 'PT' } },
          fields: 'columnWidth',
        },
      });
    }
    for (let r = 0; r < numRows; r++) {
      sizeRequests.push({
        updateTableRowProperties: {
          objectId: tableId,
          rowIndices: [r],
          tableRowProperties: { minRowHeight: { magnitude: r === 0 ? headerHeight : rowHeight, unit: 'PT' } },
          fields: 'minRowHeight',
        },
      });
    }
    Slides.Presentations.batchUpdate({ requests: sizeRequests }, presentationId);

    pres = SlidesApp.openById(presentationId);
    slide = pres.getSlides()[0];
    const table2 = slide.getPageElementById(tableId).asTable();
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const text = display[r][c] === '' ? ' ' : display[r][c];
        table2.getCell(r, c).getText().setText(text);
      }
    }
    pres.saveAndClose();

    pres = SlidesApp.openById(presentationId);
    slide = pres.getSlides()[0];
    const table3 = slide.getPageElementById(tableId).asTable();
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const cell = table3.getCell(r, c);
        const style = cell.getText().getTextStyle().setFontSize(r === 0 ? 8 : 7);
        cell.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
        cell.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
        const isProdCol = WEEKLY_WIDE_COLUMNS.indexOf(String(display[0][c] || '').trim()) !== -1;
        if (r === 0) {
          style.setBold(true).setForegroundColor('#FFFFFF');
          cell.getFill().setSolidFill(isProdCol ? '#0F6960' : '#1E3A5F');
        } else if (isZeroCell_(raw[r][c])) {
          style.setForegroundColor('#555555');
          cell.getFill().setSolidFill('#D9D9D9');
        } else if (isProdCol) {
          style.setBold(true).setForegroundColor('#0F4A44');
          cell.getFill().setSolidFill(r % 2 === 0 ? '#E3F3F1' : '#F2FAF9');
        } else {
          style.setForegroundColor('#222222');
          cell.getFill().setSolidFill(r % 2 === 0 ? '#F7F9FC' : '#FFFFFF');
        }
      }
    }
    pres.saveAndClose();

    const thumb = Slides.Presentations.Pages.getThumbnail(presentationId, slideId, {
      'thumbnailProperties.mimeType': 'PNG',
      'thumbnailProperties.thumbnailSize': 'LARGE',
    });
    const imgResp = UrlFetchApp.fetch(thumb.contentUrl, { muteHttpExceptions: true });
    return imgResp.getBlob().setName('weekly_report.png');
  } finally {
    DriveApp.getFileById(presentationId).setTrashed(true);
  }
}

function formatBangkokTimestamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm') + ' น.';
}

function getLarkTenantToken_() {
  const appId = PropertiesService.getScriptProperties().getProperty('LARK_APP_ID');
  const appSecret = PropertiesService.getScriptProperties().getProperty('LARK_APP_SECRET');
  if (!appId || !appSecret) throw new Error('ยังไม่ได้ตั้ง Script Property LARK_APP_ID / LARK_APP_SECRET');
  const res = UrlFetchApp.fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.code !== 0) throw new Error('ขอ tenant_access_token ไม่สำเร็จ: ' + res.getContentText());
  return data.tenant_access_token;
}

function uploadImageToLark_(blob, token) {
  const res = UrlFetchApp.fetch('https://open.larksuite.com/open-apis/im/v1/images', {
    method: 'post',
    headers: { Authorization: `Bearer ${token}` },
    payload: { image_type: 'message', image: blob },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.code !== 0) throw new Error('อัปโหลดรูปไป Lark ไม่สำเร็จ: ' + res.getContentText());
  return data.data.image_key;
}

// คงไว้เผื่อ fallback (ไม่ถูกเรียกแล้วโดย sendWeeklyProductionReport)
function sendImageToLark_(blob, webhookUrl) {
  const token = getLarkTenantToken_();
  const imageKey = uploadImageToLark_(blob, token);
  const res = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ msg_type: 'image', content: { image_key: imageKey } }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.code !== 0) throw new Error('ส่งรูปเข้า Lark ไม่สำเร็จ: ' + res.getContentText());
}

// ============================================================================
// FLOW ที่ถูกต้อง (ตามที่ตกลงกัน):
//   1. dispatchReport()               → เรียก GitHub Action (สร้าง thread รูป 1-4)
//   2. (รอ GH Action เสร็จ ~5-10 นาที)
//   3. sendWeeklyProductionReport()   → หา thread POS Daily → reply รูปสัปดาห์ (รูปที่ 5)
//
// ห้ามเรียก sendWeeklyProductionReport ทันทีหลัง dispatchReport
// (GH ยังไม่ทันสร้าง thread → จะ fallback สร้าง thread ใหม่ แทนที่จะเป็นรูปที่ 5)
// ใช้ setupWeekdayTriggersForBoth() ซึ่งแยก trigger 07:05 (dispatch) / 08:35 (weekly)
// weekly ยังมี retry รอ handoff อีก 4 ครั้ง × 20 วิ ก่อน fallback
// ============================================================================

// รันด้วย trigger 07:05 — สั่ง GitHub Action POS Daily ก่อน (สร้าง thread รูป 1-4)
function runScheduledTasks() {
  dispatchReport();
}

function dispatchReport() {
  const token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้ง Script Property ชื่อ GH_TOKEN');
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 204) {
    throw new Error(`Dispatch ล้มเหลว ${code}: ${res.getContentText()}`);
  }
  console.log('Dispatch สำเร็จ (204) เวลา ' + new Date());
}

// รันครั้งเดียวเพื่อสร้าง trigger (ลบของเก่าก่อนกันซ้ำ)
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dispatchReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dispatchReport').timeBased().atHour(7).nearMinute(45).everyDays(1).create();   // เล็ง 08:00
  // ScriptApp.newTrigger('dispatchReport').timeBased().atHour(17).nearMinute(45).everyDays(1).create();  // เล็ง 18:00
  // console.log('สร้าง trigger 07:45,17:45 (เล็ง 08:00,18:00)');
  console.log('สร้าง trigger 07:45(เล็ง 08:00)');
}


// (เผื่ออยากดูว่ามี trigger อะไรอยู่บ้าง)
function listTriggers() {
  ScriptApp.getProjectTriggers().forEach(t =>
    console.log(t.getHandlerFunction(), t.getEventType(), t.getUniqueId())
  );
}

function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('ลบ trigger แล้ว ' + triggers.length + ' ตัว');
}


function testToken() {
  const token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  const res = UrlFetchApp.fetch('https://api.github.com/repos/it06qfp/POS', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true,
  });
  console.log(res.getResponseCode(), res.getContentText().slice(0, 200));
}


function setupWeekdayTriggersForBoth() {
  // dispatchReport 07:05 → GH Action สร้าง thread POS Daily (ใช้เวลา ~5-10 นาที)
  // sendWeeklyProductionReport 08:35 → หา thread แล้ว reply รูปสัปดาห์ต่อ (รูปที่ 5)
  //
  // สำคัญ: nearMinute() สุ่มเวลาจริงได้ ±15 นาที ดังนั้นคู่ 07:35/08:05 แบบเดิม
  // อาจยิงชนกัน (07:50 ทั้งคู่) → weekly ไม่เจอ thread แล้วไปสร้าง thread แยก
  // เว้นห่าง 90 นาที (07:05 → 06:50-07:20, 08:35 → 08:20-08:50) การันตีห่างกัน ≥60 นาที
  const schedule = [
    { fn: 'dispatchReport', hour: 7, minute: 5 },
    { fn: 'sendWeeklyProductionReport', hour: 8, minute: 35 },
  ];

  const weekdays = [
    ScriptApp.WeekDay.MONDAY,
    ScriptApp.WeekDay.TUESDAY,
    ScriptApp.WeekDay.WEDNESDAY,
    ScriptApp.WeekDay.THURSDAY,
    ScriptApp.WeekDay.FRIDAY,
    ScriptApp.WeekDay.SATURDAY,
  ];

  schedule.forEach(({ fn, hour, minute }) => {
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === fn) {
        ScriptApp.deleteTrigger(t);
      }
    });

    weekdays.forEach(day => {
      ScriptApp.newTrigger(fn)
        .timeBased()
        .onWeekDay(day)
        .atHour(hour)
        .nearMinute(minute)
        .create();
    });

    Logger.log(fn + ': ตั้ง trigger จันทร์-เสาร์ ตอน ' + hour + ':' + minute + ' เรียบร้อย');
  });

  Logger.log('รวม trigger ในโปรเจกต์ตอนนี้: ' + ScriptApp.getProjectTriggers().length + ' ตัว');
}

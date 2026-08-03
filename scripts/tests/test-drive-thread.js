// Local test harness for lark-drive-thread.gs (โฟลเดอร์รายวัน)
// stub: DriveApp / PropertiesService / LockService / Utilities + helper จากไฟล์ complete
// รัน: node scripts/tests/test-drive-thread.js   (ไม่ต้องมี credential อะไร — stub ทั้งหมด)
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'lark-drive-thread.gs'), 'utf8');

const TODAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date()); // en-CA => yyyy-mm-dd

function mkFile(name, mime, size, created) {
  return {
    getName: () => name,
    getMimeType: () => mime,
    getSize: () => size,
    getDateCreated: () => new Date(created || '2026-08-03T08:00:00Z'),
    getBlob: () => ({ __blob: name }),
    __trashed: false,
    setTrashed: function (v) { this.__trashed = v; },
  };
}

function mkFolder(name, files, created) {
  const folder = {
    __name: name,
    __files: files || [],
    __created: [],
    __subfolders: [],
    getName: () => name,
    getId: () => 'id_' + name,
    getDateCreated: () => new Date(created || '2026-08-03T00:00:00Z'),
    getFiles: function () { let i = 0; const f = this.__files; return { hasNext: () => i < f.length, next: () => f[i++] }; },
    getFilesByName: function (n) {
      const m = this.__files.filter(f => f.getName() === n); let i = 0;
      return { hasNext: () => i < m.length, next: () => m[i++] };
    },
    getFoldersByName: function (n) {
      const m = this.__subfolders.filter(f => f.getName() === n); let i = 0;
      return { hasNext: () => i < m.length, next: () => m[i++] };
    },
    createFolder: function (n) {
      const sub = mkFolder(n, [], '2026-08-03T09:00:00Z');
      this.__subfolders.push(sub);
      this.__created.push(n);
      return sub;
    },
    createFile: function (blob) {
      const f = mkFile(blob.__name || 'new', 'image/png', 123456);
      this.__files.push(f);
      return Object.assign(f, { getSize: () => 123456 });
    },
  };
  return folder;
}

function run({ parent, props, failUploadFor, weeklyThrows, sunday, github }) {
  const calls = { uploads: [], replies: [], roots: [], cards: [], rendered: 0, fetched: [] };
  const logs = [];
  // github = { manifest: <object|null>, images: {name: 'bytes'}, manifestCode, imageCode }
  const gh = github || {};
  const ctx = vm.createContext({
    JSON, Error, Date, String, Number, Object, Array, Math, Intl,
    console: { log: (m) => logs.push(String(m)) },
    Logger: { log: (m) => logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        if (fmt === 'yyyy-MM-dd') {
          return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        }
        if (fmt === 'u') return sunday ? '7' : '1';
        throw new Error('unstubbed format ' + fmt);
      },
    },
    DriveApp: { getFolderById: (id) => { if (id === 'PARENT') return parent; throw new Error('unknown folder ' + id); } },
    UrlFetchApp: {
      fetch: (url) => {
        calls.fetched.push(url);
        const isManifest = url.indexOf('manifest.json') !== -1;
        if (isManifest) {
          const code = gh.manifestCode || (gh.manifest ? 200 : 404);
          const body = gh.manifest === undefined ? '' : (typeof gh.manifest === 'string' ? gh.manifest : JSON.stringify(gh.manifest));
          return {
            getResponseCode: () => code,
            getBlob: () => ({ __name: 'manifest.json', getDataAsString: () => body, setName: function (n) { this.__name = n; return this; } }),
          };
        }
        const name = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
        const data = (gh.images || {})[name];
        return {
          getResponseCode: () => (gh.imageCode || (data ? 200 : 404)),
          getBlob: () => ({ __blob: name, __name: name, setName: function (n) { this.__name = n; return this; } }),
        };
      },
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ onWeekDay: () => ({ atHour: () => ({ nearMinute: () => ({ create: () => {} }) }) }) }) }),
      WeekDay: { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 },
    },
    // ค่า/helper ที่ประกาศไว้ใน lark-appsscript-complete.gs (Apps Script แชร์ global scope)
    OWNER: 'it06qfp',
    REPO: 'POS',
    LARK_CHAT_ID: 'oc_const_from_code_js',
    getLarkTenantToken_: () => 'tok',
    formatBangkokTimestamp_: () => '2026-08-03 16:00 น.',
    createThreadRoot_: (t, chat, text) => { calls.roots.push({ chat, text }); return 'om_root1'; },
    uploadImageToLark_: (blob) => {
      if (failUploadFor && failUploadFor === blob.__blob) throw new Error('upload 400');
      calls.uploads.push(blob.__blob);
      return 'img_' + blob.__blob;
    },
    replyImageInThread_: (t, root, key) => { calls.replies.push({ root, key }); },
    sendCardToExternal_: (url, text, key) => { calls.cards.push({ url, key, text }); },
    readWeeklySheetData_: () => ({ display: [['h']], raw: [['h']] }),
    renderWeeklyReportImage_: () => {
      if (weeklyThrows) throw new Error('Slides API down');
      calls.rendered++;
      return { __blob: 'weekly', setName: function (n) { this.__name = n; return this; } };
    },
  });
  vm.runInContext(src, ctx);
  return { ctx, calls, logs, run: (expr) => vm.runInContext(expr, ctx) };
}

let failed = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '  <-- ' + JSON.stringify(extra)));
  if (!cond) failed++;
};
const PROPS = { LARK_CHAT_ID: 'oc_chat', DRIVE_IMAGES_FOLDER_ID: 'PARENT' };
const png = (n, size) => mkFile(n, 'image/png', size || 200000);

// 1) โฟลเดอร์วันนี้มี 4 รูปจาก Action -> ส่งครบใน thread เดียว เรียงตามชื่อ
{
  const day = mkFolder(TODAY, [png('3_c.png'), png('1_a.png'), png('4_d.png'), png('2_b.png')]);
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(day);
  const t = run({ parent, props: PROPS });
  const res = t.run('sendTodayFolderToLark()');
  check('1 root ครั้งเดียว', t.calls.roots.length === 1, t.calls.roots);
  check('1 ส่ง 4 รูปเรียงตามชื่อ', t.calls.uploads.join(',') === '1_a.png,2_b.png,3_c.png,4_d.png', t.calls.uploads);
  check('1 reply เข้า root เดียวกันหมด', t.calls.replies.every(r => r.root === 'om_root1'), t.calls.replies);
  check('1 ชื่อโฟลเดอร์ในผลลัพธ์ = วันนี้', res.folder === TODAY, res);
  check('1 ไม่สร้างโฟลเดอร์ใหม่ (มีอยู่แล้ว)', parent.__created.length === 0, parent.__created);
}

// 2) ยังไม่มีโฟลเดอร์วันนี้ -> สร้างให้ แต่ไม่มีรูป = ไม่สร้าง thread เปล่า
{
  const parent = mkFolder('Lark - POS - Report');
  const t = run({ parent, props: PROPS });
  const res = t.run('sendTodayFolderToLark()');
  check('2 สร้างโฟลเดอร์วันนี้', parent.__created.join(',') === TODAY, parent.__created);
  check('2 ไม่สร้าง thread เปล่า', t.calls.roots.length === 0 && res.sent === 0, res);
}

// 3) ชื่อโฟลเดอร์ซ้ำ -> เลือกอันที่สร้างก่อนสุด (ให้ตรงกับฝั่ง python)
{
  const older = mkFolder(TODAY, [png('1_a.png')], '2026-08-03T01:00:00Z');
  const newer = mkFolder(TODAY, [png('9_z.png')], '2026-08-03T05:00:00Z');
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(newer, older);
  const t = run({ parent, props: PROPS });
  t.run('sendTodayFolderToLark()');
  check('3 ใช้โฟลเดอร์เก่าสุด', t.calls.uploads.join(',') === '1_a.png', t.calls.uploads);
}

// 4) runDailyLarkPost: เซฟรูปสัปดาห์ลงโฟลเดอร์วันนี้ แล้วส่งรวมเป็น 5 รูป
{
  const day = mkFolder(TODAY, [png('1_a.png'), png('2_b.png'), png('3_c.png'), png('4_d.png')]);
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(day);
  const t = run({ parent, props: PROPS });
  const res = t.run('runDailyLarkPost()');
  check('4 render รูปสัปดาห์ 1 ครั้ง', t.calls.rendered === 1, t.calls.rendered);
  check('4 ส่งครบ 5 รูป', res.sent === 5, res);
  check('4 รูปที่ 5 ชื่อ 5_weekly_<วันที่>',
    t.calls.uploads[4] === '5_weekly_' + TODAY + '.png', t.calls.uploads);
}

// 5) รูปสัปดาห์วาดพัง -> ยังส่งรูป 1-4 ที่ Action วางไว้
{
  const day = mkFolder(TODAY, [png('1_a.png'), png('2_b.png')]);
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(day);
  const t = run({ parent, props: PROPS, weeklyThrows: true });
  const res = t.run('runDailyLarkPost()');
  check('5 render พังแต่ยังส่งของที่มี', res.sent === 2, res);
  check('5 มี log เตือน', t.logs.some(l => l.indexOf('เซฟรูปรายงานสัปดาห์ไม่สำเร็จ') !== -1), t.logs);
}

// 6) วันอาทิตย์ -> ไม่วาดรูปสัปดาห์ แต่ยังส่งรูปที่มี
{
  const day = mkFolder(TODAY, [png('1_a.png')]);
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(day);
  const t = run({ parent, props: PROPS, sunday: true });
  const res = t.run('runDailyLarkPost()');
  check('6 อาทิตย์ไม่ render', t.calls.rendered === 0, t.calls.rendered);
  check('6 ยังส่งรูปที่มี', res.sent === 1, res);
}

// 7) ไฟล์ใหญ่เกิน / mime ไม่ใช่รูป / upload พังบางใบ
{
  const day = mkFolder(TODAY, [
    png('1_a.png'), png('2_big.png', 10 * 1024 * 1024),
    mkFile('3_notes.pdf', 'application/pdf', 1000),
    mkFile('4_b.JPG', 'IMAGE/JPEG', 5000), png('5_bad.png'),
  ]);
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(day);
  const t = run({ parent, props: PROPS, failUploadFor: '5_bad.png' });
  const res = t.run('sendTodayFolderToLark()');
  check('7 ส่งได้ 2 ใบ ข้าม 2 ใบ (pdf ถูกกรองก่อน)', res.sent === 2 && res.skipped === 2, res);
  check('7 ส่ง 1_a + 4_b.JPG', t.calls.uploads.join(',') === '1_a.png,4_b.JPG', t.calls.uploads);
}

// 8) cap 80 ใบ
{
  const many = [];
  for (let i = 1; i <= 85; i++) many.push(png(String(i).padStart(3, '0') + '.png'));
  const day = mkFolder(TODAY, many);
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(day);
  const t = run({ parent, props: PROPS });
  const res = t.run('sendTodayFolderToLark()');
  check('8 cap ที่ 80', res.sent === 80, res.sent);
  check('8 log เตือนว่าตัด', t.logs.some(l => l.indexOf('เกิน MAX_IMAGES') !== -1), true);
}

// 9) card external ใช้รูปแรก เมื่อมี webhook
{
  const day = mkFolder(TODAY, [png('1_a.png'), png('2_b.png')]);
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(day);
  const t = run({ parent, props: { ...PROPS, Test_BOT_Webhook: 'https://hook/x' } });
  t.run('sendTodayFolderToLark()');
  check('9 card 1 ใบ ใช้รูปแรก',
    t.calls.cards.length === 1 && t.calls.cards[0].key === 'img_1_a.png', t.calls.cards);
  check('9 หัวข้อ card มีวันที่โฟลเดอร์',
    t.calls.cards[0].text.indexOf(TODAY) !== -1, t.calls.cards[0].text);
}

// 10) เซฟไฟล์ชื่อเดิมซ้ำ -> ทับ (ไฟล์เก่าถูก trash)
{
  const old = png('5_weekly_' + TODAY + '.png');
  const day = mkFolder(TODAY, [old]);
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(day);
  const t = run({ parent, props: PROPS });
  t.run('saveWeeklyImageToDrive()');
  check('10 ไฟล์เดิมถูก trash ก่อนเขียนใหม่', old.__trashed === true, old.__trashed);
}

// ===== ขา GitHub Action -> Drive (branch daily-images) =====
const MANIFEST_TODAY = { date: TODAY, files: ['1_a.png', '2_b.png', '3_c.png', '4_d.png'] };
const IMGS = { '1_a.png': 'x', '2_b.png': 'x', '3_c.png': 'x', '4_d.png': 'x' };

// 11) manifest เป็นของวันนี้ -> ดึง 4 รูปมาเซฟในโฟลเดอร์รายวัน
{
  const parent = mkFolder('Lark - POS - Report');
  const t = run({ parent, props: PROPS, github: { manifest: MANIFEST_TODAY, images: IMGS } });
  const n = t.run('pullActionImagesToDrive_()');
  check('11 ดึงครบ 4 รูป', n === 4, n);
  check('11 สร้างโฟลเดอร์วันนี้ให้เอง', parent.__created.join(',') === TODAY, parent.__created);
  check('11 ไฟล์ถูกเซฟชื่อเดิม',
    parent.__subfolders[0].__files.map(f => f.getName()).length === 4, parent.__subfolders[0].__files.length);
  check('11 ยิง contents API ผูก branch daily-images',
    t.calls.fetched.every(u => u.indexOf('ref=daily-images') !== -1), t.calls.fetched[0]);
}

// 12) manifest เป็นของเมื่อวาน -> ไม่ดึงเลย (กันโพสต์รูปเก่า)
{
  const parent = mkFolder('Lark - POS - Report');
  const t = run({ parent, props: PROPS, github: { manifest: { date: '2026-08-02', files: ['1_a.png'] }, images: IMGS } });
  const n = t.run('pullActionImagesToDrive_()');
  check('12 manifest เก่า -> ดึง 0 รูป', n === 0, n);
  check('12 มี log บอกว่าเป็นของวันอื่น', t.logs.some(l => l.indexOf('2026-08-02') !== -1), t.logs);
  check('12 ไม่ดึงไฟล์รูปเลย', t.calls.fetched.length === 1, t.calls.fetched);
}

// 13) ไม่มี manifest (Action ยังไม่รัน) -> ดึง 0 ไม่พัง
{
  const parent = mkFolder('Lark - POS - Report');
  const t = run({ parent, props: PROPS, github: {} });
  check('13 ไม่มี manifest -> 0', t.run('pullActionImagesToDrive_()') === 0, 'throw?');
}

// 14) manifest ดีแต่รูปบางใบ 404 -> เซฟที่ได้ ข้ามที่ไม่ได้
{
  const parent = mkFolder('Lark - POS - Report');
  const t = run({ parent, props: PROPS, github: { manifest: MANIFEST_TODAY, images: IMGS, imageCode: 404 } });
  check('14 รูปดึงไม่ได้ -> 0 แต่ไม่พัง', t.run('pullActionImagesToDrive_()') === 0, 'throw?');
  check('14 มี log เตือนต่อไฟล์', t.logs.filter(l => l.indexOf('ข้าม') !== -1).length === 4, t.logs.length);
}

// 15) manifest.json เสีย -> ไม่พัง
{
  const parent = mkFolder('Lark - POS - Report');
  const t = run({ parent, props: PROPS, github: { manifest: 'not json', manifestCode: 200 } });
  check('15 manifest เสีย -> 0', t.run('pullActionImagesToDrive_()') === 0, 'throw?');
}

// 16) runDailyLarkPost ครบวงจร: ดึง 4 + รูปสัปดาห์ = 5 รูปใน thread เดียว
{
  const parent = mkFolder('Lark - POS - Report');
  const t = run({ parent, props: PROPS, github: { manifest: MANIFEST_TODAY, images: IMGS } });
  const res = t.run('runDailyLarkPost()');
  check('16 ส่งครบ 5 รูป (4 จาก Action + 1 สัปดาห์)', res.sent === 5, res);
  check('16 root ครั้งเดียว', t.calls.roots.length === 1, t.calls.roots);
  check('16 ลำดับ 1..4 แล้วปิดท้าย 5_weekly',
    t.calls.uploads.join(',') === '1_a.png,2_b.png,3_c.png,4_d.png,5_weekly_' + TODAY + '.png', t.calls.uploads);
}

// 17) Action ยังไม่รัน (ไม่มี manifest) แต่รูปสัปดาห์ยังต้องส่งได้
{
  const parent = mkFolder('Lark - POS - Report');
  const t = run({ parent, props: PROPS, github: {} });
  const res = t.run('runDailyLarkPost()');
  check('17 ส่งรูปสัปดาห์ใบเดียวได้', res.sent === 1, res);
}

// 18) ไม่ได้ตั้ง Script Property เลย -> ใช้ค่า default (folder id ในโค้ด + const LARK_CHAT_ID)
{
  const day = mkFolder(TODAY, [png('1_a.png')]);
  const parent = mkFolder('Lark - POS - Report'); parent.__subfolders.push(day);
  // props ว่าง = ยังไม่ได้ตั้ง property ใด ๆ ในโปรเจกต์
  const t = run({ parent, props: {}, github: {} });
  // DriveApp stub รับเฉพาะ 'PARENT' -> ต้องเรียกด้วย default id แล้ว throw ให้เห็นว่าอ่าน default จริง
  let err = null;
  try { t.run('sendTodayFolderToLark()'); } catch (e) { err = String(e); }
  check('18 ใช้ default folder id ในโค้ด (ไม่ throw เรื่อง Script Property)',
    err !== null && err.indexOf('1M988dUYfsu9re0PfhFS8SUuP7KRcrlU7') !== -1, err);
  check('18 ไม่ throw ว่าไม่ได้ตั้ง Script Property',
    err !== null && err.indexOf('Script Property') === -1, err);
}

console.log('\nวันที่ที่ใช้ทดสอบ (BKK) = ' + TODAY);
console.log(failed === 0 ? 'ALL TESTS PASSED' : failed + ' TEST(S) FAILED');
process.exit(failed ? 1 : 0);

const OWNER = 'it06qfp';
const REPO = 'POS';
const WORKFLOW = 'pos-daily-report.yml';

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
  ScriptApp.newTrigger('dispatchReport').timeBased().atHour(17).nearMinute(45).everyDays(1).create();  // เล็ง 18:00
  console.log('สร้าง trigger 07:45,17:45 (เล็ง 08:00,18:00)');
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


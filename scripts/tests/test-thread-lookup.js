// Local test harness: stubs the Apps Script runtime and exercises
// findPosDailyThreadRoot_() / readLatestThreadJson_() from lark-appsscript-complete.gs
// รัน: node scripts/tests/test-thread-lookup.js   (ไม่ต้องมี credential อะไร — stub ทั้งหมด)
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'lark-appsscript-complete.gs'), 'utf8');

const TODAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date());

function run({ props, responses }) {
  const calls = [];
  let sleeps = 0;
  const logs = [];
  const ctx = vm.createContext({
    JSON, Error, Intl, Date, String, Number, Object, Array,
    console: { log: (m) => logs.push(String(m)) },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        if (fmt === 'dd/MM/yyyy') {
          return new Intl.DateTimeFormat('en-GB', {
            timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric',
          }).format(d);
        }
        throw new Error('unstubbed format: ' + fmt);
      },
      sleep: () => { sleeps += 1; },   // instant — do not really wait 20s
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props[k] || null }),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        calls.push({ url, opts: opts || {} });
        const kind = url.indexOf('api.github.com') !== -1 ? 'api' : 'raw';
        const r = responses[kind];
        if (typeof r === 'function') return r(calls.length);
        if (r instanceof Error) throw r;
        return { getResponseCode: () => r.code, getContentText: () => r.body };
      },
    },
  });
  vm.runInContext(src, ctx);
  const result = vm.runInContext('findPosDailyThreadRoot_()', ctx);
  return { result, calls, sleeps, logs };
}

const ok = (code, body) => ({ code, body });
const json = (o) => JSON.stringify(o);
const ROOT = 'om_x100b6830fed8a8a4e2eea91c5a97f6e';

let failed = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '  <-- ' + JSON.stringify(extra)));
  if (!cond) failed += 1;
}

// 1) contents API returns today's handoff -> root id, no retry, no raw call
{
  const t = run({
    props: { GH_TOKEN: 'ghp_fake' },
    responses: { api: ok(200, json({ root_message_id: ROOT, date: TODAY })) },
  });
  check('1 API fresh -> returns root id', t.result === ROOT, t.result);
  check('1 no sleep on first hit', t.sleeps === 0, t.sleeps);
  check('1 hits contents API, not raw',
    t.calls.length === 1 && t.calls[0].url.indexOf('api.github.com') !== -1, t.calls.map(c => c.url));
  check('1 sends bearer + raw accept',
    t.calls[0].opts.headers.Authorization === 'Bearer ghp_fake' &&
    t.calls[0].opts.headers.Accept === 'application/vnd.github.raw', t.calls[0].opts.headers);
  check('1 pins ref=main', t.calls[0].url.indexOf('ref=main') !== -1, t.calls[0].url);
}

// 2) stale handoff (yesterday) -> retries 4x then null (no wrong-day reply)
{
  const t = run({
    props: { GH_TOKEN: 'ghp_fake' },
    responses: { api: ok(200, json({ root_message_id: ROOT, date: '01/01/2026' })) },
  });
  check('2 stale date -> null', t.result === null, t.result);
  check('2 retried 4 times', t.calls.length === 4, t.calls.length);
  check('2 slept 3 times (not after last try)', t.sleeps === 3, t.sleeps);
}

// 3) contents API 404 -> falls back to raw, which is fresh
{
  const t = run({
    props: { GH_TOKEN: 'ghp_fake' },
    responses: { api: ok(404, 'Not Found'), raw: ok(200, json({ root_message_id: ROOT, date: TODAY })) },
  });
  check('3 API 404 -> raw fallback returns id', t.result === ROOT, t.result);
  check('3 raw got no-cache header',
    t.calls[1].opts.headers['Cache-Control'] === 'no-cache', t.calls[1].opts.headers);
}

// 4) no GH_TOKEN -> raw only
{
  const t = run({
    props: {},
    responses: { raw: ok(200, json({ root_message_id: ROOT, date: TODAY })) },
  });
  check('4 no token -> raw only', t.result === ROOT && t.calls.length === 1, [t.result, t.calls.length]);
}

// 5) today's date but no root_message_id -> null, no crash
{
  const t = run({
    props: { GH_TOKEN: 'ghp_fake' },
    responses: { api: ok(200, json({ date: TODAY })) },
  });
  check('5 missing root_message_id -> null', t.result === null, t.result);
}

// 6) malformed body / network throw -> null, no exception escapes
{
  const t = run({
    props: { GH_TOKEN: 'ghp_fake' },
    responses: { api: ok(200, 'not json'), raw: new Error('DNS fail') },
  });
  check('6 malformed + throw -> null', t.result === null, t.result);
}

// 7) handoff appears on the 2nd poll (Action commits while weekly is waiting)
{
  const t = run({
    props: { GH_TOKEN: 'ghp_fake' },
    responses: {
      api: (n) => n === 1
        ? { getResponseCode: () => 200, getContentText: () => json({ root_message_id: ROOT, date: '01/01/2026' }) }
        : { getResponseCode: () => 200, getContentText: () => json({ root_message_id: ROOT, date: TODAY }) },
    },
  });
  check('7 late handoff picked up on retry', t.result === ROOT, t.result);
  check('7 only slept once', t.sleeps === 1, t.sleeps);
}

console.log('\nTODAY (BKK) = ' + TODAY);
console.log(failed === 0 ? 'ALL TESTS PASSED' : failed + ' TEST(S) FAILED');
process.exit(failed === 0 ? 0 : 1);

# POS → Lark Pipeline — Handoff Document

สร้าง: 2026-08-03 (Hermes) · ปรับปรุง: 2026-08-03 22:45 (Claude Code) · **ส่งไม้ต่อกลับให้ Hermes**

> เอกสารนี้ย้ายมาอยู่ใน repo แล้ว: `POS-LARK-HANDOFF.md` (root ของ `it06qfp/POS`)
> เดิมอยู่ที่ `C:\Users\IT05\Desktop\WorkSpace\POS_Report\` — ไฟล์นั้นถูกย้ายออกไปแล้ว ไม่มีสำเนาค้าง
> อยู่ใน branch `fix/weekly-image-5` (ยังไม่ push) → หลัง merge จะเป็นเอกสารกลางที่ทุกคนเห็นพร้อมโค้ด

---

## 0. ไม้ต่อสำหรับ Hermes — อ่านตรงนี้ก่อน

### สถานะ ณ 2026-08-03 22:40
| หัวข้อ | สถานะ |
|---|---|
| สถาปัตยกรรม | เปลี่ยนเป็น **Drive โฟลเดอร์รายวัน → thread เดียว** (เลิก handoff 2 รอบ / เลิกใช้ `latest_thread.json`) — ดูข้อ 1 |
| Apps Script โปรเจกต์ `Github Trigger (POS)` | ✅ **วางโค้ดใหม่แล้วผ่าน clasp** — `Code.js` (เวอร์ชันแก้บั๊ก) + `LarkDriveThread.js` (ไฟล์ใหม่) ยืนยันด้วย `clasp pull` แล้ว ไทยไม่เพี้ยน |
| รัน live ในโปรเจกต์จริง | ✅ `previewDriveImages()` + `runDailyLarkPost()` ผ่าน → thread `omt_19153c45c70f1982` (root + 2 รูป) + card external |
| โฟลเดอร์ Drive | `1M988dUYfsu9re0PfhFS8SUuP7KRcrlU7` (My Drive ของ `it03qfp@gmail.com`) · โฟลเดอร์วันนี้ `2026-08-03` = `1K9XnX7X8BSien1KXUwUDYMTMhZ5A5h3x` |
| git remote | `origin/main` = `5f107a4` (ผู้ใช้ push เอง) · `origin/fix/weekly-image-5` = `396ec70` (เก่า) |
| git local | branch **`fix/weekly-image-5`** = **`3630239`** (งานใหม่ทั้งหมด 8 ไฟล์ 641 บรรทัด) — **ยังไม่ push** |
| Trigger | ❌ ยังไม่ตั้ง (ต้องรัน `setupDriveThreadTrigger()`) |
| branch `daily-images` | ❌ ยังไม่มี (จะเกิดเมื่อ push แล้ว Action รันรอบแรก) |
| webhook 2 ตัวที่หลุด | ⚠️ ลบจากไฟล์แล้ว แต่ยังอยู่ใน history `396ec70` → **ต้อง revoke ใน Lark** (ยังไม่ทำ) |

### งานที่เหลือ เรียงตามลำดับ
1. **push branch** (Claude Code ทำไม่ได้ — ไม่มี credential, MCP GitHub เป็น read-only ตอบ 403):
   ```powershell
   git -C C:\Users\IT05\Desktop\WorkSpace\repos\POS push origin fix/weekly-image-5
   ```
   (fast-forward ได้ เพราะ `396ec70` เป็น ancestor ของ `3630239`) แล้วเปิด PR → merge เข้า main
2. **สั่ง Action ให้รัน 1 รอบ** (workflow_dispatch) → ตรวจว่า branch `daily-images` เกิดขึ้น มี `manifest.json` + 4 PNG
3. **รัน `runDailyLarkPost()` อีกครั้ง** ในโปรเจกต์ Apps Script → ต้องได้ **5 รูปใน thread เดียว** (1–4 จาก Action + `5_weekly_<วันที่>.png`)
4. **รัน `setupDriveThreadTrigger()`** ครั้งเดียว → trigger จันทร์–เสาร์ ~08:30
5. **ลบของเก่าที่ไม่ใช้แล้ว**: trigger `dispatchReport` / `sendWeeklyProductionReport` เดิม (ถ้ามี) ด้วย `listTriggers()` แล้วลบทีละตัว — ไม่งั้นจะมีทั้งแบบเก่าและใหม่ยิงพร้อมกัน
6. **revoke webhook** `hook/10a1ad78-…` (ห้องจริง) + `hook/061e50e0-…` (ห้องเทส) ใน Lark แล้วออก URL ใหม่ → ใส่ Script Property `WEEKLY_LARK_WEBHOOK_URL`
7. **ลบไฟล์ทดสอบ** `1_drive_lark_test.png` ในโฟลเดอร์ `2026-08-03` และข้อความเทสในห้องเทสโต้ (`om_x100b68315a5e58a4e15bd029c85a233`, thread `omt_1915da3936cf5987`, `omt_19153c45c70f1982`)

### ของที่เก็บไว้ให้ (ย้ายออกจาก temp แล้ว ไม่หายตอนปิด session)
| ของ | ที่อยู่ | ใช้ทำอะไร |
|---|---|---|
| test harness ฝั่ง GAS | `scripts/tests/test-drive-thread.js` (43 assertion) · `scripts/tests/test-thread-lookup.js` (15 assertion) | `node scripts/tests/test-drive-thread.js` — stub DriveApp/Lark/GitHub ครบ ไม่ต้องมี credential |
| backup โค้ด Apps Script ก่อนแก้ | `C:\Users\IT05\AppData\Local\hermes\scripts\gas-backup-20260803\Code.js` (47.5KB) + `appsscript.json` | กู้คืนด้วย `clasp push` จากโฟลเดอร์นั้น (**ห้าม commit** — มี webhook hardcode) |
| สคริปต์ตรวจ Lark ด้วย tenant token | `hermes\scripts\verify_thread_5.py` (นับรูปใน thread) · `check_thread.py` · `send_test_thread.py` · `send_from_drive.py` | ตรวจว่า thread มีกี่รูปจริง / ยิงรูปทดสอบ (อ่าน `LARK_APP_ID/SECRET` จาก `hermes\.env`) |
| สคริปต์ตรวจสิทธิ์ Drive (ถ้าวันหลังใช้ SA) | `scripts/drive_check.py` ใน repo | เช็ค auth/driveId/canAddChildren/อัป-ลบไฟล์ทดสอบ |

### กับดักที่เสียเวลาไปแล้ว — อย่าเดินซ้ำ
- **PowerShell 5.1 `Get-Content -Raw` อ่านไฟล์ UTF-8 (ไม่มี BOM) เป็น ANSI** → เขียนกลับแล้วข้อความไทยเพี้ยนทั้งไฟล์ (เกิดกับ `lark-drive-thread.gs` แล้วครั้งหนึ่ง กู้จากสำเนาใน `hermes\scripts\`) → แก้ไฟล์ที่มีภาษาไทยด้วย editor/tool ที่รู้ encoding เท่านั้น ห้าม round-trip ผ่าน PowerShell
- **`Out-File -Encoding utf8` ใส่ BOM** → `clasp push` ตอบ `Invalid manifest file` ถ้าเขียน `appsscript.json` แบบนั้น (ใช้ `[IO.File]::WriteAllText` + `UTF8Encoding($false)`)
- **`clasp run` ใช้ไม่ได้** ต้องผูกโปรเจกต์กับ GCP project มาตรฐาน + เปิด Apps Script API + login clasp ด้วย OAuth client ของ project นั้น (ลองแล้วได้ `Unable to run script function` แม้ deploy เป็น API executable) → รันฟังก์ชันต้องกดในหน้าเว็บ
- **`clasp push` ใช้ได้ปกติ** (login ค้างไว้แล้ว) — วิธี push ซ้ำ: สร้างโฟลเดอร์ว่าง ใส่ `.clasp.json`
  (`{"scriptId":"1xqFueDXrL6AE4Jqcrb77fF6HNq7wx2kzo-zx3iTq5VstjdpHSt61eDsF","rootDir":"."}`) + `appsscript.json`
  + `Code.js` (= `scripts/lark-appsscript-complete.gs`) + `LarkDriveThread.js` (= `scripts/lark-drive-thread.gs`) แล้ว `clasp push --force`
- **credential GitHub ในเครื่องหมดอายุทั้งหมด**: `$env:GITHUB_PERSONAL_ACCESS_TOKEN` 401, ไม่มี `.git-credentials`, ไม่มี `gh` CLI, MCP `claude.ai GitHub` = read-only (403 ตอน write), MCP `github-team` = bad credentials
- **clone เป็น shallow (`--depth 20`)** → `origin/fix/weekly-image-5` ยัง fetch ไม่ครบ ถ้า push แล้วมีปัญหาให้ `git fetch --unshallow` ก่อน
- Lark: `LARK_CHAT_ID` ในโปรเจกต์เก็บเป็น **const ใน Code.js** ไม่ใช่ Script Property (โค้ดใหม่รองรับทั้งสองทางแล้ว)

---

## 1. สถาปัตยกรรมใหม่ (Drive → Lark รอบเดียว) — เขียนโค้ดแล้ว รอตอบ 1 คำถาม

```
[GitHub Action]  Coda → Pillow → 4 PNG → images/ + manifest.json
        └─ force-push เป็น branch daily-images (คอมมิตเดียว ไม่เก็บ history → repo ไม่บวม)
                       │  ไม่ต้องมี credential Google ใน Actions เลย
                       ▼
[Google Drive] โฟลเดอร์ "Lark - POS - Report"  (1M988dUYfsu9re0PfhFS8SUuP7KRcrlU7)
        │  ← Apps Script ดึงรูปจาก branch มาเซฟ (เป็นเจ้าของโฟลเดอร์เอง)
        ▼
[Apps Script] runDailyLarkPost()  รอบเดียว จันทร์-เสาร์ ~08:30
        ├─ pullActionImagesToDrive_() ดึง 1_..4_ จาก branch daily-images → โฟลเดอร์รายวัน
        ├─ saveWeeklyImageToDrive() วาดรูปสัปดาห์ → 5_weekly_<วันที่>.png ในโฟลเดอร์เดียวกัน
        ├─ ไล่ไฟล์รูปในโฟลเดอร์ (เรียงตามชื่อ)
        ├─ createThreadRoot_() → สร้าง root ใน run เดียวกัน
        ├─ reply ทุกรูปเข้า thread นั้น (ไม่ต้องหา thread เก่า ไม่ต้องอ่าน latest_thread.json)
        ├─ (optional) ย้ายไฟล์ที่ส่งแล้วไป archive folder → รันซ้ำไม่ส่งซ้ำ
        └─ (optional) card 1 ใบ → external webhook
```

**ได้อะไร**: ไม่ต้องนัดเวลา 2 trigger, ไม่ต้องพึ่ง `latest_thread.json`, ไม่โดน CDN cache,
ไม่ต้อง retry รอ handoff, ไม่มีปัญหา "รูปที่ 5 ไปตั้ง thread ใหม่" → บั๊ก #2 และ #3 หมดไปโดยดีไซน์

ไฟล์: `scripts/lark-drive-thread.gs` (repo clone + `hermes\scripts\`) — ใช้ helper ร่วมกับ
`lark-appsscript-complete.gs` (Apps Script แชร์ global scope) จึงต้องมีทั้งสองไฟล์ในโปรเจกต์

| Script Property | จำเป็น | ค่า |
|---|---|---|
| `DRIVE_IMAGES_FOLDER_ID` | ✅ | `1M988dUYfsu9re0PfhFS8SUuP7KRcrlU7` |
| `LARK_CHAT_ID` | ✅ | `oc_837485ee2882cf4c9b0f6e8e06c872c3` |
| `LARK_APP_ID` / `LARK_APP_SECRET` | ✅ | มีอยู่แล้ว |
| `DRIVE_ARCHIVE_FOLDER_ID` | – | ตั้งเมื่ออยากให้ย้ายไฟล์ที่ส่งแล้วออก (กันส่งซ้ำ) |
| `Test_BOT_Webhook` | – | ตั้งเมื่ออยากได้ card ฝั่ง external |

ฟังก์ชัน: `previewDriveImages()` ดูก่อนส่ง (ไม่ส่ง) · `sendDriveImagesAsThread()` ส่งจริง ·
`setupDriveThreadTrigger()` ตั้ง trigger จันทร์-เสาร์ ~08:00

**งบเวลา (scale math)**: ~3 RPC/รูป (Drive getBlob + upload + reply) ≈ 1.0-1.5 วิ/รูป
→ 20 รูป ≈ 30 วิ · 80 รูป (cap) ≈ 120 วิ เทียบเพดาน GAS 360 วิ · ไฟล์ >9MB ถูกข้าม (Lark จำกัด 10MB)

**ผลเทสในเครื่อง**: 17 assertion ผ่านหมด (`…\scratchpad\test-drive-thread.js`, stub DriveApp/Lark)
— เรียงตามชื่อ / โฟลเดอร์ว่างไม่สร้าง thread เปล่า / ข้ามไฟล์ใหญ่ / กรอง mime ที่ไม่ใช่รูป /
archive ย้ายเฉพาะที่ส่งสำเร็จ / cap 80 ใบ / upload พังบางใบแล้ว loop ไม่ตาย / card ใช้รูปแรก

### 1.1 ใครวางรูป (สรุปตามที่ตกลง 2026-08-03)
- **GitHub Action** (Coda → Pillow) อัป 4 รูปเข้าโฟลเดอร์รายวัน ตั้งชื่อ `1_… , 2_… , 3_… , 4_…`
- **Apps Script** วาดรูปรายงานสัปดาห์แล้วเซฟเป็น `5_weekly_<วันที่>.png` ในโฟลเดอร์เดียวกัน แล้วส่ง thread
- เก็บย้อนหลังเป็นรายวันในตัว (ไม่ต้องมี archive folder แยก ไม่ต้องลบไฟล์)
- ทั้งสองฝั่งใช้ชื่อโฟลเดอร์ `yyyy-MM-dd` เวลาไทย และถ้าชื่อซ้ำจะเลือก **อันที่สร้างก่อนสุด** เหมือนกัน
  → สร้างชนกันก็ยังลงเอยโฟลเดอร์เดียวกัน (ตรวจแล้วทั้ง GAS `2026-08-03` และ python `2026-08-03`)

### 1.2 Preflight (แนวทางที่ใช้ — ไม่ต้องมี credential Google เพิ่ม)
| # | สิ่งที่ต้องทำ | ที่ไหน | สถานะ |
|---|---|---|---|
| 1 | push โค้ดขึ้น main (มี workflow step push branch `daily-images`) | GitHub | ❌ รอ credential push |
| 2 | Script Property `DRIVE_IMAGES_FOLDER_ID` = `1M988dUYfsu9re0PfhFS8SUuP7KRcrlU7` | Apps Script | ❌ ยังไม่ตั้ง |
| 3 | วาง `lark-appsscript-complete.gs` + `lark-drive-thread.gs` ในโปรเจกต์เดียวกัน | Apps Script | ❌ ยังไม่วาง |
| 4 | `runDailyLarkPost()` รันมือ 1 ครั้งเพื่อดูผล แล้ว `setupDriveThreadTrigger()` | Apps Script | ❌ |
| – | GH secrets ใด ๆ เพิ่ม / service account / Shared Drive | — | **ไม่ต้องใช้** |

`GH_TOKEN` ใน Script Properties เป็นแค่ optional (ใช้เพื่อ rate limit ที่สูงกว่า) เพราะ repo เป็น public
Apps Script อ่าน branch `daily-images` ผ่าน contents API ได้โดยไม่ต้องมี token

### 1.2.1 (ทางเลือกสำรอง) ถ้าวันหลังอยากให้ Action อัป Drive ตรงด้วย service account
| # | สิ่งที่ต้องมี | ทำที่ไหน | สถานะ |
|---|---|---|---|
| 1 | GH secret `GDRIVE_PARENT_FOLDER_ID` (ใช้เมื่อเลือกทาง SA/OAuth — ดูข้อถัดไป) | repo → Settings → Secrets | ❌ ยังไม่มี |
| 2 | credential ให้ Action เขียน Drive ได้ → GH secret `GDRIVE_SERVICE_ACCOUNT_JSON` | Google Cloud → Service account → JSON key | ❌ ยังไม่มี |
| 3 | แชร์โฟลเดอร์ให้ credential นั้น (Editor/Content manager) | Drive → Share | ❌ ยังไม่ทำ |
| 4 | Script Property `DRIVE_IMAGES_FOLDER_ID` ในโปรเจกต์ Apps Script | Apps Script → Project Settings | ❌ ยังไม่ทำ |
| 5 | บัญชีที่รัน Apps Script ต้องเข้าโฟลเดอร์นี้ได้ (เช็คด้วย `previewDriveImages()`) | Apps Script | ❓ ยังไม่ยืนยัน |

### ทางที่เลือก: Shared Drive จริง + service account (ตัดสิน 2026-08-03)

**โฟลเดอร์ที่ใช้ (เปลี่ยนเป็นตัวใหม่ 2026-08-03 16:10)**: `1M988dUYfsu9re0PfhFS8SUuP7KRcrlU7`

| สิ่งที่ตรวจ | ค่า | แปลว่า |
|---|---|---|
| `parentId` ของโฟลเดอร์ใหม่ | `0AJUUt3lWJ6XsUk9PVA` | **root ของ My Drive ของ `it03qfp@gmail.com`** (root เดียวกับที่เก็บโปรเจกต์ Apps Script "Github Trigger (POS)") |
| owner / permissions | `it03qfp@gmail.com` เท่านั้น | ฝั่ง Apps Script **ดีที่สุดแล้ว** — เป็นเจ้าของเอง ไม่ต้องแชร์ ไม่ต้องพึ่งสิทธิ์ใคร |
| ทดสอบเขียนจริง | สร้าง `2026-08-03` (`1K9XnX7X8BSien1KXUwUDYMTMhZ5A5h3x`) + อัปรูปเข้าไปได้ | ✅ ผ่าน |
| เป็น Shared Drive? | **ไม่ใช่** | Shared Drive จะมี `parentId` เป็น driveId ของไดรฟ์นั้น ไม่ใช่ root ของ user · และบัญชี gmail สร้าง Shared Drive ไม่ได้ (ต้อง Workspace) |

⇒ ขา **service account ยังอัปไม่ได้** (`storageQuotaExceeded`: SA ไม่มี quota และไฟล์ที่ SA สร้างต้องมี SA เป็นเจ้าของ)
ทางที่เหลือสำหรับขา Action:
1. **(แนะนำ) Action ไม่แตะ Drive**: Action push 4 PNG ขึ้น branch แยก → Apps Script (เจ้าของโฟลเดอร์อยู่แล้ว) ดึงมาเซฟลงโฟลเดอร์รายวันเอง — ไม่ต้องมี credential ใหม่ ไม่ต้องแตะ Google Cloud
2. **OAuth refresh token ของ `it03qfp@gmail.com`** ให้ Action ใช้ — อัปเข้า My Drive เดิมได้ แต่ต้องเก็บ token เป็น secret
3. **สร้าง Shared Drive ด้วยบัญชี `@qfp.co.th`** แล้วแชร์ให้บัญชี gmail + ใช้ SA — `drive_upload.py`/`drive_check.py` รองรับไว้แล้ว (checklist ด้านล่าง)

**Checklist ที่ต้องทำในหน้าเว็บ (Claude ทำแทนไม่ได้ — ไม่มี API สร้าง Shared Drive / service account)**
1. Drive → ซ้ายมือ **Shared drives → New** → ตั้งชื่อ เช่น `QFP-IT-Automation` (ต้องใช้บัญชี `@qfp.co.th`; บัญชี gmail สร้างไม่ได้)
2. สร้างโฟลเดอร์ `Lark - POS - Report` **ข้างใน Shared Drive นั้น** → จด **folder id ใหม่** จาก URL
   (ทางเลือก: ลากโฟลเดอร์เดิมเข้าไป — id เดิมคงอยู่ แต่ย้ายของที่ owner เป็น gmail เข้ามาอาจถูกบล็อกโดยนโยบาย Workspace ⇒ สร้างใหม่ง่ายกว่า)
3. Google Cloud Console → เลือก/สร้าง project → **Enable Drive API** → IAM → Service accounts → Create
   → Keys → **Add key → JSON** → ได้ไฟล์ `sa.json` (เก็บเป็นความลับ ห้าม commit)
4. Shared Drive → Manage members → เพิ่มอีเมล service account (`…iam.gserviceaccount.com`) เป็น **Content manager**
5. เพิ่มสมาชิกที่เป็นบัญชีซึ่งรัน Apps Script ด้วย (Content manager) — ไม่งั้น `previewDriveImages()` จะ error
6. GitHub → repo `it06qfp/POS` → Settings → Secrets → เพิ่ม
   - `GDRIVE_SERVICE_ACCOUNT_JSON` = เนื้อไฟล์ `sa.json` ทั้งก้อน
   - `GDRIVE_PARENT_FOLDER_ID` = folder id จากข้อ 2
7. Apps Script → Project Settings → Script Properties → `DRIVE_IMAGES_FOLDER_ID` = folder id เดียวกัน

**ยืนยันก่อนเปิดใช้** (เขียนสคริปต์ไว้แล้ว — `scripts/drive_check.py`):
```powershell
$env:GDRIVE_SERVICE_ACCOUNT_JSON = Get-Content sa.json -Raw
$env:GDRIVE_PARENT_FOLDER_ID = "<folder id>"
python scripts/drive_check.py
```
เช็ค 5 อย่าง: auth ได้ / เห็นโฟลเดอร์แม่ / **มี `driveId` = อยู่ใน Shared Drive จริง** /
SA มี `canAddChildren` / อัปไฟล์ทดสอบได้แล้วลบออกให้เอง — ผ่านหมดแล้วค่อยใส่ secrets จริง
ฝั่ง Apps Script ยืนยันด้วย `previewDriveImages()` (log ชื่อโฟลเดอร์ + รายการไฟล์ = สิทธิ์ผ่าน)

ระหว่างที่ยังไม่ตั้ง secrets: `coda_lark_report.py` จะ **ส่งเข้า Lark ตรงแบบเดิมอัตโนมัติ** (ตรวจแล้ว
`upload_images()` คืน `[]` แล้วโค้ดไหลไปทางเดิม) → ไม่มีช่วงที่รายงานหาย

### 1.3 ไฟล์ที่เพิ่ม/แก้ในรอบนี้ (ยังไม่ push)
| ไฟล์ | สิ่งที่ทำ |
|---|---|
| `scripts/lark-drive-thread.gs` (ใหม่) | โฟลเดอร์รายวัน + เซฟรูปสัปดาห์ + ส่งทั้งโฟลเดอร์เป็น thread เดียว |
| `scripts/drive_upload.py` (ใหม่) | ฝั่ง Action: หา/สร้างโฟลเดอร์รายวัน + อัปรูป (ทับชื่อซ้ำ, supportsAllDrives) |
| `scripts/coda_lark_report.py` | เพิ่ม `upload_reports_to_drive()` + สลับโหมดใน `main()` มี fallback ส่งตรงถ้า Drive พัง |
| `.github/workflows/pos-daily-report.yml` | ส่ง `GDRIVE_*` secrets เข้า job |
| `requirements.txt` | + `google-api-python-client`, `google-auth` |

ฟังก์ชันฝั่ง GAS: `previewDriveImages()` (ดูก่อน ไม่ส่ง) · `saveWeeklyImageToDrive()` ·
`sendTodayFolderToLark()` · `runDailyLarkPost()` (ตัวที่ trigger เรียก = เซฟ+ส่ง) · `setupDriveThreadTrigger()` (จ-ส ~08:30)

**ผลเทส (2026-08-03)**: 22 assertion ผ่านหมด (`…\scratchpad\test-drive-thread.js`) — โฟลเดอร์วันนี้มีรูป 4 ใบส่งครบเรียงตามชื่อ /
ยังไม่มีโฟลเดอร์ → สร้างให้แต่ไม่สร้าง thread เปล่า / ชื่อโฟลเดอร์ซ้ำเลือกอันเก่าสุด / `runDailyLarkPost` ได้ 5 รูปและรูปที่ 5 ชื่อถูก /
render สัปดาห์พังแต่ยังส่งรูป 1-4 / วันอาทิตย์ไม่ render / ข้ามไฟล์ >9MB + กรอง non-image + upload พังบางใบไม่ล้ม /
cap 80 ใบ / card external ใช้รูปแรก / เซฟไฟล์ชื่อซ้ำทับตัวเก่า
`node --check` + `ast.parse` ผ่านทุกไฟล์ · ฝั่ง python ไม่มี config → คืน `[]` และข้ามเงียบ (ตรวจแล้ว)

## 2. สถาปัตยกรรมเดิม (handoff 2 รอบ — ยังใช้อยู่จนกว่าจะสลับ)

```
[Apps Script] จันทร์-เสาร์
  ├─ 07:05 dispatchReport() → workflow_dispatch "POS Daily Lark Report"
  │     └─ Coda (POS-Daily) → วาด 4 รูป (Pillow) → THREAD เทสโต้ (root + 4 รูป)
  │           └─ commit latest_thread.json (root_message_id) กลับ repo main
  │     └─ card ใบเดียว → Test BOT (webhook, รูปเล็ก 4 ใบ + caption ไทย)
  │
  └─ 08:35 sendWeeklyProductionReport() → Google Sheet → วาดรูป (Slides API)
        ├─ อ่าน latest_thread.json ผ่าน GitHub contents API (retry 4×20 วิ)
        ├─ reply รูปสัปดาห์ = รูปที่ 5 ใน thread เดียวกัน
        └─ ส่ง card ไป webhook (Script Property: Test_BOT_Webhook)

[GitHub Action] workflow_dispatch เท่านั้น — ไม่มี cron แล้ว (Apps Script เป็นตัวสั่งงานเดียว)
```

## 2. Repo & Branches

- Repo: `https://github.com/it06qfp/POS` (**public** — ห้าม hardcode secret/webhook ในไฟล์)
- clone ในเครื่อง: `C:\Users\IT05\Desktop\WorkSpace\repos\POS`
- main:
  - `2e65454` chore: update latest Lark thread ← Action เขียนเอง (ยืนยันว่า pipeline วิ่งจริง)
  - `423b8c0` fix: hand off POS Daily Lark thread to weekly image (#5) — PR #1
  - `e1d3204` Merge feature/lark-report-external (external card + schedule + captions)
- สคริปต์หลัก: `scripts/coda_lark_report.py` (43KB — Coda fetch + Pillow render + Lark send)

## 3. ไฟล์สำคัญ

| ไฟล์ | ที่อยู่ | หน้าที่ |
|---|---|---|
| `scripts/coda_lark_report.py` | repo POS | ดึง Coda → วาด 4 รูป → thread เทสโต้ + card Test BOT + เขียน latest_thread.json |
| `.github/workflows/pos-daily-report.yml` | repo POS | workflow_dispatch + TEST secrets + commit latest_thread.json |
| `.github/workflows/pos-daily-report-test.yml` | repo POS | เวอร์ชันทดสอบ (dispatch เท่านั้น) |
| `latest_thread.json` | repo POS (root) | handoff: `root_message_id` + `date` (dd/MM/yyyy BKK) |
| `lark-appsscript-complete.gs` | repo `scripts/` + เครื่อง `C:\Users\IT05\AppData\Local\hermes\scripts\` | Apps Script ฉบับรวม — **สองที่ sync ตรงกันแล้ว** |
| `lark-push-images.py` | เครื่อง (hermes\scripts) | สคริปต์ส่งกลาง (tenant token, ไม่ต้อง UAT) — ทดสอบแล้ว |
| `lark-uat-send.py` | เครื่อง | ส่ง thread ผ่าน UAT (internal เท่านั้น) |
| `lark-webhook-card.py` / `lark-webhook-post.py` | เครื่อง | webhook card/post (ต้นแบบ) |

## 4. Secrets (GitHub repo → Settings → Secrets)

| Secret | ค่า/ที่มา | หมายเหตุ |
|---|---|---|
| `CODA_API_TOKEN` | coda.io → API tokens | ไม่มีตัว TEST |
| `APP_ID_TEST` | cli_a96f6fcdb6f81ed0 | Lark app id (ชุดทดสอบ) |
| `APP_SECRET_TEST` | `~/.hermes/lark-app-secret.txt` | Lark app secret |
| `LARK_CHAT_ID_TEST` | oc_837485ee2882cf4c9b0f6e8e06c872c3 | ห้องเทสโต้ (internal) |
| `LARK_WEBHOOK_URL_TEST` | webhook Test BOT (aefae033-...) | external delivery |
| `LARK_ALERT_WEBHOOK_URL` | webhook alert | error แจ้งเตือน (optional) |

## 5. บั๊กที่แก้แล้วในรอบนี้ (แก้ในเครื่อง — ยังไม่ push)

| # | ปัญหา | ผลถ้าไม่แก้ | สิ่งที่แก้ |
|---|---|---|---|
| 1 | workflow มี `cron: 0 1 * * *` (08:00) **และ** Apps Script dispatch 07:35 | รายงานซ้ำ 2 ชุด/วัน จันทร์-เสาร์ + มีรายงานวันอาทิตย์ที่ไม่ต้องการ | ตัด `schedule:` ออก เหลือ `workflow_dispatch` + เพิ่ม `concurrency` กันรันซ้อน |
| 2 | `nearMinute()` สุ่มเวลา ±15 นาที → 07:35 กับ 08:05 ยิงชนกันได้ | weekly หา thread ไม่เจอ → สร้าง thread แยก (รูปสัปดาห์ไม่ต่อเป็นรูปที่ 5) | เว้นเป็น 07:05 / 08:35 (ห่างกัน ≥60 นาทีทุกกรณี) + retry รอ handoff 4×20 วิ |
| 3 | อ่าน `latest_thread.json` ผ่าน `raw.githubusercontent.com` (CDN cache ~5 นาที) | อ่านได้ค่าของเมื่อวาน → สร้าง thread แยกทั้งที่ thread วันนี้มีอยู่ | อ่านผ่าน GitHub contents API + `GH_TOKEN` (ไม่ผ่าน cache), fallback เป็น raw |
| 4 | webhook URL ห้องจริง hardcode อยู่ในไฟล์ `.gs` ที่อยู่ใน **public repo** | ใครก็โพสต์เข้าห้องนั้นได้ถ้าเห็น URL | ย้ายไป Script Property `WEEKLY_LARK_WEBHOOK_URL` (`getWeeklyWebhook_()`) |

เพิ่มเติม: `git push` ในขั้นตอน commit handoff มี fallback `pull --rebase --autostash` แล้ว (กันพลาดตอน main ขยับ)

### หลักฐานจากห้องจริงว่าบั๊กเกิดขึ้นแล้ว (อ่านห้องเทสโต้ 03/08/2026)
- มี root `POS Daily Report - 03/08/2026` **4 อัน** ในวันเดียว (thread `omt_1915c3c8744f5982`, `omt_1915cdc2a8d519be`, `omt_1915cbc92b8f19be`, `omt_1915b16de34f59b4`) → ยืนยันบั๊ก #1 (สั่งงานซ้ำหลายทาง)
- รายงานสัปดาห์ไปตั้ง thread ของตัวเอง (`omt_1915b52cb78f1982`) แยกจาก thread รายวัน → ยืนยันบั๊ก #2/#3 (ไม่ได้ไปต่อเป็นรูปที่ 5)

### สถานะ webhook 2 ตัวที่หลุด
- ✅ ลบออกจากไฟล์ทั้งหมดแล้ว (commit `5f107a4`) — grep ทั้ง `WorkSpace\` + `hermes\scripts\` + `HEAD` ของ repo: ไม่เหลือ `bot/v2/hook/` เลย
- ⚠️ ยังอยู่ใน git history ที่ commit `396ec70` บน GitHub (public) → ลบออกจากไฟล์ **ไม่ช่วย** เพราะใครก็ `git log -p` เอาไปได้
- 🔴 **ต้องทำใน Lark เอง** (Claude เข้า Lark admin UI ไม่ได้): ห้อง → Settings → Bots → ลบ/สร้าง custom bot ใหม่ แล้วเอา URL ใหม่ไปใส่ Script Property `WEEKLY_LARK_WEBHOOK_URL`
  - `.../hook/10a1ad78-3f8f-4cff-be9a-1deed4661ab0` (ห้องจริง)
  - `.../hook/061e50e0-93f9-415a-8600-e3d6ea8c2f81` (ห้องเทส)
- ทางเลือกเสริม: rewrite history + force-push ให้ URL หายจาก history (ทำได้ แต่ SHA ของ public repo เปลี่ยนทั้งสาย และ fork/cache ที่คนอื่นดึงไปแล้วยังมีอยู่ → revoke สำคัญกว่า)

## 6. งานที่รออนุมัติ (push ขึ้น main)

ไฟล์ที่แก้ค้างใน `C:\Users\IT05\Desktop\WorkSpace\repos\POS`:
```
M .github/workflows/pos-daily-report.yml     (+13 -2)
M scripts/lark-appsscript-complete.gs        (+78 -22)
```
### push ติดที่ credential (2026-08-03) — ลองทุกทางแล้ว
| ทาง | ผล |
|---|---|
| `git push` จาก clone | ❌ ไม่มี credential (`.git-credentials` ไม่มี, credential.helper ว่าง, GCM ไม่ได้ติดตั้ง) |
| `$env:GITHUB_PERSONAL_ACCESS_TOKEN` | ❌ **หมดอายุ/เพิกถอนแล้ว** (`GET /user` → 401) |
| `gh` CLI | ❌ ไม่ได้ติดตั้ง (hosts.yml มีแต่ชื่อ user ไม่มี oauth_token) |
| MCP `claude.ai GitHub Custom` | ⚠️ auth ผ่านเป็น `it03qfp-eng` แต่ **read-only** → `push_files` ตอบ 403 resource not accessible |
| MCP `github-team` plugin | ❌ Bad credentials (ใช้ PAT ตัวที่หมดอายุตัวเดียวกัน) |

**ต้องเลือกทางใดทางหนึ่ง**: (1) ออก PAT ใหม่ (fine-grained: repo `it06qfp/POS` → Contents: write, Actions: write)
แล้วบอก Claude / (2) push เองด้วย `git -C C:\Users\IT05\Desktop\WorkSpace\repos\POS push origin main` /
(3) เปิดสิทธิ์เขียนให้ connector `claude.ai GitHub`

⚠️ เช็คด้วย: `GH_TOKEN` ใน Script Properties ของ Apps Script อาจเป็น PAT ตัวเดียวกันที่หมดอายุ →
ถ้าใช่ `dispatchReport()` จะพัง 401 ทั้งที่ trigger ถูกต้อง — รัน `testToken()` ยืนยันก่อนตั้ง trigger

### ผลทดสอบในเครื่อง (2026-08-03)

| การทดสอบ | ผล |
|---|---|
| `node --check` บน `.gs` | ✅ syntax OK |
| YAML parse `pos-daily-report.yml` | ✅ OK |
| unit test `findPosDailyThreadRoot_()` 15 assertion (harness stub GAS runtime) | ✅ ผ่านทั้งหมด |
| ยิง contents API + raw จริง (read-only) | ✅ ทั้งสองทางคืน `date: 03/08/2026`, root `om_x100b...f6e` |
| **live: ครบ 5 รูปใน thread เดียวไหม** | ✅ **PASS** — 4 รูป → ส่งรูปที่ 5 → อ่าน thread ซ้ำได้ 5 รูป (pos=0..4) |

### รายละเอียดเทส 5 รูป (2026-08-03 15:28 BKK)
สคริปต์ `…\scratchpad\verify_thread_5.py` เดินเส้นทางเดียวกับ Apps Script ที่แก้ใหม่:
อ่าน handoff ผ่าน contents API → เช็ควันที่ตรงกับวันนี้ → ขอ tenant token (larksuite) → upload รูป → `reply_in_thread`
```
thread omt_1915c3c8744f5982
 1. 15:02:09 text   POS Daily Report - 03/08/2026     pos=-1   ← root จาก GitHub Action
 2. 15:02:10 image  pos=0 │ 3. 15:02:11 image pos=1
 4. 15:02:13 image  pos=2 │ 5. 15:02:14 image pos=3   ← 4 รูปจาก Coda
 6. 15:28:57 image  pos=4                             ← รูปที่ 5 (รูป TEST แทนรายงานสัปดาห์)
สรุป: 4 -> 5 รูป  ผล: PASS
```
รูปที่ 5 ที่ยิงเป็นรูป TEST ที่วาดในเครื่อง (มีข้อความ "TEST IMAGE #5 (not a real weekly report)")
เพราะการ render รายงานสัปดาห์จริงต้องใช้ Sheets+Slides ในโปรเจกต์ Apps Script — กลไก thread ที่เคยพังคือ
"หา root ถูกไหม + reply เข้า thread เดิมไหม" ซึ่งเทสครบแล้ว ส่วนตัวรูปจริงจะได้เห็นตอนรัน Apps Script

harness: `…\scratchpad\test-thread-lookup.js` (stub `UrlFetchApp`/`Utilities.sleep`/`PropertiesService`) — เคสที่ครอบ:
handoff สดวันนี้ / handoff ค้างของเมื่อวาน (ต้อง null ไม่ใช่ reply ผิดวัน) / API 404 → fallback raw /
ไม่มี GH_TOKEN / ไม่มี `root_message_id` / body เสีย + network throw / handoff มาช้าแล้วเจอตอน retry รอบ 2

**สิ่งที่ทดสอบในเครื่องไม่ได้** (ต้องทดสอบตอน live เท่านั้น):
- การ render รูปสัปดาห์ (Sheets + Slides API) และ `uploadImageToLark_` — ต้องรันในโปรเจกต์ Apps Script
- `coda_lark_report.py` ไม่ได้แก้ในรอบนี้ จึงไม่รันซ้ำ (รันซ้ำ = โพสต์รายงานซ้ำเข้าห้องเทสโต้เปล่า ๆ)

## 7. ขั้นตอนที่เหลือ (TODO)

- [ ] อนุมัติ + push commit `5f107a4` ขึ้น main (เทสในเครื่องผ่านหมดแล้ว)
- [ ] **revoke webhook 2 ตัวใน Lark** แล้วออก URL ใหม่ → ใส่ Script Property `WEEKLY_LARK_WEBHOOK_URL` (ดูข้อ 5)
- [ ] ลบข้อความรูป TEST ที่ยิงตอนเทส (`om_x100b68315a5e58a4e15bd029c85a233`) ออกจากห้องเทสโต้ ถ้าไม่อยากให้ค้าง
- [ ] วาง `scripts/lark-appsscript-complete.gs` (เวอร์ชันหลัง push) ทับในโปรเจกต์ Apps Script
- [ ] ตั้ง Script Properties: `LARK_CHAT_ID`, `Test_BOT_Webhook` (+ `WEEKLY_LARK_WEBHOOK_URL` ถ้าจะใช้ทางเดิม)
- [ ] เช็ค `GH_TOKEN` ว่ามีสิทธิ์ **contents:read** ด้วย — ทดสอบด้วย `testToken()`
      (ไม่ใช่ blocker: ถ้า token ไม่พอสิทธิ์ API จะตอบ 401 แล้วโค้ด fallback ไป raw ซึ่งอ่านได้เพราะ repo เป็น public
      แต่ raw มี cache → เสี่ยงเจอบั๊ก #3 อีก จึงควรให้ token ใช้ได้จริง)
- [ ] รัน `setupWeekdayTriggersForBoth()` ครั้งเดียว → ได้ 12 trigger (dispatch 6 + weekly 6) → เช็คด้วย `listTriggers()`
- [ ] ทดสอบ live: `dispatchReport()` → รอ Action เสร็จ (~5-10 นาที) → `sendWeeklyProductionReport()` → ต้องเห็นรูปที่ 5 ต่อใน thread เดิม ไม่ใช่ thread ใหม่
- [x] ~~ปิด cron local `242c171bedbe`~~ ✅ ลบแล้ว 2026-08-03 (`hermes cron remove 242c171bedbe`)
      job นี้ยิง 08:00 ทุกวันด้วย `lark-push-both.py` ส่งรูปทดสอบเก่าจาก `Temp/lark_imgs` เข้าห้องเทสโต้ + Test BOT
      ซ้ำกับของจริง และใช้ UAT ที่หมดอายุ 2 ชม. · backup: `%TEMP%\jobs.json.bak-20260803` · ตอนนี้ `hermes cron list` = ว่าง
- [ ] (optional) สลับ production secrets เมื่อพร้อมส่งจริง
- [ ] (optional) อัปเกรด actions ให้พ้น Node 20 deprecation warning

## 8. ข้อจำกัดที่สำคัญ (อย่าลืม)

1. **Lark tenant ไทย = international (larksuite.com)** — ห้ามใช้ feishu.cn
2. **API เข้าห้อง external บล็อกถาวร**: 230027 (group), 230038 (p2p) — 对外共享 ไม่มีในไทย → ใช้ webhook เท่านั้น
3. **webhook ทำ thread ไม่ได้** — ส่งได้แค่ flat message/card → external ได้ card ใบเดียว
4. **tenant token อ่านประวัติห้องไม่ได้** → ต้องใช้ `latest_thread.json` handoff (ห้ามกลับไปใช้วิธีอ่าน chat history)
   หมายเหตุจากการเทส: `GET /im/v1/messages?container_id_type=chat` **อ่านได้** ด้วย tenant token (ลองแล้ว code 0)
   แต่ต้องอาศัยการ match ข้อความเอง ซึ่งเปราะกว่า handoff — คงใช้ handoff ต่อไป
4.1 **`thread_id` ใน `latest_thread.json` ไม่ใช่ thread id จริง** — เป็น `om_...` (message_id) เพราะตอนสร้าง root
   ยังไม่มี thread; thread id จริงเป็น `omt_...` ต้องขอด้วย `GET /im/v1/messages/{message_id}`
   ไม่กระทบการทำงาน (โค้ด reply ใช้ `root_message_id` เท่านั้น) แต่ห้ามเอา field นี้ไปใช้เป็น container_id
5. **UAT หมดอายุ 2 ชม.** — auto-refresh มีแค่ใน `lark-push-both.py`
6. **card img ใช้ `mode: small`** — อย่าใช้ `size:` (error 11246)
7. **`nearMinute()` เพี้ยนได้ ±15 นาที** — ทุก trigger ที่ต้องเรียงลำดับกันต้องเว้นห่าง ≥60 นาที
8. **`raw.githubusercontent.com` มี CDN cache** — ห้ามใช้อ่านค่าที่เพิ่งเขียนไม่กี่นาทีก่อน ให้ใช้ contents API
9. **Codex CLI push GitHub ไม่ได้** (sandbox proxy 127.0.0.1:9) — push/gh pr ต้องรันจาก shell ปกติ
10. **เครื่องนี้ไม่มี `gh` CLI** — ใช้ `git` ธรรมดา หรือ GitHub MCP

## 9. ข้อมูลอ้างอิง

- Apps Script project: https://script.google.com/home/projects/1xqFueDXrL6AE4Jqcrb77fF6HNq7wx2kzo-zx3iTq5VstjdpHSt61eDsF/edit
- Lark Open Platform (INTL): https://open.larksuite.com
- Developer Console: https://open.larksuite.com/app/cli_a96f6fcdb6f81ed0/auth
- Coda doc: `MiXbfRif1m` (tables: grid-lV1uGeGQl2, table-OA56XddNFI, grid-z9ENI7PaD5)
- Google Sheet รายงานสัปดาห์: `12cIDbt13wPfxqOCkX4l3x6O5wbudoB4KixycF1TgSX0` (B2:L14)
- สคริปต์เครื่อง: `C:\Users\IT05\AppData\Local\hermes\scripts\`
- Hermes บน VS Code: `hermes acp` (ACP server สำหรับ IDE)

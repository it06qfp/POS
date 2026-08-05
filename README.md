# POS Daily Lark Report

Pulls open rows from the "POS-Daily" Coda table, renders report images, and
delivers them to Lark as a threaded set of images (internal room) plus a
single summary card (external room). The pipeline spans two runtimes:

- **GitHub Actions (Python)** — pulls Coda data, renders images 1-4, stages
  them (does **not** send to Lark itself — see "Staging mode" below), and
  pushes them to the `daily-images` branch.
- **Google Apps Script** — pulls those images into Google Drive, renders the
  weekly production-plan image (image 5), posts the full set as a Lark
  thread, and sends one summary card to an external Lark room via webhook.
  **This is the only part of the pipeline that actually talks to the Lark
  API for sending messages.**

This started as a Python/Pillow rewrite of a PowerShell/`System.Drawing`
script that used to run on a Windows machine (same Coda doc/table/filter/
columns/sort, same visual layout), and has since grown the Apps Script +
Drive layer described below.

## Architecture / pipeline

1. **`scripts/coda_lark_report.py`** (GitHub Actions, `workflow_dispatch`
   only — **cron is disabled**; triggered by Apps Script's
   `dispatchReport()` at 07:05 Mon-Sat via the GitHub Actions API with
   `ref: 'main'`) — fetches open POS-Daily rows from Coda, renders the
   grouped table images (1-4), and pushes them plus `manifest.json` to the
   `daily-images` branch (not `main`).
2. **`scripts/lark-drive-thread.gs`** (Apps Script, triggered ~08:30
   Mon-Sat via `runDailyLarkPost()`):
   - `pullActionImagesToDrive_()` reads `manifest.json` from the
     `daily-images` branch and saves images 1-4 into today's Drive folder
     (`Lark - POS - Report/yyyy-MM-dd/`).
   - `saveWeeklyImageToDrive()` renders the weekly production-plan image
     (image 5) via `renderWeeklyReportImage_()` (shared helper, see below)
     and saves it into the same folder.
   - `sendTodayFolderToLark()` creates one Lark thread (internal room,
     `LARK_CHAT_ID`) with all images in the folder, then sends a single
     summary card to the external room via `Test_BOT_Webhook` (external
     rooms can't receive threads — a webhook only supports one card).
3. **`scripts/lark-appsscript-complete.gs`** — shared Lark helpers used by
   both `.gs` files (`getLarkTenantToken_`, `uploadImageToLark_`,
   `createThreadRoot_`, `replyImageInThread_`, `sendCardToExternal_`,
   `renderWeeklyReportImage_`, `readWeeklySheetData_`,
   `formatBangkokTimestamp_`), plus a standalone weekly-only flow
   (`sendWeeklyProductionReport()` / `sendWeeklyReportToLark_()`) kept as an
   alternate/fallback trigger path that posts the weekly image on its own
   instead of via the Drive-folder flow.

Both `.gs` files must live in the **same Apps Script project** — 
`lark-drive-thread.gs` calls helpers defined in `lark-appsscript-complete.gs`
directly (no imports in Apps Script; everything in one project shares scope).

### Staging mode — GitHub Actions doesn't send to Lark directly

`coda_lark_report.py` has two modes, switched by env vars:

- **Staging mode (current/real mode)** — `POS_STAGE_DIR=images` is set and
  `POS_KEEP_DIRECT_LARK` is **not** set. The script only renders images and
  writes `manifest.json` locally (`stage_images_for_gas(...)`); it never
  calls the Lark send-message API. The workflow's next step then pushes
  those files to the `daily-images` branch for Apps Script to pick up.
- **Direct-send mode (legacy/unused)** — set `POS_KEEP_DIRECT_LARK=1` (and
  drop/ignore `POS_STAGE_DIR`) to make the script call the Lark API itself
  using `LARK_APP_ID` / `LARK_APP_SECRET` / `LARK_CHAT_ID` from the job env.

Because the workflow currently sets `POS_STAGE_DIR: images` and does **not**
set `POS_KEEP_DIRECT_LARK`, the `LARK_APP_ID` / `LARK_APP_SECRET` /
`LARK_CHAT_ID` / `LARK_EXTERNAL_WEBHOOK_URL` env vars in the "Run POS Daily
report" step (currently wired to the `_TEST` secrets — `APP_ID_TEST`,
`APP_SECRET_TEST`, `LARK_CHAT_ID_TEST`, `LARK_WEBHOOK_URL_TEST`) are **not
used for sending anything** — that code path is skipped entirely. They're
effectively inert in the current configuration.

**The real destination and credentials are decided entirely by Apps
Script's own Script Properties** (see section 3 below) — `LARK_CHAT_ID`,
`Test_BOT_Webhook`, etc. set there, independent of whatever is in the GitHub
Actions workflow env. So the `_TEST` secrets sitting in the workflow do not
affect where the daily report actually gets sent.

### External card title

The card sent to the external Lark room gets its header from
`sendCardToExternal_()` in `scripts/lark-appsscript-complete.gs`:

```javascript
header: { title: { tag: 'plain_text', content: '📦 รายงาน POS Daily / แผนการรับงานผลิตได้ประจำสัปดาห์ PD' }, template: 'blue' },
```

Edit that line directly to change the card title — it's independent of
`WEEKLY_REPORT_TITLE` (which still drives the Lark thread's root message
text and the title printed inside the rendered weekly image).

## 1. Create the repo

Push this folder's contents to the root of a new GitHub repository (keep
`.github/workflows/pos-daily-report.yml` at that exact path — GitHub Actions
only looks for workflow files there).

## 2. Add repo secrets (GitHub Actions side)

Go to **Settings → Secrets and variables → Actions → New repository secret**
and add:

| Secret name | Value | Where to get it |
|---|---|---|
| `CODA_API_TOKEN` | Coda API token | coda.io → Account Settings → API Settings → Generate API token |
| `LARK_APP_ID` | Lark custom app id | Lark Open Platform → your custom app → Credentials |
| `LARK_APP_SECRET` | Lark custom app secret | same page as above |
| `LARK_CHAT_ID` | Lark group chat ID, e.g. `oc_xxxxxxxxxxxxxxxxx` | Open the target group's details and copy its chat ID; the app bot must be in the group |

The doc ID (`MiXbfRif1m`) and table ID (`table-OA56XddNFI`) are not secret —
they're hardcoded defaults in `scripts/coda_lark_report.py`, but can be
overridden with optional `CODA_DOC_ID` / `CODA_TABLE_ID` secrets or repo
variables if you ever point this at a different doc/table.

> **Note:** in the current workflow these Lark secrets are passed in as
> `_TEST` variants (`APP_ID_TEST`, `APP_SECRET_TEST`, `LARK_CHAT_ID_TEST`,
> `LARK_WEBHOOK_URL_TEST`) and — per "Staging mode" above — aren't actually
> used to send anything, since `POS_STAGE_DIR` staging mode is active. The
> real send credentials live only in Apps Script's Script Properties
> (section 3).

## 3. Apps Script Properties (Apps Script side, separate from GitHub secrets)

Set these under the Apps Script project's **Project Settings → Script
Properties** (not GitHub secrets — Apps Script can't read those):

| Property | Value |
|---|---|
| `LARK_APP_ID`, `LARK_APP_SECRET` | same Lark custom app as above |
| `GH_TOKEN` | classic PAT with `repo`/`contents:read` scope — reads `manifest.json` / images from the `daily-images` branch |
| `LARK_CHAT_ID` | internal room for the daily thread (defaults to the `เทสโต้` room hardcoded in `lark-appsscript-complete.gs` if unset) |
| `DRIVE_IMAGES_FOLDER_ID` | parent Drive folder ("Lark - POS - Report"); falls back to a hardcoded default if unset |
| `Test_BOT_Webhook` | webhook URL for the external room's summary card |
| `WEEKLY_LARK_WEBHOOK_URL` | legacy webhook, only used by the old `sendImageToLark_()` fallback |

**This is the credential set that actually determines where the daily
report gets sent** — see "Staging mode" above.

## 4. What changed vs. the original PowerShell version

- **Runner**: `ubuntu-latest` instead of your Windows PC — cheaper and
  faster on GitHub Actions.
- **Rendering**: Pillow instead of `System.Drawing`. Thai text needs a
  TrueType font with Thai glyphs, so the workflow installs the
  `fonts-thai-tlwg` apt package (Waree family) before running the script.
- **Coda access**: calls the public Coda REST API directly with an API
  token (`requests`), rather than going through an MCP connector. The API's
  `query` parameter only supports exact-match filters, not `IsBlank()`, so
  the script fetches all rows (paginated, only the needed columns) and
  filters for blank `รอคุยในที่ประชุม` client-side in Python — same result,
  just done locally instead of server-side.
- **Secrets**: Coda token, Lark app credentials, and chat ID are read from
  environment variables backed by GitHub Actions secrets, never hardcoded.
- **Delivery**: images no longer go straight to a webhook. GitHub Actions
  now only stages images/manifest for Apps Script (see "Staging mode"
  above); Apps Script (`lark-drive-thread.gs`) adds the weekly
  production-plan image and posts everything as one Lark thread, plus a
  single external-room summary card.

## 5. Files

```
.github/workflows/pos-daily-report.yml        # workflow_dispatch only (no cron); runs coda_lark_report.py in staging mode
.github/workflows/pos-daily-report-test.yml   # manual test run
.github/workflows/find-lark-chat-id.yml       # one-off helper to look up a Lark chat_id
scripts/coda_lark_report.py                   # Coda -> Pillow images 1-4 -> daily-images branch (staging mode; does not send to Lark)
scripts/drive_upload.py                       # Drive upload helpers (service account), used only in the legacy direct-to-Drive fallback mode
scripts/drive_check.py                        # pre-flight check: confirms the service account can write to the Shared Drive folder
scripts/lark-appsscript-complete.gs           # shared Lark helpers + standalone weekly-report flow
scripts/lark-drive-thread.gs                  # main daily flow: Drive folder -> Lark thread -> external card (the only step that actually sends to Lark)
scripts/tests/                                # test scripts
requirements.txt                              # requests, Pillow
latest_thread.json                            # written by GitHub Actions; read by the legacy thread-lookup path in lark-appsscript-complete.gs
POS-LARK-HANDOFF.md                           # full handoff notes (setup history, troubleshooting, design decisions)
```

For the detailed history of design decisions and troubleshooting notes, see
**[POS-LARK-HANDOFF.md](./POS-LARK-HANDOFF.md)**.

## 6. Testing before relying on the schedule

Push the repo, add the secrets, then run the workflow manually once from the
**Actions** tab ("Run workflow") and check the `daily-images` branch for the
new images/manifest. Then run `runDailyLarkPost()` manually from the Apps
Script editor and check both the internal Lark room (thread with all images)
and the external room (summary card) before trusting the daily triggers.

# POS Daily Lark Report (GitHub Actions)

Pulls open rows from the "POS-Daily" Coda table, renders a grouped table
image, and posts it to a Lark group via webhook — running daily on GitHub
Actions instead of a local scheduled task.

This is a Python/Pillow rewrite of a PowerShell/System.Drawing script that
used to run on a Windows machine. Same Coda doc/table/filter/columns/sort,
same visual layout (merged group cells, wrapped Product Name, alternating
row colors), same Lark webhook flow.

## 1. Create the repo

Push this folder's contents to the root of a new GitHub repository (keep
`.github/workflows/pos-daily-report.yml` at that exact path — GitHub Actions
only looks for workflow files there).

## 2. Add repo secrets

Go to **Settings → Secrets and variables → Actions → New repository secret**
and add:

| Secret name | Value | Where to get it |
|---|---|---|
| `CODA_API_TOKEN` | Coda API token | coda.io → Account Settings → API Settings → Generate API token |
| `LARK_APP_ID` | Lark custom app id | Lark Open Platform → your custom app → Credentials |
| `LARK_APP_SECRET` | Lark custom app secret | same page as above |
| `LARK_WEBHOOK_URL` | Full incoming-webhook URL, e.g. `https://open.larksuite.com/open-apis/bot/v2/hook/xxxxxxxx` | The Lark group's bot webhook settings |

The doc ID (`MiXbfRif1m`) and table ID (`table-OA56XddNFI`) are not secret —
they're hardcoded defaults in `scripts/coda_lark_report.py`, but can be
overridden with optional `CODA_DOC_ID` / `CODA_TABLE_ID` secrets or repo
variables if you ever point this at a different doc/table.

## 3. Schedule

`.github/workflows/pos-daily-report.yml` runs on cron `0 1 * * *` (01:00 UTC
= 08:00 Asia/Bangkok). Edit the cron expression to change the time. You can
also trigger it manually from the Actions tab (`workflow_dispatch`).

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
- **Secrets**: Coda token and Lark app secret are read from environment
  variables backed by GitHub Actions secrets, never hardcoded.

## 5. Files

```
.github/workflows/pos-daily-report.yml   # schedule + job definition
scripts/coda_lark_report.py              # fetch -> render -> send
requirements.txt                         # requests, Pillow
```

## 6. Testing before relying on the schedule

Push the repo, add the secrets, then run the workflow manually once from the
**Actions** tab ("Run workflow") and check the Lark group for the image
before trusting the daily cron.

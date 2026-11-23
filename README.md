# smartShift Defect Hub

Internal automation dashboard that replaces manual defect logging + Jira ticket creation for the SAP ABAP, S/4HANA transformation, Table-to-CDS, CFL, AMF and Clean Core analysis teams (target workspace **Spaces / CS Clean Core / R&D**).

**Flow:** download 26-column Excel template → fill → upload (immediate or scheduled) → validation → **deduplication** (duplicates suppressed, `DuplicateOccurrenceCount` incremented) → unique defects staged in **Pending Approvals** → human **Approve** (→ Jira REST API → `PROJ-XXXX`) or **Change Assignee** (→ notification → new assignee approves) → **e-mail to each assignee with a link to approve** → **Google Drive storage** of the original file, every attachment, a live tracking workbook (JiraTicketID, ExecutionStatus, statuses) and the master workbook.

Stack: Next.js 14 (App Router) · TypeScript · Tailwind CSS · lucide-react · shadcn/ui-style components · ExcelJS. Optional Electron wrapper for an offline double-click app.

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000  - pre-populated demo data, Jira in safe MOCK mode
npm test               # 63 tests
```
Then: **Sample data** button → upload it → 5 staged records, each with image / Word / Excel / link attachments → expand a row, open the attachments → **Approve** → open **Live logs**.
Copy `.env.example` to `.env.local` to configure real Jira, dedup threshold, sync target (doc 08).

## New in v2.3.0

Logo header, clickable summary boxes, inline edit marks (Summary, Description, Issue Type, Priority, Project Lead, Attachment Paths), return-to-reporter with comment and **Reporter Review** tab/box, "Email status update" column and filters on every tab, duplicate audit that jumps to the right tab, optional e-mail sign-in, **Cancel entry** (reason required, no Jira ticket ever) with a **Cancelled** box and tab, engineering fields for automated-fix defects with an approval gate, routing to a product-engineering Jira project, a **Recurrence report** by Fix / Rule ID, "Open Drive folder" permission list (`OPEN_DRIVE_USERS`). No GitHub and no "Refresh from GitHub" any more. Hosting for a shared URL: `deploy/HOSTING.md`.

## Documentation (`docs/`)

| Doc | Covers |
|---|---|
| [01-PREREQUISITES](docs/01-PREREQUISITES.md) | Software, versions, VS Code extensions, first run |
| [02-CODEBASE-GUIDE](docs/02-CODEBASE-GUIDE.md) | Stack decision & Python alternative, file-by-file map, **Developer Modification Cheat Sheet** |
| [03-ARCHITECTURE](docs/03-ARCHITECTURE.md) | Mermaid/ASCII system + sequence + state diagrams, status transition table |
| [04-EXCEL-SCHEMA](docs/04-EXCEL-SCHEMA.md) | The exact 19 columns (revised template, Customer = reference only, attachment linking), validation, parser failure modes |
| [05-SYNC-COMPARISON](docs/05-SYNC-COMPARISON.md) | Historic comparison of storage options (GitHub option is no longer in the product) |
| [06-RUNBOOK-AND-UI](docs/06-RUNBOOK-AND-UI.md) | Sample SAP data, behind-the-scenes walkthrough, 4 ASCII screen blueprints, error catalogue |
| [07-DESKTOP-PACKAGING](docs/07-DESKTOP-PACKAGING.md) | Electron `.exe/.app` build and user instructions |
| [10-EMAIL-NOTIFICATIONS](docs/10-EMAIL-NOTIFICATIONS.md) | **Assignee e-mails** on upload / reassign / approve with dashboard deep links, names vs e-mails, SMTP setup, troubleshooting |
| [12-ENGINEERING-FEEDBACK-EXPLAINED](docs/12-ENGINEERING-FEEDBACK-EXPLAINED.md) | Plain explanation: who does what for automated-fix defects, Jira space/labels, mandatory fields |
| [09-GOOGLE-DRIVE-SETUP](docs/09-GOOGLE-DRIVE-SETUP.md) | **Step-by-step Google Drive setup** (folder id, service account or OAuth refresh token, `npm run test-drive`, restore, troubleshooting) |
| [11-MULTI-USER-AND-HOSTING](docs/11-MULTI-USER-AND-HOSTING.md) | Sign-in, Open repo list, shared URL |
| [08-DEPLOYMENT-AND-OPERATIONS](docs/08-DEPLOYMENT-AND-OPERATIONS.md) | Env vars, Jira setup, hosting, security checklist, limitations |

`api.http` = VS Code REST Client collection. `samples/` = 5-record sample workbook; `attachments/samples/` = its dummy images/Word/Excel files. `deploy/` = Windows/Linux launchers, pm2, Dockerfile (untested). `scripts/smtp-sink.mjs` = local mail catcher; `scripts/github-emulator.mjs` = local fake GitHub for trying storage mode without a token.

## Verification performed

`tsc` clean · ESLint clean · `next build` OK · 74 automated tests (26-col schema + aliases, attachments, dedup, approve/reassign → both statuses Approved, Customer never in the Jira payload, Jira retries / optional-field fallback against an emulator, folder + webhook sync, Google Drive storage (OAuth + service-account sign-in) + restore + outage retry against an emulator, cancel workflow, engineering gate / Jira routing / recurrence report) · HTTP smoke test of every route · headless-browser UI run with screenshots · standalone (desktop) server bundle exercised end-to-end.
**Not verified:** a real Jira Cloud tenant, real Google Drive (the Drive code is tested against an emulator of the Drive v3 API; run `npm run test-drive` against your folder before a demo), a Power Automate flow, and the final Electron installer build (see doc 08 §6, doc 07).

## Start empty / clear old data (v2.3.1)

The Hub now starts EMPTY by default (SEED_DEMO_DATA=false). To clear data from earlier runs: stop the Hub, run `npm run reset-data`, start again. With SYNC_MODE=github also empty `state/store.json` in the repo. "Open repo" and "Sync now" only appear when SYNC_MODE=github (and, with sign-in on, for admins / OPEN_REPO_USERS).


**v2.4.1:** settings are read only from `.env.local` (a configuration check on the dashboard and in the start-up log tells you when it is missing); click any "Email status update" cell for the full error and how to fix it; every tab has a Google Drive status column per defect.

**v2.4.2:** Drive tracking and master workbooks always carry the latest Jira ID and statuses (files are updated by id; changes made during an upload are no longer missed); new `master/CleanCore_Recurrence_Report.xlsx`.

## v2.4.3 - demo reset shortcut (demo use only)
To start a demo from an empty dashboard: stop the Hub, run `npm run demo-reset` (type YES), then `npm start`.
It deletes `./data` and `./mail-sink` and moves the Hub's own Drive folders (uploads, tracking, attachments, master, state) to the Google Drive Trash (recoverable ~30 days; your other files are untouched).
`npm run demo-reset -- --local` clears only this PC; `-- --yes` skips the question. Clearing only the PC is not enough while SYNC_MODE=gdrive, because the Hub restores from Drive `state/store.json`.

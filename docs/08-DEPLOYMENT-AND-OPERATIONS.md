# 08 · Deployment, Configuration & Operations

## 1. Environment variable reference (`.env.local`)

| Variable | Default | Meaning |
|---|---|---|
| `JIRA_BASE_URL` | *(empty ⇒ MOCK mode)* | e.g. `https://smartshift.atlassian.net` (Jira **Cloud**, REST v3) |
| `JIRA_EMAIL` / `JIRA_API_TOKEN` | – | Service-account email + API token (Basic auth). All three must be set for LIVE mode |
| `JIRA_WORKSPACE_PATH` | `Spaces / CS Clean Core / R&D` | Display string in the header and in each ticket's description header |
| `JIRA_DEFAULT_PROJECT_KEY` | `CCRD` | **Assumption – replace with the real key of the "CS Clean Core / R&D" Jira space** |
| `JIRA_PROJECT_MAP` | `{}` | JSON: sheet `ProjectKey` → Jira key, e.g. `{"P&G":"PGCC","SAP-CC":"CCRD"}` |
| `JIRA_LEAD_FIELD` | *(empty)* | Custom field id for `Lead`; empty ⇒ prepended to description |
| `JIRA_MOCK_FAIL_RATE` | `0` | MOCK mode only: probability (0–1) of simulated 503 – for demoing the FAILED/Retry path |
| `DEDUP_THRESHOLD` | `0.9` | Fuzzy similarity 0.5–1.0 (exact hash match always wins) |
| `SEED_DEMO_DATA` | `true` | `false` ⇒ a brand-new store starts empty (no demo defects) |
| `DATA_DIR` | `./data` | `store.json`, `logs/app.log`, `scheduled/` |
| `ATTACHMENT_ROOT` | `.` | Base folder for relative `AttachmentPaths` (on the **server host**) |
| `SYNC_MODE` | `none` | `none` \| `folder` \| `gdrive` \| `webhook` (see doc 05) |
| `SYNC_FOLDER_PATH` | – | UNC/mounted folder for `folder` |
| `GDRIVE_FOLDER_ID`, `GDRIVE_KEY_FILE` / `GDRIVE_SERVICE_ACCOUNT_JSON` (service account) or `GDRIVE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`, `GDRIVE_RESTORE_ON_EMPTY` | – | `gdrive` mode (docs/09) |
| `ENGINEERING_REQUIRE_MODE`, `ENGINEERING_REQUIRED_FIELDS`, `ENGINEERING_JIRA_PROJECT_KEY`, `ENGINEERING_JIRA_LABELS`, `ENGINEERING_JIRA_COMPONENT`, `ENGINEERING_NOTIFY_EMAIL` | flagged | engineering feedback (see .env.example) |
| `POWER_AUTOMATE_URL`, `POWER_AUTOMATE_SECRET`, `POWER_AUTOMATE_INCLUDE_ROWS` | – | `webhook` mode |
| `NOTIFY_WEBHOOK_URL` | – | Teams/Slack incoming webhook for reassignment notifications (`{"text": …}` JSON) |

## 2. Preparing Jira Cloud

1. Create (or use) a **service account** user, e.g. `svc-defect-hub@smartshift.com`; generate an API token (id.atlassian.com → Security).
2. Grant it, in the Clean Core R&D space: *Browse Projects, Create Issues, Edit Issues, Assign Issues, Create Attachments*, and *Assignable User* visibility of your assignees (user search must return their email – if profile visibility hides emails, set *Email visibility* for those users to *Anyone*, or the lookup falls back to the first active match).
3. Make sure every `IssueType` and `Priority` used in the sheet exists in the space's issue-type scheme, and that every value in `Components` exists as a Jira component (Jira rejects unknown components with HTTP 400 – shown verbatim in the UI).
4. Put the project key in `JIRA_DEFAULT_PROJECT_KEY`. Smoke test: approve one record and verify the ticket (assignee, reporter, labels `cleancore-defect-hub`, ADF description).
5. If your Jira is **Data Center/Server**, `jira.ts` needs changes (REST v2, PAT bearer auth, plain-text description, `name`/`key` user fields instead of `accountId`).

## 3. Running as a team service (browser users)

```bash
npm ci && npm run build
PORT=3000 DATA_DIR=/var/lib/cleancore npm start         # or: pm2 start "npm start" --name defect-hub
```
Reverse-proxy with TLS and **SSO in front** (nginx + oauth2-proxy, Azure App Service Easy Auth, or an Entra ID Application Proxy). Run **exactly one instance** – state is in-process.

Reference Dockerfile *(not built or tested in this repo's sandbox – validate in your pipeline)*:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
```
(If the container crashes with a `Cannot find module …/require.mjs`, copy the full `node_modules/generator-function` and `node_modules/async-function` packages into the image – same issue `scripts/prepare-desktop.mjs` solves.)

## 4. Security checklist

| Item | Status / action |
|---|---|
| **Authentication / RBAC** | **Not built in.** Anyone who can reach the URL can approve tickets. Bind to localhost (desktop build does) or front with SSO. Add role checks in `src/app/api/**` if you need approver-only actions |
| Secrets | `.env.local` / `config.env` hold the Jira token and webhook URLs – keep out of Git (`.gitignore` covers them), restrict file ACLs, rotate regularly |
| Upload hardening | `.xlsx` only, ZIP-signature check, 10 MB / 5 000-row caps, no formula evaluation, values stored as text |
| Path traversal | `AttachmentPaths` rejects `..` and resolves under `ATTACHMENT_ROOT` |
| Forged state | System columns in uploads are ignored and reset |
| Double-submit | Per-record in-flight lock + "already approved" guard (HTTP 409) prevent duplicate Jira tickets |
| Logging | Logs contain summaries and emails, never tokens; stack traces only for failures |
| Data at rest | `store.json` is plaintext – use disk encryption/ACLs |

## 5. Operations

- **Backups:** copy `DATA_DIR/store.json` (and `logs/`). Corrupt store → auto-backed-up as `store.json.corrupt-<ts>`, then re-seeded; restore the backup manually.
- **Reset demo data:** stop the app, delete `DATA_DIR`, start (re-seeds the 11 demo records). **In production set `SEED_DEMO_DATA=false` before the first start** so the store begins empty.
- **Logs:** `DATA_DIR/logs/app.log` (append-only; rotate with logrotate/Windows Task Scheduler).
- **Health:** `GET /api/sync` (200 = alive), `GET /api/state`.
- **Capacity:** JSON store comfortably handles tens of thousands of records; beyond that swap `store.ts` for SQLite/Postgres (same `getDb()/commit()` surface).

## 6. Known limitations (read before go-live)

1. No built-in authentication or per-user audit trail (who clicked *Approve*) – add via your SSO proxy headers.
2. Single-instance, in-process state and scheduler.
3. **Live Jira calls were verified against a local Jira emulator** (auth header, accountId lookup, ADF payload, 429 retry, 400 error surfacing, 503 give-up, unknown assignee) but **not against a real Atlassian tenant** – run the smoke test in §2 step 4 first. Field names such as the project key are configuration assumptions.
4. Google Drive sync is implemented to the Drive v3 API but untested against the real service (run `npm run test-drive`); Power Automate flow must be built in your tenant (steps in doc 05).
5. `AttachmentPaths` are resolved on the **machine running the server**, not the uploader's laptop. For browser users on a shared server, place attachments under `ATTACHMENT_ROOT` (e.g. a mounted share) first.
6. Reassignment notifications are webhook/log based; email (SMTP/Graph) is not implemented.
7. Updates from the synced master copy are not read back (one-way sync).
8. Polling (2 s) is used instead of SSE; swap path documented in doc 02.


## Revision addendum (26-column template, attachments, Drive storage)

New variables: `JIRA_LENIENT_FIELDS`, `JIRA_DEFAULT_LABELS`, `JIRA_ISSUE_TYPES`, `JIRA_PRIORITIES`, `ATTACHMENT_ROOT`, `GITHUB_*` (see `.env.example`). Launchers: `deploy/start-windows.bat`, `deploy/start.sh`, `deploy/ecosystem.config.cjs` (pm2), `deploy/Dockerfile` (not built in the authoring environment). For the desktop app and Docker image `attachments/` is bundled so the sample's server-path attachments resolve. Jira "Customer" is never sent. Default Jira space key is now `JAIT`.

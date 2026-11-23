# 02 · Technology Stack, Codebase Navigation & Developer Cheat Sheet

## 1. Stack decision

**Delivered (primary): Next.js 14 (App Router) + TypeScript + Tailwind CSS 3 + lucide-react + shadcn/ui-style components.**
UI primitives in `src/components/ui/` follow the shadcn/ui conventions (`cva` + `tailwind-merge` + Radix `Dialog`/`Tabs`) but are committed source, so there is no CLI step and you can re-skin them directly.
Server logic is plain TypeScript in `src/lib/` (framework-agnostic – only `src/app/api/**` and `src/lib/http.ts` import Next).

### Dual-stack assessment

| Criterion | **Next.js (delivered)** | Python: FastAPI + React | Python: FastAPI + Streamlit |
|---|---|---|---|
| One language/runtime for UI + API | ✅ TypeScript end-to-end | ❌ two toolchains | ⚠️ Python only, but UI is limited |
| UI fidelity (modals, drawers, polling, tables) | ✅ full control | ✅ full control | ⚠️ rerun-model; modals/live drawer are awkward |
| Excel libs | `exceljs` (data validation, styling, notes) | `openpyxl` (equally strong) | `openpyxl` |
| Offline desktop packaging | Electron wraps the standalone Node server (~80 MB + Electron) | PyInstaller `--onefile` + browser tab / pywebview | PyInstaller (Streamlit bundling is fragile) |
| Team skills fit (SAP ABAP/Python scripting teams) | Medium | **High** for Python-savvy SAP teams | **High** |
| Time to production-grade | Shortest (delivered) | +2–3 weeks | +1 week, UX ceiling |
| Concurrency model | Single Node process, in-process locks | uvicorn workers need external lock/DB | single session-state per user |

**Recommendation:** ship Next.js. Choose **FastAPI + React** only if the maintaining team is Python-only – you would port `src/lib/*` 1-to-1 (the module boundaries below were designed for that) and reuse the React components unchanged. **FastAPI + Streamlit** is acceptable for an internal prototype but is not recommended for the human-in-the-loop approval workflow.

### Python port map (if you choose that route)

| TypeScript module | Python equivalent |
|---|---|
| `lib/schema.ts` | `pydantic.BaseModel` (`DefectRow`) with `Literal` enums + `EmailStr` |
| `lib/excel.ts` | `openpyxl` (`DataValidation`, header notes) |
| `lib/dedup.py` | `hashlib.sha256` + `rapidfuzz.fuzz.token_set_ratio` (or the same shingle-Jaccard) |
| `lib/jira.ts` | `httpx.AsyncClient` + `tenacity` retry |
| `lib/engine.ts` | service module; use `asyncio.Lock` per record id |
| `lib/store.ts` | SQLite via `sqlmodel` (recommended once >1 worker) |
| `api/**` | FastAPI routers; `StreamingResponse` for SSE |

Skeleton of the Python core (drop-in reference, not wired into this repo):

```python
# app/main.py - FastAPI alternative skeleton
import hashlib, re
from fastapi import FastAPI, UploadFile, HTTPException
from openpyxl import load_workbook
from rapidfuzz import fuzz

COLUMNS = ["ProjectKey","IssueType","Summary","Description","Lead","Priority","AssignApprovalStatus","AssigneeEmail",
           "ReporterEmail","Components","Labels","AttachmentPaths","JiraTicketID","ExecutionStatus","ProcessedAt",
           "DuplicateOccurrenceCount","ReassignedToEmail","ReassignStatus"]
app = FastAPI(title="CleanCore Defect Hub (Python)")
DB: list[dict] = []

def norm(s: str) -> str:
    s = re.sub(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{5,}\b|\b0x[0-9a-f]+\b", " ", (s or "").lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9_/$<> -]+", " ", s)).strip()

def match(row: dict, threshold: float = 90.0):
    fp = hashlib.sha256((norm(row["Summary"]) + "\n" + norm(row["Description"])).encode()).hexdigest()
    for r in DB:
        if r["fp"] == fp: return r, 100.0
        score = .6*fuzz.token_set_ratio(norm(row["Summary"]), norm(r["Summary"])) + .4*fuzz.token_set_ratio(norm(row["Description"]), norm(r["Description"]))
        if score >= threshold: return r, score
    return None, 0.0

@app.post("/api/upload")
async def upload(file: UploadFile):
    ws = load_workbook(file.file, read_only=True, data_only=True).active
    header = [str(c.value).strip() if c.value else "" for c in next(ws.iter_rows(min_row=1, max_row=1))]
    missing = [c for c in COLUMNS if c not in header]
    if missing: raise HTTPException(422, f"Missing required header(s): {', '.join(missing)}")
    staged = dups = 0
    for vals in ws.iter_rows(min_row=2, values_only=True):
        row = {h: (str(v).strip() if v is not None else "") for h, v in zip(header, vals)}
        if not row.get("Summary"): continue
        hit, _ = match(row)
        if hit: hit["DuplicateOccurrenceCount"] += 1; dups += 1; continue
        DB.append({**row, "AssignApprovalStatus": "In Progress", "ExecutionStatus": "PENDING", "DuplicateOccurrenceCount": 0,
                   "fp": hashlib.sha256((norm(row["Summary"]) + "\n" + norm(row["Description"])).encode()).hexdigest()}); staged += 1
    return {"staged": staged, "duplicates": dups}
# run: uvicorn app.main:app --reload     (requirements: fastapi uvicorn openpyxl rapidfuzz python-multipart httpx)
```

## 2. Codebase navigation & file usage directory

```
cleancore-defect-hub/
├─ package.json  tsconfig.json  next.config.mjs  tailwind.config.ts  postcss.config.mjs  .eslintrc.json  vitest.config.ts
├─ .env.example  .env.local          ← all runtime settings (Jira, dedup threshold, storage, sync)
├─ api.http                          ← REST Client request collection
├─ samples/CleanCore_Defects_SAMPLE_5records.xlsx
├─ scripts/prepare-desktop.mjs       ← copies the standalone build into desktop/app
├─ desktop/ (main.js, package.json)  ← Electron wrapper → .exe/.app
├─ tests/engine.test.ts
├─ docs/…
└─ src/
   ├─ lib/        (server-side business logic – no UI)
   ├─ app/        (Next.js routes: page + API)
   └─ components/ (React UI)
```

### `src/lib/` – runtime responsibilities

| File | Runtime responsibility |
|---|---|
| `schema.ts` | **The 26-column contract**: `COLUMNS`, enums (`ISSUE_TYPES`, `PRIORITIES`…), `DefectRow`/`DefectRecord` types, per-column help text, `validateRow()` (required fields, enum, email, length, `..` path guard). Forces system columns back to safe defaults so uploads can't forge Jira IDs |
| `excel.ts` | `buildTemplate()` (styled header, dropdown data validation, instructions sheet), `buildMasterWorkbook()` (export + sync file), `parseWorkbook()` (zip sniffing, header presence check, per-row validation, row cap, formula/rich-text/hyperlink cell handling) |
| `dedup.ts` | `normalize()`, `fingerprint()` (SHA-256), `similarity()` (weighted shingle-Jaccard), `findMatch()` (exact hash → fuzzy ≥ threshold) |
| `engine.ts` | Workflow & state machine: `ingest()`, `submitUpload()` (immediate vs scheduled), `runDueSchedules()`, `cancelSchedule()`, `approve()`, `reassign()`, `stats()`. Contains the rules *"approved ⇒ reassignment locked"* and *"Jira failure ⇒ FAILED, still retryable"* |
| `jira.ts` | Jira Cloud REST v3 client: `resolveProjectKey()`, `buildIssuePayload()`, ADF conversion, user lookup, attachments upload, retry/back-off (429/5xx/network), error classification, **MOCK mode** |
| `store.ts` | In-memory DB (global singleton) + atomic JSON persistence at `DATA_DIR/store.json`; corrupt-file backup; starts the 5-second scheduler loop; `commit()` persists and triggers sync |
| `sync.ts` | Background sync (debounced 3 s): `folder` (SMB/UNC, lock file + atomic rename), `gdrive` (Google Drive v3 API), `webhook` (Power Automate); status for the UI |
| `logger.ts` | Ring buffer (1000 lines) + `DATA_DIR/logs/app.log`; levels `INFO/SUCCESS/WARNING/ERROR` with stack traces |
| `notify.ts` | Reassignment notification: audited entry + optional Teams/Slack-style webhook |
| `config.ts` | Reads env vars into one typed object (`getConfig()`) |
| `seed.ts` | Demo SAP Clean Core defects used on first start |
| `sample.ts` | Builds the downloadable test workbook (4 new + 1 exact dup + 1 fuzzy dup + 1 invalid) |
| `types.ts`, `utils.ts`, `http.ts` | Shared types, `cn()`/date helpers, API error → JSON mapping |

### `src/app/` – routes

| File | Purpose |
|---|---|
| `page.tsx` | The single-page dashboard (assembles everything, owns toasts/modal/drawer state) |
| `layout.tsx`, `globals.css` | HTML shell, Tailwind layers |
| `api/state/route.ts` | `GET` – everything the UI needs in one poll (KPIs, pending, reassigned, schedules, duplicates, log delta, sync status) |
| `api/records/route.ts` | `GET` – server-side search/filter/sort/pagination for Approved table |
| `api/records/[id]/approve/route.ts` | `POST` – approve → Jira |
| `api/records/[id]/reassign/route.ts` | `POST {email,note}` – change assignee |
| `api/upload/route.ts` | `POST multipart` – immediate or scheduled ingestion |
| `api/scheduled/[id]/route.ts` | `DELETE` – cancel schedule |
| `api/template/route.ts` | `GET` – blank template or `?sample=1` |
| `api/export/route.ts` | `GET ?status=` – master workbook |
| `api/sync/route.ts` | `GET/POST` – sync status / force |

### `src/components/`

| File | Purpose |
|---|---|
| `use-dashboard.ts` | 2-second polling hook + log accumulation + offline detection |
| `kpi-cards.tsx` | The four global KPI cards |
| `upload-panel.tsx` | Drop zone, Immediate/Scheduled toggle + datetime picker, template/sample download, result + row errors |
| `dup-panel.tsx` | Duplicate warning banner + audit list with occurrence counts |
| `pending-table.tsx` | Pending Approvals **and** Reassigned tables (Approve / Retry / Change Assignee, expandable detail + Jira error) |
| `reassign-dialog.tsx` | Change Assignee modal (email validation, known-assignee suggestions, note) |
| `approved-table.tsx` | Searchable/filterable/sortable/paginated audit table, Jira links, exports |
| `log-drawer.tsx` | Live terminal drawer (level filter, auto-scroll, stack-trace toggle) |
| `ui/*` | `button`, `badge`, `card`, `dialog`, `tabs`, `input` (shadcn-style) |
| `types.ts` | `DashState` + `api()` fetch helper with typed errors |

## 3. Developer Modification Cheat Sheet

| I want to… | Edit this file | Exactly what to change |
|---|---|---|
| **Add / rename / reorder an Excel column** | `src/lib/schema.ts` | `COLUMNS` array + `DefectRow` interface + `COLUMN_HELP`; then add the field to `validateRow()` return object and to `seed.ts` `mk()` defaults. Header colouring uses index positions in `excel.ts → styleHeader()` (`i >= 13 \|\| i === 7` = grey "system" columns) – update if you insert columns. Template data-validation dropdowns: `addValidations()` in `excel.ts` |
| **Change allowed Priority / IssueType / status values** | `src/lib/schema.ts` | `PRIORITIES`, `ISSUE_TYPES`, `APPROVAL_STATUSES`, `EXECUTION_STATUSES`, `REASSIGN_STATUSES` (Excel dropdowns and validation update automatically) |
| **Make a column required / change email, length rules** | `src/lib/schema.ts` | `REQUIRED_USER_COLUMNS`, `EMAIL_RE`, `MAX_SUMMARY`, `MAX_DESCRIPTION`, rules inside `validateRow()` |
| **Max rows / file size** | `src/lib/config.ts` | `maxRowsPerFile`, `maxUploadBytes` |
| **Dedup threshold (sensitivity)** | `.env.local` | `DEDUP_THRESHOLD=0.9` (0.5–1.0; 1.0 ⇒ exact-only). Code default in `src/lib/config.ts` |
| **Dedup logic** (what is "the same defect") | `src/lib/dedup.ts` | `normalize()` (noise stripping – add e.g. transport numbers `\b[A-Z]{3}K\d{6}\b`), `WEIGHTS` (summary 0.6 / description 0.4), `shingles(text, n)` (word-bigrams), `similarity()` (swap Jaccard for Levenshtein/embedding). Scope (e.g. compare only within same `ProjectKey`): filter `history` in `engine.ts → ingest()` before `findMatch()` |
| **What happens on duplicate** (count, log, link) | `src/lib/engine.ts` | `ingest()` → `if (m) { … }` block |
| **Jira payload** (fields, labels, description layout) | `src/lib/jira.ts` | `buildIssuePayload()` |
| **Project keys / workspace routing** | `.env.local` | `JIRA_DEFAULT_PROJECT_KEY`, `JIRA_PROJECT_MAP={"P&G":"PGCC","SAP-CC":"CCRD"}`, `JIRA_WORKSPACE_PATH` (display string). Logic in `jira.ts → resolveProjectKey()` – e.g. route by `Components` there |
| **Store the Lead in a Jira custom field** | `.env.local` | `JIRA_LEAD_FIELD=customfield_10042` |
| **Jira auth, base URL, retries, timeout** | `.env.local` + `src/lib/config.ts` (`timeoutMs`, `maxAttempts`) + `jira.ts → jiraFetch()/createJiraIssue()` |
| **Jira error messages/classification** | `src/lib/jira.ts` → `toJiraError()` |
| **Approval / reassignment rules** (state transitions) | `src/lib/engine.ts` → `approve()`, `reassign()` |
| **Reassignment notification** (text/channel) | `src/lib/engine.ts → reassign()` (message body) and `src/lib/notify.ts` (transport; `NOTIFY_WEBHOOK_URL`) |
| **KPI cards** | `src/components/kpi-cards.tsx` (labels/icons) + `engine.ts → stats()` (numbers) |
| **Pending approvals table columns / buttons** | `src/components/pending-table.tsx` |
| **Reassign modal fields, assignee suggestions** | `src/components/reassign-dialog.tsx` (`KNOWN_ASSIGNEES`) |
| **Approved table columns, page sizes, filters** | `src/components/approved-table.tsx` (UI) + `src/app/api/records/route.ts` (server filtering/sort whitelist) |
| **Page layout, tabs, header, toast** | `src/app/page.tsx` |
| **Branding / colours / fonts** | `tailwind.config.ts` (`brand` palette) and `globals.css` |
| **Live-log drawer behaviour / retention** | `src/components/log-drawer.tsx`; buffer size `MAX` in `src/lib/logger.ts` |
| **Polling interval (2 s)** | `src/components/use-dashboard.ts` (`intervalMs`). For SSE, add `app/api/stream/route.ts` returning `text/event-stream` and replace `setInterval` with `EventSource` |
| **Local storage location** | `.env.local` → `DATA_DIR` (default `./data` → `store.json`, `logs/app.log`, `scheduled/*.xlsx`). Storage engine: `src/lib/store.ts → load()/persist()` |
| **Network path / simulated cloud sync** | `.env.local` → `SYNC_MODE=folder` + `SYNC_FOLDER_PATH=\\\\fileserver\\cleancore`; behaviour in `src/lib/sync.ts → pushFolder()`; debounce in `config.ts → sync.debounceMs`; master file name `MASTER_FILE` in `sync.ts` |
| **Google Drive / Power Automate sync targets** | `.env.local` (`GDRIVE_*`, `POWER_AUTOMATE_*`) + `sync.ts → pushGithub()/pushWebhook()` |
| **Scheduler tick (5 s)** | `src/lib/store.ts → getDb()` (`setInterval(…, 5000)`) |
| **Attachment root directory** | `.env.local` → `ATTACHMENT_ROOT` (relative `AttachmentPaths` resolve here; `..` is blocked) |
| **Demo data** | `src/lib/seed.ts` (delete `data/` to re-seed) |
| **Desktop app name/icon/installer** | `desktop/package.json → build`, `desktop/main.js` |

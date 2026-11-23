# 03 · End-to-End Architecture & Execution Flow

Mermaid diagrams render in GitHub, VS Code (Mermaid extension) and most wikis; an ASCII equivalent follows the system diagram.

## 1. System view

```mermaid
flowchart LR
  subgraph Client["Browser / Electron window"]
    UI["Dashboard (React)\nKPIs · Tabs · Modal · Log drawer"]
  end
  subgraph Server["Next.js server (Node)"]
    API["/api/* route handlers"]
    ENG["engine.ts\nworkflow + state machine"]
    XL["excel.ts\ntemplate · parse · export"]
    DD["dedup.ts\nhash + fuzzy"]
    JC["jira.ts\nREST v3 client"]
    ST[("store.ts\nin-memory + data/store.json")]
    LG["logger.ts\nring buffer + app.log"]
    SC["scheduler\n5s tick"]
    SY["sync.ts\ndebounced push"]
  end
  UI -- "poll /api/state every 2s" --> API
  UI -- "upload / approve / reassign" --> API
  API --> ENG
  ENG --> XL & DD & JC & ST & LG
  SC --> ENG
  ST -- "commit()" --> SY
  JC -- "HTTPS 443" --> JIRA[("Jira Cloud\nSpaces / CS Clean Core / R&D")]
  SY --> T1[("SMB share")] & T2[("Google Drive folder")] & T3[("Power Automate → SharePoint")]
```

```
┌──────────────┐  2s poll   ┌────────────────────────── Next.js server ──────────────────────────┐
│  Dashboard   │──────────▶ │ /api/state ┐                                                         │
│  (React)     │  upload    │ /api/upload ├▶ engine.ts ─▶ excel.ts (parse/validate 19 cols)       │
│              │──────────▶ │ /api/records/:id/approve   ├▶ dedup.ts (hash → fuzzy)               │
│              │  approve   │ /api/records/:id/reassign  ├▶ store.ts (RAM + store.json) ──commit──▶ sync.ts ─▶ SMB | GitHub | Power Automate
│              │──────────▶ │                            ├▶ jira.ts ──HTTPS──▶ Jira Cloud         │
└──────────────┘            │ scheduler(5s) ─▶ engine    └▶ logger.ts ─▶ app.log + live drawer    │
                            └─────────────────────────────────────────────────────────────────────┘
```

## 2. Excel template download & local editing

```mermaid
sequenceDiagram
  actor U as Analyst
  participant UI as Dashboard
  participant API as GET /api/template
  participant XL as excel.ts
  U->>UI: Click "Template (.xlsx)"
  UI->>API: GET /api/template
  API->>XL: buildTemplate()
  XL-->>API: 26-column workbook (dropdowns, header notes, Instructions sheet)
  API-->>U: CleanCore_Defects_Template.xlsx
  Note over U: Edits locally in Excel.<br/>Blue headers = user input, grey = system managed.<br/>Dropdowns restrict IssueType / Priority.
  U->>U: Save as .xlsx (keep all 19 headers)
```

## 3. Ingestion gateway → dedup → dual-state branching

```mermaid
sequenceDiagram
  actor U as Analyst
  participant UI as Upload panel
  participant API as POST /api/upload
  participant E as engine.ts
  participant X as excel.ts
  participant D as dedup.ts
  participant S as store.ts
  participant L as logger.ts
  U->>UI: Drop .xlsx, choose Immediate or Scheduled
  UI->>API: multipart (file, mode, runAt?)
  API->>E: submitUpload()
  E->>E: size ≤10MB? .xlsx? (413 / 415)
  alt mode = scheduled
    E->>X: parseWorkbook() – fail-fast header check
    E->>S: save file + ScheduledRun(runAt)
    E-->>UI: 200 scheduled
    Note over E: Scheduler tick (5s): runAt ≤ now → ingest()
  else mode = immediate
    E->>X: parseWorkbook()
    X-->>E: rows + row issues (or ExcelFormatError 422)
  end
  loop each valid row
    E->>D: findMatch(row, ALL historic records)
    alt MATCH (exact hash OR fuzzy ≥ threshold)
      D-->>E: original record id, score
      E->>S: original.DuplicateOccurrenceCount += 1 · DuplicateEvent
      E->>L: [WARNING] Duplicate suppressed → links to original JiraTicketID
      Note over E: NO Jira ticket, NO new record
    else UNIQUE
      E->>S: new record: AssignApprovalStatus='In Progress', ExecutionStatus='PENDING'
      E->>L: [SUCCESS] Staged for approval
    end
  end
  E->>L: [ERROR] per rejected row (invalid enum / email / missing field)
  E->>S: commit() → store.json + sync
  E-->>UI: summary {staged, duplicates, invalid, issues[]}
```

Because staged rows are added to the history *during* the loop, duplicates **within the same file** are also caught.

## 4. Human-in-the-loop review

```mermaid
stateDiagram-v2
  [*] --> InProgress: staged (unique)\nExecutionStatus=PENDING
  InProgress --> Approved: Approve → Jira OK\nPROJ-XXXX · PROCESSED · ProcessedAt
  InProgress --> InProgress: Approve → Jira error\nExecutionStatus=FAILED (Retry allowed)
  InProgress --> ChangedAssignee: Change Assignee\nReassignedToEmail · ReassignStatus=In Progress\n+ notification
  ChangedAssignee --> Approved: New assignee approves\nReassignStatus=Approved
  ChangedAssignee --> ChangedAssignee: Reassign again
  Approved --> [*]: reassignment permanently disabled (HTTP 409)
```

```mermaid
sequenceDiagram
  actor R as Reviewer
  participant UI as Pending table
  participant E as engine.ts
  participant J as jira.ts
  participant JC as Jira Cloud
  participant N as notify.ts
  participant S as store.ts
  alt Approve
    R->>UI: click Approve
    UI->>E: POST /records/:id/approve
    E->>E: guard: not already Approved, not in-flight (409)
    E->>J: createJiraIssue(record)
    J->>JC: GET /user/search (assignee, reporter accountIds)
    J->>JC: POST /rest/api/3/issue  (project = resolveProjectKey(ProjectKey))
    alt 429 / 5xx / timeout
      J->>J: retry ×3 with back-off (honours Retry-After)
    end
    JC-->>J: { key: "CCRD-1023" }
    J->>JC: POST /issue/CCRD-1023/attachments (each AttachmentPaths file)
    J-->>E: key + url + warnings
    E->>S: JiraTicketID, Approved, PROCESSED, ProcessedAt, processingMs → commit()
    E-->>UI: ✔ ticket created · reassignment locked
  else Jira failure (400/401/403/404/final 5xx)
    E->>S: ExecutionStatus=FAILED, lastError, stack → commit()
    E-->>UI: 422/502 + message · row shows FAILED + Retry
  else Change Assignee
    R->>UI: modal → new email (+ note)
    UI->>E: POST /records/:id/reassign
    E->>S: AssignApprovalStatus='Changed Assignee', ReassignStatus='In Progress', ReassignedToEmail
    E->>N: sendNotification(newAssignee)
    N-->>E: log + optional Teams/Slack webhook
    Note over E: Jira is NOT called yet – new assignee approves from "Reassigned" tab
  end
```

## 5. Background sync layer

```mermaid
flowchart TD
  A["commit() after any change"] --> B{SYNC_MODE}
  B -- none --> Z["local store.json only"]
  B -- other --> C["debounce 3s (coalesces bursts)"]
  C --> D["buildMasterWorkbook(all records)"]
  D --> E{target}
  E -- folder --> F["acquire .lock → write tmp → atomic rename"]
  E -- gdrive --> G["find by name → create or update (retry after 60 s on failure)"]
  E -- webhook --> H["POST JSON rows → Power Automate → SharePoint Excel"]
  F & G & H --> I["status ok / error → UI badge + [SUCCESS]/[ERROR] log"]
  I -- "changes arrived meanwhile" --> C
```

Design rule: **`data/store.json` is the system of record; sync is a one-way push of a derived 26-column master workbook.** Nothing is edited in the synced copy (see doc 05 for what that means for each target).

## 6. Status transition table (authoritative)

| Event | AssignApprovalStatus | ExecutionStatus | ReassignStatus | JiraTicketID | ProcessedAt | DuplicateOccurrenceCount |
|---|---|---|---|---|---|---|
| Unique row ingested | `In Progress` | `PENDING` | `None` | – | – | 0 |
| Duplicate row ingested | *(unchanged on original)* | *(unchanged)* | *(unchanged)* | *(unchanged)* | – | **original +1** |
| Approve OK | `Approved` | `PROCESSED` | `None` (or `Approved` if it was reassigned) | `PROJ-XXXX` | ISO time | – |
| Approve fails | unchanged | `FAILED` | unchanged | – | – | – |
| Change Assignee | `Changed Assignee` | unchanged | `In Progress` | – | – | – |
| Approve after reassignment | `Approved` | `PROCESSED` | `Approved` | `PROJ-XXXX` | ISO time | – |
| Reassign after approval | **rejected – HTTP 409** | | | | | |

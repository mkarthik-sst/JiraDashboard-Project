> **Revision note (current sample):** the sample file is now **5 dummy records in the revised 26-column layout**, each with a different mix of image / Word / Excel / web-link attachments (`attachments/samples/`). Expand any row in Pending Approvals or Reassigned to open the attachments before approving. The older 7-row sample described below (with duplicates) is available as `/api/template?sample=1&dup=1` (5 records + 1 duplicate). See the Word guide for the current screenshots.

# 06 · End-to-End User Execution Runbook & UI Blueprints

Real screenshots of the running app are in `docs/screenshots/` (01-dashboard, 02-reassign-modal, 03-live-logs, 04-approved-table). The ASCII blueprints below describe the same screens.

## 1. Data ingestion walkthrough

### 1.1 Get the file
Dashboard → **Template (.xlsx)** for a blank 26-column workbook, or **Sample data** for the ready-made test file below (`samples/CleanCore_Defects_SAMPLE_5records.xlsx`).

### 1.2 Realistic SAP defect rows (user-filled columns shown; system columns stay blank)

| # | ProjectKey | IssueType | Priority | Summary | Description (abridged) | Components | Assignee |
|--|--|--|--|--|--|--|--|
| 1 | SAP-CC | Bug | High | Table-to-CDS: MARA/MARC join replaced by I_Product loses plant-specific MRP type | `ZMM_MRP_OVERVIEW` joined MARA+MARC. After moving to CDS `I_Product` with association `_ProductPlant` the MRP type (DISMM) is blank for plants 1010/1020; association not exposed in projection `ZC_ProductMRP` | CDS,Table-to-CDS | cds.expert@ |
| 2 | P&G | Task | Medium | CFL: custom field ZZ_BATCH_ORIGIN not propagated from goods receipt to MATDOC | Field created in Custom Fields app for Material Document Item; entered in *Post Goods Receipt* but `MATDOC.ZZ_BATCH_ORIGIN` stays initial. Check field propagation for the business context | CFL | cfl.owner@ |
| 3 | SAP-CC | Bug | Low | AMF syntax failure: missing period after DEFINE ROLE in ZAMF_AUTH_SALES | Activation fails: "The statement DEFINE ROLE must end with a period" at line 17; introduced by the ADT formatter | AMF | amf.engineer@ |
| 4 | SAP-CC | Bug | High | ABAP dump ASSIGN_CASTING_ILLEGAL_CAST in ZCL_CC_FIELD_MAPPER=>MAP_STRUCTURE | Runtime error when assigning `ls_vbap` to `<ls_target>` typed with new CDS structure; MATNR length 18 → 40 after conversion. Attachment `./logs/st22_cast.txt` | ABAP | dev.lead@ |
| 5 | SAP-CC | Bug | High | CDS view  ZI_SalesDocItem returns **DUPLICATE** rows after VBAP replacement | *(same text as existing CCRD-1001, different case, double space, "Observed 2026-10-26")* | | cds.expert@ |
| 6 | SAP-CC | Bug | High | ABAP dump TIME_OUT in ZCL_MIG_MATDOC_READER=>READ_MKPF … | *(existing CCRD-1002 text + one extra sentence "Also seen in QA.")* | | dev.lead@ |
| 7 | SAP-CC | Bug | **Urgent** | Invalid demo row – will be rejected | Priority `Urgent` and assignee `not-an-email` are intentionally wrong | | `not-an-email` |

Expected result of uploading this file against the demo data: **7 rows read → 4 staged, 2 duplicates suppressed (table rows 5 and 6 → *fuzzy 99 %* against CCRD-1001 and *fuzzy 95 %* against CCRD-1002), 1 invalid (2 issues)**. (This is asserted by the automated test suite.)

### 1.3 Upload
1. Drag the file onto the upload zone (or click to browse).
2. Choose **Immediate** (process now) or **Scheduled** (pick date/time; the file is validated *now*, ingested at that time – even if you close the browser, as long as the app is running).
3. Click **Upload & process**.

## 2. What happens behind the scenes (actual log output)

```
11:11:29 [ERROR]   sample.xlsx row 8 rejected: Priority 'Urgent' invalid; allowed: High, Medium, Low; AssigneeEmail 'not-an-email' is not a valid email
11:11:29 [SUCCESS] Staged for approval: "Table-to-CDS: MARA/MARC join replaced by I_Product loses plant-specific MRP type" (sample.xlsx row 2)
11:11:29 [SUCCESS] Staged for approval: "CFL: custom field ZZ_BATCH_ORIGIN not propagated from goods receipt to MATDOC" (sample.xlsx row 3)
11:11:29 [SUCCESS] Staged for approval: "AMF syntax failure: missing period after DEFINE ROLE in ZAMF_AUTH_SALES" (sample.xlsx row 4)
11:11:29 [SUCCESS] Staged for approval: "ABAP dump ASSIGN_CASTING_ILLEGAL_CAST in ZCL_CC_FIELD_MAPPER=>MAP_STRUCTURE" (sample.xlsx row 5)
11:11:29 [WARNING] Duplicate suppressed (fuzzy 99%): "CDS view ZI_SalesDocItem returns DUPLICATE rows after VBAP replacemen" matches CCRD-1001; DuplicateOccurrenceCount=3
11:11:29 [WARNING] Duplicate suppressed (fuzzy 95%): "ABAP dump TIME_OUT in ZCL_MIG_MATDOC_READER=>READ_MKPF after MATDOC CD" matches CCRD-1002; DuplicateOccurrenceCount=1
11:11:29 [WARNING] Ingested sample.xlsx: 4 staged, 2 duplicates suppressed, 1 invalid row(s)
11:11:29 [INFO]    Dispatching Jira create for "Table-to-CDS: BSEG replacement via I_JournalEntryItem loses currency a" -> assignee cds.expert@smartshift.com
11:11:30 [SUCCESS] Jira ticket CCRD-2001 created (701ms) - reassignment locked
```

### State-by-state

| Step | User action | System behaviour | Data change |
|---|---|---|---|
| 1 | Upload | Size/extension check → parse → header check (all 19) | – |
| 2 | – | Per-row validation (enums, emails, required, path guard) | invalid rows reported, not stored |
| 3 | – | Dedup against **all** historic records (+ rows staged earlier in the same file) | – |
| 4a | – | Match → no ticket; original `DuplicateOccurrenceCount += 1`; `DuplicateEvent` with link to original `JiraTicketID`; `[WARNING]` | original record updated |
| 4b | – | Unique → new record `AssignApprovalStatus='In Progress'`, `ExecutionStatus='PENDING'` | record appended |
| 5 | – | `store.json` written atomically; sync scheduled (3 s debounce) | master workbook pushed |
| 6 | Click **Approve** | Jira lookup of assignee/reporter → `POST /rest/api/3/issue` → attachments | `JiraTicketID=CCRD-xxxx`, `Approved`, `PROCESSED`, `ProcessedAt`, latency stored |
| 6′ | Approve fails | 429/5xx retried ×3; 4xx surfaced verbatim | `ExecutionStatus='FAILED'`, `lastError` + stack; row shows **Retry** |
| 7 | **Change Assignee** | New email validated (not same, not empty) → notification | `Changed Assignee`, `ReassignStatus='In Progress'`, `ReassignedToEmail` |
| 8 | New assignee approves (Reassigned tab) | Jira issue assigned to the **new** person | `ReassignStatus='Approved'`, `Approved`, `PROCESSED` |
| 9 | Try to reassign an approved record | HTTP 409 – "Reassignment is permanently disabled after approval." | none |

### Common error messages & what to do

| Message | Cause | Fix |
|---|---|---|
| `Missing required header(s): IssueType, …` | Header renamed/deleted | Re-download the template; copy rows into it |
| `File is not a readable .xlsx workbook` | CSV renamed, corrupt, password-protected | Re-save as *Excel Workbook (.xlsx)* without a password |
| `Only .xlsx workbooks are supported.` (415) | Wrong extension | Save as .xlsx |
| `Row N rejected: Priority 'Urgent' invalid…` | Bad enum/email | Fix the row and re-upload (valid rows already staged are de-duplicated, so re-uploading the whole file is safe) |
| `Jira authentication failed` (401) | Wrong token/email | `JIRA_EMAIL` / `JIRA_API_TOKEN` |
| `Jira permission denied` (403) | Service account lacks *Create Issues* | Grant project role |
| `Jira … Component name 'CFL' is not valid` (400) | Component absent in the Jira space | Create it or fix the sheet; click **Retry** |
| `Assignee x@y was not found in Jira` | Email not a Jira user | **Change Assignee** to a valid user |
| `Jira rate limit hit` (429 after 3 tries) | Burst approvals | Wait a minute → **Retry** |

## 3. Visual UI blueprints

### Screen 1 – Main Ingestion & Metric Dashboard

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🛡 CleanCore Defect Hub                                                      ☁ Sync: folder · ok · 09:41 │
│ ≡ Spaces / CS Clean Core / R&D  [Jira LIVE]  [project CCRD]                              [ Sync now ]    │
├──────────────────────────┬──────────────────────────┬──────────────────────────┬─────────────────────────┤
│ ◔ PENDING APPROVALS      │ ✔ APPROVED / JIRA CREATED│ 📅 SCHEDULED RUNS        │ ⧉ PREVENTED DUPLICATES  │
│   10                     │   4                      │   1                      │   4                     │
│   1 reassigned · 1 failed│   Jira tickets generated │   queued ingestions      │   tickets suppressed    │
├──────────────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│ INGESTION GATEWAY        [⬇ Template] [▤ Sample data]│ DEDUPLICATION AUDIT            fuzzy threshold 90% │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │ ⚠ 2 duplicates suppressed in sample.xlsx …        │
│   ☁↑  Drop the filled 26-column .xlsx here          │ └───────────────────────────────────────────────────┘
│       or click to browse      Max 10 MB · 5,000 rows│ ABAP dump TIME_OUT in ZCL_MIG_…        [fuzzy 95%]│
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │ Linked to CCRD-1002 · count now 1 · row 7         │
│ ( ⚡Immediate | 📅Scheduled )  Run at [2026-10-28 18:00]│ CDS view ZI_SalesDocItem … DUPLICATE   [fuzzy 99%]│
│                                    [ ⬆ Upload & process ]│ Linked to CCRD-1001 · count now 3 · row 6         │
│ ┌ sample.xlsx: 7 rows read ───────────────────────────┐│                                                   │
│ │ 4 staged · 2 duplicates suppressed · 1 invalid       ││                                                   │
│ │ ▸ Row errors (2)                                      ││                                                   │
│ └──────────────────────────────────────────────────────┘│                                                   │
├──────────────────────────────────────────────────────┴───────────────────────────────────────────────────┤
│ SCHEDULED INGESTION RUNS                                                                                  │
│ Q4_defects.xlsx   28 Oct 2026, 18:00   [SCHEDULED]                                           [ Cancel ]  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                      ( >_ Live logs ② )
```

### Screen 2 – Pending Approval Queue & Reassignment Modal

```
┌─ [ Pending Approvals (10) ] ─ Reassigned (1) ─ Approved Records (4) ─────────────────────────────────────┐
│    DEFECT                          PROJECT  PRIORITY  ASSIGNEE            DUPS  STATUS        ACTIONS      │
│ ▸ Table-to-CDS: BSEG replace…      [SAP-CC] [High]    cds.expert@…         0   [In Progress] [✔ Approve] [👤 Reassign]
│ ▸ ABAP dump ITAB_DUPLICATE_KEY…    [P&G]    [High]    dev.lead@…           0   [In Progress] [✔ Approve] [👤 Reassign]
│ ▸ CFL: BAdI not triggered in…      [SAP-CC] [Medium]  cfl.owner@…          0   [In Progress] [✔ Approve] [👤 Reassign]
│ ▾ ABAP dump DBIF_RSQL_INVALID…     [SAP-CC] [High]    dev.lead@…           0   [FAILED]      [↻ Retry]   [👤 Reassign]   ← red row
│   ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │ Open SQL statement with JOIN on I_ProductPlantBasic and COUNT( DISTINCT ) raises …             │   │
│   │ Reporter: qa.analyst@… · Lead: Anita Rao · Labels: abap-dump sql · Source: seed.xlsx row 13      │   │
│   │ ⓘ Last Jira error: Jira rate limit hit - HTTP 429 after 3 attempts   (stack trace)            │   │
│   └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘

        ┌──────────────────────── Change Assignee ───────────────────────── ✕ ┐
        │ The new assignee is notified and must approve the ticket.            │
        │ ┌──────────────────────────────────────────────────────────────────┐ │
        │ │ ABAP dump ITAB_DUPLICATE_KEY in ZCL_CC_PRICE_LOADER=>BUILD_BUFFER│ │
        │ │ Current assignee: dev.lead@smartshift.com · High · P&G           │ │
        │ └──────────────────────────────────────────────────────────────────┘ │
        │ New assignee email   [ senior.cfl@smartshift.com        ▾ suggestions]│
        │ Note (optional)      [ CFL specialist needed                        ]│
        │                                    [ Cancel ] [ 👤 Reassign & notify ]│
        └───────────────────────────────────────────────────────────────────────┘
   field highlights: invalid email → red hint under the field; same-as-current → "Same as the current assignee."; button disabled until valid
```

### Screen 3 – Deduplication Alert & Execution Logs

```
┌ DEDUPLICATION AUDIT ───────────────────────────────────────────┐   ┌ LIVE OBSERVABILITY ●  ─────────────── ✕ ┐
│ ┌ ⚠ ─────────────────────────────────────────────────────────┐ │   │ [ALL][SUCCESS][WARNING][ERROR][INFO] 12 lines│
│ │ 2 duplicates suppressed in sample.xlsx. No Jira tickets were│ │   ├──────────────────────────────────────────────┤
│ │ created for them; original occurrence counts incremented.   │ │   │11:11:29 [ERROR]   sample.xlsx row 8 rejected:│
│ └─────────────────────────────────────────────────────────────┘ │   │         Priority 'Urgent' invalid; …       ▸│
│ ┌─────────────────────────────────────────────────────────────┐ │   │11:11:29 [SUCCESS] Staged for approval:       │
│ │ ABAP dump TIME_OUT in ZCL_MIG_MATDOC_READER=>READ_… [fuzzy 95%]│ │   │         "Table-to-CDS: MARA/MARC join …"    │
│ │ Linked to CCRD-1002 · count now 1 · sample.xlsx row 7        │ │   │11:11:29 [WARNING] Duplicate suppressed       │
│ └─────────────────────────────────────────────────────────────┘ │   │         (fuzzy 99%): "CDS view ZI_Sales…"    │
│ ┌─────────────────────────────────────────────────────────────┐ │   │         matches CCRD-1001;                   │
│ │ CDS view ZI_SalesDocItem … DUPLICATE rows…  [fuzzy 99%]      │ │   │         DuplicateOccurrenceCount=3           │
│ │ Linked to CCRD-1001 · count now 3 · sample.xlsx row 6        │ │   │11:11:30 [SUCCESS] Jira ticket CCRD-2001      │
│ └─────────────────────────────────────────────────────────────┘ │   │         created (701ms) - reassignment locked│
└─────────────────────────────────────────────────────────────────┘   │11:12:02 [ERROR]   Jira create failed … 429 ▾ │
                                                                      │   JiraError: Jira rate limit hit             │
                                                                      │     at toJiraError (src/lib/jira.ts:…)       │
                                                                      └──────────────────────────────────────────────┘
```

### Screen 4 – Approved Records Audit Table

```
┌─ Pending Approvals (9) ─ Reassigned (1) ─ [ Approved Records (5) ] ──────────────────────────────────────┐
│ [🔍 Search summary, Jira ID, assignee…        ] [All priorities ▾] [All projects ▾] [⬇ Export Approved] [⬇ Export All]
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ JIRA ID ⬇   SUMMARY                         PROJECT  PRIORITY  ASSIGNEE        PROCESSED ▼   LATENCY DUPS STATUS    │
│ CCRD-2001 ↗ Table-to-CDS: BSEG replacement… [SAP-CC] [High]    cds.expert@…    27 Oct, 11:11  0.70s   0  [PROCESSED]│
│ CCRD-1004 ↗ AMF syntax failure: unexpected… [SAP-CC] [Low]     amf.engineer@…  27 Oct, 07:46  1.01s   0  [PROCESSED]│
│ CCRD-1003 ↗ CFL: custom field ZZ_REGION…    [P&G]    [Medium]  cfl.owner@…     27 Oct, 06:46  0.87s   0  [PROCESSED]│
│ CCRD-1002 ↗ ABAP dump TIME_OUT in ZCL_MIG…  [SAP-CC] [High]    dev.lead@…      27 Oct, 05:46  0.94s   1  [PROCESSED]│
│ CCRD-1001 ↗ CDS view ZI_SalesDocItem …      [SAP-CC] [High]    cds.expert@…    27 Oct, 04:46  1.18s   3  [PROCESSED]│
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 5 record(s) · avg Jira latency 0.94s                  [10 / page ▾]  [◀]  Page 1 / 1  [▶]               │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
  ↗ = link to {JIRA_BASE_URL}/browse/CCRD-xxxx (opens in the system browser from the desktop app)
```

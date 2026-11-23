# 04 · The 19-Column Excel Contract (revised template)

Source of truth: `src/lib/schema.ts` (`COLUMNS`). The template downloaded from the dashboard (**Template (.xlsx)**) is identical to your `Revised_file.xlsx` layout.

Header colours in the template: **blue** = you fill, **teal** = reference only (never sent to Jira), **grey** = system managed.

| # | Header | Who | Sent to Jira? | Rules / example |
|---|---|---|---|---|
| 1 | `Customer` | You | **No – reference only** | Shown on the dashboard. e.g. `Orica` |
| 2 | `Project key` | You | Yes (`project.key`) | Jira space key, **required**. e.g. `JAIT` |
| 3 | `Project name` | You | No – reference only | e.g. `Jira Automate Ignite Testing` |
| 4 | `Project type` | You | No – reference only | e.g. `software` |
| 5 | `Summary` | You | Yes | Required, max 255 chars |
| 6 | `Description` | You | Yes (ADF) | Required |
| 7 | `Issue Type` | You | Yes | Required; must exist in the space (Bug, Task, Story, Epic…). Drop-down is a *suggestion* – other values are accepted |
| 8 | `Project lead` | You | Yes – description header (or custom field `JIRA_LEAD_FIELD`) | Free text |
| 9 | `Priority` | You | Yes | Required; free text, must match a Jira priority name, e.g. `High Attention`. If Jira refuses it the ticket is still created without it and a warning is logged (`JIRA_LENIENT_FIELDS`) |
| 10 | `Assignee Email` | You | Yes (`assignee.accountId`) | **Email or Jira display name**. Required |
| 11 | `Reporter Email` | You | Yes (`reporter.accountId`) | Email or display name. Required |
| 12 | `AssignApprovalStatus` | System | – | `In Progress` → `Changed Assignee` → `Approved` |
| 13 | `AttachmentPaths` | You | Files are attached; links are added to the description | Pipe-separated, see below |
| 14 | `JiraTicketID` | System | – | Set on approval, e.g. `JAIT-1023` |
| 15 | `ExecutionStatus` | System | – | `PENDING` / `PROCESSED` / `FAILED` |
| 16 | `ProcessedAt` | System | – | ISO timestamp of ticket creation |
| 17 | `DuplicateOccurrenceCount` | System | – | +1 for each suppressed duplicate |
| 18 | `ReassignedToEmail` | System | – | Set by Change Assignee |
| 19 | `ReassignStatus` | System | – | `None` → `In Progress` → `Approved` |

Required headers for parsing: `Project key, Summary, Description, Issue Type, Priority, Assignee Email, Reporter Email`. The other headers are optional. Header names are matched tolerantly (case, spaces, `ProjectKey` = `Project key`). Values typed into system columns are ignored and reset, so a spreadsheet can never forge a Jira ID or an approval.

## AttachmentPaths – how files and images are linked to each record

One cell, entries separated by `|`. Each entry can be:

| Style | Example | What the app does |
|---|---|---|
| **File name uploaded with the workbook** (recommended for ad-hoc use) | `st22_dump.png\|analysis.docx` | Pick the files in the **Attachment files** box next to the workbook on the dashboard. Matching is by file name. |
| **Path on the server** (relative to `ATTACHMENT_ROOT`) | `attachments/samples/st22_cast_dump.png` | File is copied into the upload's own folder. Good for a shared evidence folder. `..` is rejected. |
| **Web link** (GitHub, SharePoint, Confluence…) | `https://github.com/org/repo/blob/main/evidence.xlsx` | Kept as a link. Shown as a clickable chip; added as a link in the Jira description. |

Every file is copied to `DATA_DIR/attachments/<uploadId>/`, shown in the dashboard for review (images as thumbnails; Word/Excel download), committed to GitHub when storage mode is on, and uploaded to the Jira ticket (`POST /issue/{key}/attachments`) on **Approve**. A missing file never blocks the row: it is flagged "file not found" and a warning is logged.

## Parser failure modes

| Situation | Result |
|---|---|
| Not a real .xlsx / corrupt / password-protected | HTTP 422 with explanation |
| A required header missing | HTTP 422 `Missing required header(s): …` with expected and found headers |
| Unknown / duplicate header | Warning only (first occurrence wins) |
| Row-level problem (blank required field, bad email/name, `..` in a path) | That row is rejected and listed in "Row errors"; the other rows continue |
| More than 5,000 rows / 10 MB | HTTP 422 / 413 |

## v2.4.0 additions (columns 20 – 26)

| # | Column | Who fills it | Notes |
|---|---|---|---|
| 20 | `Automated fix issue` | Reporter | `Yes` / `No` dropdown. `Yes` switches on the engineering rules below. |
| 21 | `Fix / Rule ID` | Reporter | e.g. `FIX-CAST-007` – the key of the Recurrence report. |
| 22 | `Root cause` | Reporter / assignee | Human-entered analysis. |
| 23 | `Impact` | Reporter / assignee | What breaks for the customer. |
| 24 | `Prerequisites` | Reporter / assignee | What must be in place before the fix / re-test. |
| 25 | `Dependent data sources` | Reporter / assignee | Tables, CDS views, interfaces involved. |
| 26 | `CancelReason` | System | Filled when an entry is cancelled. |

Old 19-column files still upload (a warning is shown; the entries are treated as ordinary defects). Columns 20-25 are mandatory before approval for flagged defects (`ENGINEERING_REQUIRE_MODE=flagged`, or `all` / `off`; the list is `ENGINEERING_REQUIRED_FIELDS`).

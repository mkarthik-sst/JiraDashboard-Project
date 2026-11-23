/**
 * SINGLE SOURCE OF TRUTH for the revised 26-column Excel contract (Revised_file.xlsx layout).
 * Edit this file to rename headers, change which columns are required, or tighten validation.
 *
 *  - "reference" columns (Customer, Project name, Project type) are kept for the team's reference ONLY:
 *    they are stored and shown on the dashboard but are NEVER sent to Jira.
 *  - "system" columns are written by the application; values typed by users are ignored.
 */
export const COLUMNS = [
  "Customer", "Project key", "Project name", "Project type", "Summary", "Description", "Issue Type", "Project lead",
  "Priority", "Assignee Email", "Reporter Email", "AssignApprovalStatus", "AttachmentPaths", "JiraTicketID",
  "ExecutionStatus", "ProcessedAt", "DuplicateOccurrenceCount", "ReassignedToEmail", "ReassignStatus",
  "Automated fix issue", "Fix / Rule ID", "Root cause", "Impact", "Prerequisites", "Dependent data sources", "CancelReason",
] as const;
export type ColumnName = (typeof COLUMNS)[number];

/** Spreadsheet header -> property name on DefectRow. */
export const FIELD: Record<ColumnName, keyof DefectRow> = {
  "Customer": "Customer", "Project key": "ProjectKey", "Project name": "ProjectName", "Project type": "ProjectType",
  "Summary": "Summary", "Description": "Description", "Issue Type": "IssueType", "Project lead": "Lead",
  "Priority": "Priority", "Assignee Email": "AssigneeEmail", "Reporter Email": "ReporterEmail",
  "AssignApprovalStatus": "AssignApprovalStatus", "AttachmentPaths": "AttachmentPaths", "JiraTicketID": "JiraTicketID",
  "ExecutionStatus": "ExecutionStatus", "ProcessedAt": "ProcessedAt", "DuplicateOccurrenceCount": "DuplicateOccurrenceCount",
  "ReassignedToEmail": "ReassignedToEmail", "ReassignStatus": "ReassignStatus",
  "Automated fix issue": "AutomatedFix", "Fix / Rule ID": "FixRuleId", "Root cause": "RootCause", "Impact": "Impact",
  "Prerequisites": "Prerequisites", "Dependent data sources": "DependentSources", "CancelReason": "CancelReason",
};

/** Header aliases accepted on upload (matched case-insensitively, ignoring spaces/underscores/punctuation). */
const ALIASES: Record<string, ColumnName> = {
  projectkey: "Project key", key: "Project key", projectname: "Project name", projecttype: "Project type",
  issuetype: "Issue Type", type: "Issue Type", projectlead: "Project lead", lead: "Project lead",
  assigneeemail: "Assignee Email", assignee: "Assignee Email", reporteremail: "Reporter Email", reporter: "Reporter Email",
  attachmentpaths: "AttachmentPaths", attachments: "AttachmentPaths", attachmentpath: "AttachmentPaths",
  automatedfix: "Automated fix issue", automatedfixissue: "Automated fix issue", fixruleid: "Fix / Rule ID", fixid: "Fix / Rule ID", ruleid: "Fix / Rule ID", fix: "Fix / Rule ID",
  rootcause: "Root cause", impactanalysis: "Impact", dependentdatasources: "Dependent data sources", dependentsources: "Dependent data sources", prerequisite: "Prerequisites",
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const CANON = new Map<string, ColumnName>(COLUMNS.map((c) => [norm(c), c]));
export function canonicalHeader(raw: string): ColumnName | undefined {
  const k = norm(raw);
  return CANON.get(k) ?? ALIASES[k];
}

export const REFERENCE_COLUMNS: ColumnName[] = ["Customer", "Project name", "Project type"];
export const SYSTEM_COLUMNS: ColumnName[] = ["AssignApprovalStatus", "JiraTicketID", "ExecutionStatus", "ProcessedAt", "DuplicateOccurrenceCount", "ReassignedToEmail", "ReassignStatus", "CancelReason"];
/** Engineering-feedback columns (optional; they travel to Jira in an "Engineering feedback" section). */
export const ENGINEERING_COLUMNS: ColumnName[] = ["Automated fix issue", "Fix / Rule ID", "Root cause", "Impact", "Prerequisites", "Dependent data sources"];
/** Headers that MUST exist in an uploaded file. Everything else is optional (missing => default). */
export const REQUIRED_USER_COLUMNS: ColumnName[] = ["Project key", "Summary", "Description", "Issue Type", "Priority", "Assignee Email", "Reporter Email"];

export const APPROVAL_STATUSES = ["In Progress", "Approved", "Changed Assignee", "Reporter Review", "Cancelled"] as const;
export const EXECUTION_STATUSES = ["PENDING", "PROCESSED", "FAILED", "CANCELLED"] as const;
export const YES_NO = ["No", "Yes"] as const;
export const REASSIGN_STATUSES = ["None", "In Progress", "Approved"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type ReassignStatus = (typeof REASSIGN_STATUSES)[number];

/** The spreadsheet fields (19 original columns + 7 engineering-feedback / cancel columns). */
export interface DefectRow {
  Customer: string; ProjectKey: string; ProjectName: string; ProjectType: string;
  Summary: string; Description: string; IssueType: string; Lead: string; Priority: string;
  AssigneeEmail: string; ReporterEmail: string;
  AssignApprovalStatus: ApprovalStatus; AttachmentPaths: string; JiraTicketID: string;
  ExecutionStatus: ExecutionStatus; ProcessedAt: string; DuplicateOccurrenceCount: number;
  ReassignedToEmail: string; ReassignStatus: ReassignStatus;
  AutomatedFix: "Yes" | "No"; FixRuleId: string; RootCause: string; Impact: string; Prerequisites: string; DependentSources: string; CancelReason: string;
}

/** One entry of the AttachmentPaths column after resolution (see attachments.ts). */
export interface AttachmentInfo {
  raw: string; name: string; kind: "file" | "url";
  category: "image" | "word" | "excel" | "pdf" | "powerpoint" | "text" | "other" | "link";
  exists: boolean; size: number; setId: string;
  href: string;          // what the dashboard opens (served copy or the external URL)
  drivePath: string;     // path inside the Google Drive shared folder (file kind)
  driveUrl: string;      // browser URL of the file in Google Drive (filled in once it has been copied there)
  note: string;          // e.g. "file not found"
}

/** One line of a record's activity trail (shown on the dashboard, kept in the state snapshot). */
export interface HistoryEntry {
  id: string; at: string; by: string;
  kind: "uploaded" | "edited" | "documents" | "returned" | "resubmitted" | "reassigned" | "approved" | "cancelled";
  note?: string; changes?: { field: string; from: string; to: string }[];
}

/** Stored record = spreadsheet row + internal metadata (never written to Excel). */
export interface DefectRecord extends DefectRow {
  history?: HistoryEntry[]; uploadedBy?: string;
  id: string; fingerprint: string; sourceFile: string; sourceRow: number; uploadId: string;
  createdAt: string; lastError: string; lastErrorStack: string; lastWarning: string; jiraUrl: string; processingMs: number;
  attachments: AttachmentInfo[];
}

export const COLUMN_HELP: Record<ColumnName, string> = {
  "Customer": "REFERENCE ONLY. Shown on the dashboard, never sent to Jira.",
  "Project key": "Jira space (project) key, e.g. JAIT. Required. Optional aliasing via JIRA_PROJECT_MAP.",
  "Project name": "Reference only (e.g. Jira Automate Ignite Testing). Not sent to Jira.",
  "Project type": "Reference only (e.g. software). Not sent to Jira.",
  "Summary": "Short ticket title (max 255 chars). Required.",
  "Description": "Full defect description incl. dump text / object names. Required.",
  "Issue Type": "Must exist in the Jira space, e.g. Bug, Task, Story, Epic. Required.",
  "Project lead": "Free text; added to the ticket description header (or a custom field via JIRA_LEAD_FIELD).",
  "Priority": "Must match a priority name in your Jira, e.g. High Attention, Medium, Low. Required.",
  "Assignee Email": "Jira user's email OR display name. Required.",
  "Reporter Email": "Jira user's email OR display name. Required.",
  "AssignApprovalStatus": "System managed. Leave 'In Progress'.",
  "AttachmentPaths": "Pipe-separated. Each entry = file name uploaded with this file, a path on the server, or an https:// link. e.g. error.png|analysis.docx|https://...",
  "JiraTicketID": "System managed. Auto-populated on approval.",
  "ExecutionStatus": "System managed: PENDING / PROCESSED / FAILED.",
  "ProcessedAt": "System managed ISO timestamp.",
  "DuplicateOccurrenceCount": "System managed. +1 per suppressed duplicate.",
  "ReassignedToEmail": "System managed. Set by Change Assignee.",
  "ReassignStatus": "System managed: None / In Progress / Approved.",
  "Automated fix issue": "Yes when the defect was caused by one of our automated fixes (it is then routed to product engineering). No (or blank) otherwise.",
  "Fix / Rule ID": "ID or name of the automated fix / rule involved, e.g. FIX-VBAP-014. Used by the recurrence report.",
  "Root cause": "Why it happened (analysis result). Mandatory before approval when the defect is an automated-fix issue.",
  "Impact": "What is affected: objects, systems, users, data. Mandatory before approval for automated-fix issues.",
  "Prerequisites": "What was needed / checked before the fix ran (notes, transports, config). Mandatory before approval for automated-fix issues.",
  "Dependent data sources": "Other tables, CDS views, interfaces or systems the defect depends on. Mandatory before approval for automated-fix issues.",
  "CancelReason": "System managed. Reason entered when the entry was cancelled.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_SUMMARY = 255;
export const MAX_DESCRIPTION = 32000;

export interface RowIssue { row: number; column: string; message: string }

/** Accepts an email OR a display name (names are resolved against Jira users at approval time). */
export function isUserRef(v: string): boolean {
  const t = v.trim();
  if (!t) return false;
  return t.includes("@") ? EMAIL_RE.test(t) : t.length >= 2 && t.length <= 120;
}
export const isEmail = (v: string) => EMAIL_RE.test(v.trim());
const userRef = (v: string) => (v.includes("@") ? v.trim().toLowerCase() : v.trim());

/** Validates + normalises one user row. System columns are ignored and reset so uploads can't forge Jira IDs/statuses. */
export function validateRow(
  raw: Partial<Record<ColumnName, string>>, rowNumber: number,
): { row?: DefectRow; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const g = (c: ColumnName) => (raw[c] ?? "").toString().trim();
  const add = (column: string, message: string) => issues.push({ row: rowNumber, column, message });

  for (const c of REQUIRED_USER_COLUMNS) if (!g(c)) add(c, "is required");
  if (g("Summary").length > MAX_SUMMARY) add("Summary", `exceeds ${MAX_SUMMARY} characters`);
  if (g("Description").length > MAX_DESCRIPTION) add("Description", `exceeds ${MAX_DESCRIPTION} characters`);
  if (g("Issue Type").length > 60) add("Issue Type", "is too long");
  if (g("Priority").length > 60) add("Priority", "is too long");
  for (const c of ["Assignee Email", "Reporter Email"] as const)
    if (g(c) && !isUserRef(g(c))) add(c, `'${g(c)}' is neither a valid email nor a user name`);
  if (g("Project key") && /[\r\n]/.test(g("Project key"))) add("Project key", "must be a single line");
  const af = g("Automated fix issue").toLowerCase();
  if (af && !/^(yes|y|true|1|no|n|false|0)$/.test(af)) add("Automated fix issue", `'${g("Automated fix issue")}' must be Yes or No`);
  if (g("Fix / Rule ID").length > 120) add("Fix / Rule ID", "is too long (max 120 characters)");
  for (const c of ["Root cause", "Impact", "Prerequisites", "Dependent data sources"] as const) if (g(c).length > 4000) add(c, "exceeds 4000 characters");
  for (const p of g("AttachmentPaths").split("|").map((s) => s.trim()).filter(Boolean))
    if (!/^https?:\/\//i.test(p) && p.split(/[\\/]/).includes("..")) add("AttachmentPaths", `'${p}' must not contain '..'`);
  if (issues.length) return { issues };

  return {
    issues,
    row: {
      Customer: g("Customer"), ProjectKey: g("Project key"), ProjectName: g("Project name"), ProjectType: g("Project type"),
      Summary: g("Summary"), Description: g("Description"), IssueType: g("Issue Type"), Lead: g("Project lead"), Priority: g("Priority"),
      AssigneeEmail: userRef(g("Assignee Email")), ReporterEmail: userRef(g("Reporter Email")),
      AssignApprovalStatus: "In Progress", AttachmentPaths: g("AttachmentPaths"), JiraTicketID: "",
      ExecutionStatus: "PENDING", ProcessedAt: "", DuplicateOccurrenceCount: 0, ReassignedToEmail: "", ReassignStatus: "None",
      AutomatedFix: /^(yes|y|true|1)$/.test(af) ? "Yes" : "No", FixRuleId: g("Fix / Rule ID"), RootCause: g("Root cause"), Impact: g("Impact"),
      Prerequisites: g("Prerequisites"), DependentSources: g("Dependent data sources"), CancelReason: "",
    },
  };
}

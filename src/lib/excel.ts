/** Excel template generation, strict parsing of the 26-column workbook, and master / per-upload tracking workbooks. */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { getConfig } from "./config";
import { driveLinkOf } from "./drive";
import {
  COLUMNS, COLUMN_HELP, FIELD, REFERENCE_COLUMNS, SYSTEM_COLUMNS, ENGINEERING_COLUMNS, REQUIRED_USER_COLUMNS, APPROVAL_STATUSES, EXECUTION_STATUSES, REASSIGN_STATUSES, YES_NO,
  canonicalHeader, validateRow, type ColumnName, type DefectRow, type DefectRecord, type RowIssue,
} from "./schema";
import type { DuplicateEvent, UploadSummary } from "./types";
import type { RecurrenceRow } from "./engineering";

export const SHEET_NAME = "Defects";

export class ExcelFormatError extends Error {
  constructor(message: string, public details: string[] = []) { super(message); this.name = "ExcelFormatError"; }
}

const list = (vals: readonly string[], strict: boolean) => ({
  type: "list" as const, allowBlank: true, formulae: [`"${vals.join(",").replace(/"/g, "")}"`],
  showErrorMessage: true, errorStyle: strict ? ("stop" as const) : ("warning" as const),
  errorTitle: "Value not in the list", error: "This value is not in the suggested list. Continue only if it exists in your Jira.",
});

function styleHeader(ws: ExcelJS.Worksheet) {
  const h = ws.getRow(1);
  h.height = 26;
  COLUMNS.forEach((name, idx) => {
    const c = h.getCell(idx + 1);
    const fill = REFERENCE_COLUMNS.includes(name) ? "FF0F766E" : SYSTEM_COLUMNS.includes(name) ? "FF64748B" : ENGINEERING_COLUMNS.includes(name) ? "FF7C3AED" : "FF1D4ED8";
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.note = COLUMN_HELP[name];
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  const widths = [16, 12, 28, 12, 44, 64, 12, 18, 16, 26, 26, 20, 40, 14, 15, 24, 12, 26, 14, 14, 22, 40, 40, 40, 36, 30];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

function addValidations(ws: ExcelJS.Worksheet, rows = 500) {
  const col = (n: ColumnName) => COLUMNS.indexOf(n) + 1;
  const j = getConfig().jira;
  const maps: [ColumnName, readonly string[], boolean][] = [
    ["Issue Type", j.issueTypes, false], ["Priority", j.priorities, false],
    ["AssignApprovalStatus", APPROVAL_STATUSES, true], ["ExecutionStatus", EXECUTION_STATUSES, true], ["ReassignStatus", REASSIGN_STATUSES, true], ["Automated fix issue", YES_NO, true],
  ];
  for (let r = 2; r <= rows + 1; r++) for (const [n, vals, strict] of maps) ws.getCell(r, col(n)).dataValidation = list(vals, strict);
}

const toCell = (row: DefectRow | DefectRecord): (string | number)[] =>
  COLUMNS.map((h) => (row as unknown as Record<string, string | number>)[FIELD[h]] ?? "");

export function exampleRow(): DefectRow {
  return {
    Customer: "Acme Corp", ProjectKey: "JAIT", ProjectName: "Jira Automate Ignite Testing", ProjectType: "software",
    Summary: "CDS view ZI_SalesDocItem returns duplicate rows after VBAP replacement",
    Description: "After replacing direct VBAP access with CDS view ZI_SalesDocItem the item count doubles for orders with schedule lines.",
    IssueType: "Bug", Lead: "Alex Morgan", Priority: "High Attention", AssigneeEmail: "alex.morgan@acme-demo.com", ReporterEmail: "sam.lee@acme-demo.com",
    AssignApprovalStatus: "In Progress", AttachmentPaths: "st22_dump.png|analysis.docx", JiraTicketID: "", ExecutionStatus: "PENDING", ProcessedAt: "",
    DuplicateOccurrenceCount: 0, ReassignedToEmail: "", ReassignStatus: "None",
    AutomatedFix: "Yes", FixRuleId: "FIX-VBAP-014", RootCause: "Automated fix joined VBAP to schedule lines without restricting on ETENR.", Impact: "Item counts double for orders with schedule lines (about 4% of sales orders).",
    Prerequisites: "Transport K9X0042 imported; CDS view ZI_SalesDocItem active.", DependentSources: "Tables VBAP, VBEP; CDS view I_SalesDocumentItem.", CancelReason: "",
  };
}

/** Blank template (one worked example row) + Instructions sheet. */
export async function buildTemplate(opts: { sample?: DefectRow[] } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CleanCore Defect Hub";
  const ws = wb.addWorksheet(SHEET_NAME);
  ws.addRow([...COLUMNS]);
  styleHeader(ws);
  (opts.sample ?? [exampleRow()]).forEach((r) => ws.addRow(toCell(r)));
  addValidations(ws);

  const ins = wb.addWorksheet("Instructions");
  ins.columns = [{ header: "Column", width: 26 }, { header: "Colour / who fills it", width: 26 }, { header: "Rules", width: 110 }];
  ins.getRow(1).font = { bold: true };
  COLUMNS.forEach((c) => ins.addRow([c, REFERENCE_COLUMNS.includes(c) ? "Teal: reference only" : SYSTEM_COLUMNS.includes(c) ? "Grey: system" : "Blue: you fill", COLUMN_HELP[c]]));
  ins.addRow([]);
  ins.addRow(["Required headers", "", REQUIRED_USER_COLUMNS.join(", ") + ". Other headers are optional; keep the template headers as they are."]);
  ins.addRow(["Customer", "", "Is kept for your reference and shown on the dashboard. It is NEVER sent to Jira."]);
  ins.addRow(["Engineering feedback", "Purple: you fill", "Set Automated fix issue = Yes when one of our automated fixes caused the defect. Such defects are routed to product engineering in Jira and must have Fix / Rule ID, Root cause, Impact, Prerequisites and Dependent data sources filled in before they can be approved (rule is configurable). Leave all blank for ordinary defects."]);
  ins.addRow(["Attachments", "", "In AttachmentPaths separate entries with | . Use the file names you upload together with this workbook (images, Word, Excel, PDF) or https:// links. Example: st22_dump.png|analysis.docx|https://drive.google.com/file/d/<id>/view"]);
  ins.addRow(["Limits", "", "Max 5000 rows / 10 MB workbook; max 30 attachment files of 10 MB each per upload."]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Master workbook: ALL records in the full column layout (export + Google Drive master). */
export async function buildMasterWorkbook(records: DefectRecord[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CleanCore Defect Hub";
  const ws = wb.addWorksheet(SHEET_NAME);
  ws.addRow([...COLUMNS]);
  styleHeader(ws);
  records.forEach((r) => ws.addRow(toCell(r)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Per-upload tracking workbook kept in Google Drive: same columns (statuses / Jira IDs updated), + Attachments + Ingestion Log sheets. */
export async function buildTrackingWorkbook(records: DefectRecord[], upload: UploadSummary | undefined, dups: DuplicateEvent[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CleanCore Defect Hub";
  const ws = wb.addWorksheet(SHEET_NAME);
  ws.addRow([...COLUMNS]);
  styleHeader(ws);
  records.forEach((r) => ws.addRow(toCell(r)));

  const at = wb.addWorksheet("Attachments");
  at.columns = [{ header: "JiraTicketID", width: 14 }, { header: "Summary", width: 50 }, { header: "File / link", width: 40 }, { header: "Type", width: 12 }, { header: "Status", width: 26 }, { header: "Open (Google Drive or link)", width: 70 }];
  at.getRow(1).font = { bold: true };
  for (const r of records) for (const a of r.attachments ?? []) {
    const row = at.addRow([r.JiraTicketID, r.Summary, a.name, a.category, a.exists ? "stored" : a.note || "missing", driveLinkOf(a.drivePath) || a.href]);
    const url = driveLinkOf(a.drivePath) || (a.kind === "url" ? a.href : "");
    if (url) row.getCell(6).value = { text: url, hyperlink: url };
  }

  const lg = wb.addWorksheet("Ingestion Log");
  lg.columns = [{ header: "Item", width: 28 }, { header: "Row", width: 8 }, { header: "Detail", width: 120 }];
  lg.getRow(1).font = { bold: true };
  if (upload) {
    lg.addRow(["File", "", `${upload.fileName} (${upload.mode}) at ${upload.at}`]);
    lg.addRow(["Rows read / staged / duplicates / invalid", "", `${upload.totalRows} / ${upload.staged} / ${upload.duplicates} / ${upload.invalid}`]);
    upload.warnings.forEach((w) => lg.addRow(["Warning", "", w]));
    upload.issues.forEach((i) => lg.addRow(["Rejected row", i.row, `${i.column} ${i.message}`]));
  }
  dups.forEach((d) => lg.addRow([`Duplicate suppressed (${d.kind} ${Math.round(d.score * 100)}%)`, d.sourceRow, `"${d.summary}" linked to ${d.matchedJiraId || "pending record"}; occurrence count now ${d.newCount}`]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("result" in o && o.result !== undefined && o.result !== null) return String(o.result);
    if ("text" in o && o.text !== undefined) return String(o.text);
    if ("error" in o) return "";
  }
  return String(v);
}

export interface ParseResult { rows: { row: DefectRow; sourceRow: number }[]; issues: RowIssue[]; warnings: string[]; totalRows: number }

/** Parses an uploaded workbook. Throws ExcelFormatError for unreadable files / missing required headers. */
/** Some editors write cell notes (comments) in a form ExcelJS cannot read. The notes are irrelevant for parsing,
 *  so strip them (comments + legacy drawings + their relationships) and try again. */
async function stripComments(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/(comments[^/]*\/|comments[^/]*\.xml$|drawings\/[^/]*\.vml$|threadedComments\/|persons\/)/i.test(name)) zip.remove(name);
    else if (/^xl\/worksheets\/_rels\/.+\.rels$/i.test(name)) {
      const x = await zip.file(name)!.async("string");
      zip.file(name, x.replace(/<Relationship\b[^>]*\/(comments|vmlDrawing|threadedComment|person)"[^>]*\/>/gi, "").replace(/<Relationship\b[^>]*Target="[^"]*(comment|vml)[^"]*"[^>]*\/>/gi, ""));
    } else if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
      const x = await zip.file(name)!.async("string");
      zip.file(name, x.replace(/<legacyDrawing\b[^>]*\/>/gi, ""));
    } else if (name === "[Content_Types].xml") {
      const x = await zip.file(name)!.async("string");
      zip.file(name, x.replace(/<Override\b[^>]*PartName="\/xl\/(comments|threadedComments|persons)[^"]*"[^>]*\/>/gi, "").replace(/<Override\b[^>]*vmlDrawing[^>]*\/>/gi, ""));
    }
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function parseWorkbook(buf: Buffer, maxRows: number): Promise<ParseResult> {
  let wb = new ExcelJS.Workbook();
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b)
    throw new ExcelFormatError("File is not a readable .xlsx workbook (corrupt, password-protected, or wrong format).", ["not a zip container"]);
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch (first) {
    try {
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await stripComments(buf)) as unknown as ArrayBuffer);
    } catch {
      throw new ExcelFormatError("File is not a readable .xlsx workbook (corrupt, password-protected, or wrong format).", [(first as Error).message]);
    }
  }
  const ws = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) throw new ExcelFormatError("Workbook contains no worksheets.");

  const colIndex = new Map<ColumnName, number>();
  const seen: string[] = [], unknown: string[] = [], dupes: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (c, i) => {
    const name = cellText(c.value).trim();
    if (!name) return;
    seen.push(name);
    const canon = canonicalHeader(name);
    if (!canon) unknown.push(name);
    else if (colIndex.has(canon)) dupes.push(name);
    else colIndex.set(canon, i);
  });
  const missing = REQUIRED_USER_COLUMNS.filter((c) => !colIndex.has(c));
  if (missing.length)
    throw new ExcelFormatError(`Missing required header(s): ${missing.join(", ")}`, [
      `Required headers: ${REQUIRED_USER_COLUMNS.join(", ")}`, `Template headers: ${COLUMNS.join(", ")}`, `Found: ${seen.join(", ") || "(none)"}`,
    ]);
  const warnings: string[] = [];
  if (unknown.length) warnings.push(`Ignored unknown column(s): ${unknown.join(", ")}`);
  if (dupes.length) warnings.push(`Duplicate header(s) - first occurrence used: ${[...new Set(dupes)].join(", ")}`);
  const optionalMissing = COLUMNS.filter((c) => !colIndex.has(c) && !SYSTEM_COLUMNS.includes(c) && !ENGINEERING_COLUMNS.includes(c));
  if (optionalMissing.length) warnings.push(`Optional column(s) not in file (blank assumed): ${optionalMissing.join(", ")}`);
  if (!ENGINEERING_COLUMNS.some((c) => colIndex.has(c))) warnings.push("No engineering-feedback columns in this file (Automated fix issue, Fix / Rule ID, Root cause, Impact, Prerequisites, Dependent data sources): treated as ordinary defects. Download the latest template to use them.");

  const out: ParseResult = { rows: [], issues: [], warnings, totalRows: 0 };
  const last = ws.actualRowCount ? ws.rowCount : 0;
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    const raw: Partial<Record<ColumnName, string>> = {};
    let any = false;
    for (const c of COLUMNS) {
      const idx = colIndex.get(c);
      const t = idx ? cellText(row.getCell(idx).value).trim() : "";
      raw[c] = t;
      if (t && (["Project key", "Issue Type", "Summary", "Description", "Assignee Email", "Reporter Email", "Priority"] as ColumnName[]).includes(c)) any = true;
    }
    if (!any) continue; // blank / dropdown-only row
    out.totalRows++;
    if (out.totalRows > maxRows) throw new ExcelFormatError(`File exceeds the ${maxRows} row limit.`);
    const v = validateRow(raw, r);
    if (v.issues.length) out.issues.push(...v.issues);
    else out.rows.push({ row: v.row!, sourceRow: r });
  }
  if (out.totalRows === 0) throw new ExcelFormatError("The worksheet has headers but no data rows.");
  return out;
}

/** Recurrence report (one row per Fix / Rule ID) for product engineering. */
export async function buildRecurrenceWorkbook(rep: { rows: RecurrenceRow[]; totals: { fixes: number; defects: number; totalReports: number }; unassigned: number }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "smartShift Defect Hub";
  const ws = wb.addWorksheet("Recurrence by fix");
  const head = ["Fix / Rule ID", "Defects", "Repeat reports (duplicates)", "Total reports", "Pending", "Approved", "Cancelled", "Jira tickets", "Most common root cause", "First seen", "Last seen"];
  ws.addRow(head);
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C3AED" } }; c.alignment = { vertical: "middle", wrapText: true }; });
  [24, 10, 16, 12, 10, 10, 10, 34, 60, 22, 22].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const r of rep.rows) ws.addRow([r.fix, r.defects, r.repeatReports, r.totalReports, r.pending, r.approved, r.cancelled, r.jiraTickets.join(", "), r.topRootCause, r.firstSeen.slice(0, 19).replace("T", " "), r.lastSeen.slice(0, 19).replace("T", " ")]);
  ws.addRow([]);
  ws.addRow(["Totals", rep.totals.defects, "", rep.totals.totalReports]);
  if (rep.unassigned) ws.addRow([`${rep.unassigned} automated-fix defect(s) have no Fix / Rule ID yet and are not listed.`]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

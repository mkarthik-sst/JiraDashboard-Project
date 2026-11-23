/**
 * Engineering feedback for defects caused by our automated fixes.
 *   - isEngineeringIssue():     the defect is flagged "Automated fix issue = Yes"
 *   - missingEngineeringFields: details that must be filled in before the defect can be approved (ENGINEERING_REQUIRE_MODE / _REQUIRED_FIELDS)
 *   - engineeringDescription(): the "Engineering feedback" section added to the Jira description
 *   - recurrenceReport():       which fixes / rules generate the most defects (shown on the "Recurrence report" tab and exported to Excel)
 */
import { getConfig } from "./config";
import { FIELD, type ColumnName, type DefectRecord, type DefectRow } from "./schema";

export const ENGINEERING_FIELD_COLUMNS: ColumnName[] = ["Fix / Rule ID", "Root cause", "Impact", "Prerequisites", "Dependent data sources"];

export const isEngineeringIssue = (r: Pick<DefectRow, "AutomatedFix">) => r.AutomatedFix === "Yes";

/** Whether the mandatory-details rule applies to this defect. */
export function engineeringRequired(r: Pick<DefectRow, "AutomatedFix">): boolean {
  const m = getConfig().engineering.requireMode;
  return m === "all" || (m === "flagged" && isEngineeringIssue(r));
}

/** Template column names that are still empty but required before approval. */
export function missingEngineeringFields(r: DefectRow): ColumnName[] {
  if (!engineeringRequired(r)) return [];
  const known = new Set<string>(ENGINEERING_FIELD_COLUMNS);
  return getConfig().engineering.requiredFields
    .filter((c): c is ColumnName => known.has(c))
    .filter((c) => !String(r[FIELD[c]] ?? "").trim());
}

/** Plain-text lines for the Jira description (Atlassian Document paragraphs are built from these lines). */
export function engineeringDescription(r: DefectRow): string[] {
  const has = isEngineeringIssue(r) || ENGINEERING_FIELD_COLUMNS.some((c) => String(r[FIELD[c]] ?? "").trim());
  if (!has) return [];
  const out = ["", "Engineering feedback" + (isEngineeringIssue(r) ? " (automated-fix issue)" : "")];
  for (const c of ENGINEERING_FIELD_COLUMNS) { const v = String(r[FIELD[c]] ?? "").trim(); if (v) out.push(`${c}: ${v}`); }
  return out;
}

export interface RecurrenceRow {
  fix: string; defects: number; repeatReports: number; totalReports: number;
  pending: number; approved: number; cancelled: number; jiraTickets: string[];
  topRootCause: string; firstSeen: string; lastSeen: string;
}

/**
 * One row per Fix / Rule ID (defects flagged as automated-fix issues, or any defect that carries a Fix / Rule ID).
 *   defects       = distinct defect entries (cancelled ones are listed separately and not counted as reports)
 *   repeatReports = duplicates that were suppressed against those entries (DuplicateOccurrenceCount)
 *   totalReports  = defects + repeatReports  -> the number engineering should look at
 */
export function recurrenceReport(records: DefectRecord[]): { rows: RecurrenceRow[]; totals: { fixes: number; defects: number; totalReports: number }; unassigned: number } {
  const map = new Map<string, DefectRecord[]>();
  let unassigned = 0;
  for (const r of records) {
    const fix = r.FixRuleId.trim();
    if (!fix && !isEngineeringIssue(r)) continue;
    if (!fix) { unassigned++; continue; }
    const key = fix.toUpperCase();
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  const rows: RecurrenceRow[] = [];
  for (const group of map.values()) {
    const live = group.filter((r) => r.AssignApprovalStatus !== "Cancelled");
    const causes = new Map<string, number>();
    for (const r of live) { const c = r.RootCause.trim(); if (c) causes.set(c, (causes.get(c) ?? 0) + 1); }
    const top = [...causes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const dates = group.map((r) => r.createdAt).sort();
    const repeat = live.reduce((a, r) => a + r.DuplicateOccurrenceCount, 0);
    rows.push({
      fix: group[0].FixRuleId.trim(), defects: live.length, repeatReports: repeat, totalReports: live.length + repeat,
      pending: live.filter((r) => r.AssignApprovalStatus !== "Approved").length, approved: live.filter((r) => r.AssignApprovalStatus === "Approved").length,
      cancelled: group.length - live.length, jiraTickets: live.map((r) => r.JiraTicketID).filter(Boolean),
      topRootCause: top.length > 140 ? `${top.slice(0, 140)}...` : top, firstSeen: dates[0] ?? "", lastSeen: dates[dates.length - 1] ?? "",
    });
  }
  rows.sort((a, b) => b.totalReports - a.totalReports || a.fix.localeCompare(b.fix));
  return { rows, totals: { fixes: rows.length, defects: rows.reduce((a, r) => a + r.defects, 0), totalReports: rows.reduce((a, r) => a + r.totalReports, 0) }, unassigned };
}

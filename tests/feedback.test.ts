import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import ExcelJS from "exceljs";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-"));
process.env.SYNC_MODE = "none"; process.env.JIRA_BASE_URL = ""; process.env.ATTACHMENT_ROOT = process.cwd(); process.env.SEED_DEMO_DATA = "false";
process.env.APP_BASE_URL = "https://hub.smartshift.com"; process.env.SMTP_IGNORE_TLS = "true";
process.env.ENGINEERING_JIRA_PROJECT_KEY = "PENG"; process.env.ENGINEERING_JIRA_COMPONENT = "Automated Fixes"; process.env.ENGINEERING_NOTIFY_EMAIL = "product-engineering@smartshift.com";

import { approve, cancelRecord, editRecord, ingest, reassign, returnToReporter, stats, EngineError } from "@/lib/engine";
import { buildTemplate, buildRecurrenceWorkbook, parseWorkbook } from "@/lib/excel";
import { sampleRows, buildSampleWorkbook } from "@/lib/sample";
import { buildIssuePayload } from "@/lib/jira";
import { missingEngineeringFields, recurrenceReport } from "@/lib/engineering";
import { flushNotifications } from "@/lib/notify";
import { getDb, newDb, resetDbForTests } from "@/lib/store";
import { COLUMNS, validateRow } from "@/lib/schema";

const mails: ParsedMail[] = []; let rcpts: string[][] = []; let srv: SMTPServer;
beforeAll(async () => {
  srv = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, session, cb) {
    simpleParser(stream).then((m) => { mails.push(m); rcpts.push(session.envelope.rcptTo.map((r) => r.address)); cb(); }, cb);
  } });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String((srv.server.address() as { port: number }).port);
});
afterAll(() => srv.close());
beforeEach(() => { mails.length = 0; rcpts = []; resetDbForTests(newDb()); delete process.env.ENGINEERING_REQUIRE_MODE; });

const stage = async () => {
  await ingest(await buildSampleWorkbook(), "s.xlsx", "immediate"); await flushNotifications(); mails.length = 0; rcpts = [];
  return getDb().records;
};
const fail = async (fn: () => unknown, status: number, re?: RegExp) => {
  try { await fn(); } catch (e) { expect(e).toBeInstanceOf(EngineError); expect((e as EngineError).status).toBe(status); if (re) expect((e as Error).message).toMatch(re); return; }
  throw new Error("expected an error");
};

describe("cancelled requests", () => {
  it("cancels from Pending, Reassigned and Reporter Review; a reason is required; history, stats and e-mails follow", async () => {
    const [a, b, c] = await stage();
    await fail(() => cancelRecord(a.id, "  "), 400, /reason/);
    cancelRecord(a.id, "Raised by mistake - duplicate of a ticket outside the Hub", "approver@acme.com");
    expect(a).toMatchObject({ AssignApprovalStatus: "Cancelled", ExecutionStatus: "CANCELLED", CancelReason: expect.stringContaining("by mistake"), JiraTicketID: "" });
    expect(a.history!.at(-1)).toMatchObject({ kind: "cancelled", by: "approver@acme.com" });
    await reassign(b.id, "Senior Person"); cancelRecord(b.id, "Not needed any more");
    returnToReporter(c.id, "please check", "x"); cancelRecord(c.id, "Reporter confirmed it is not a defect");
    expect(stats()).toMatchObject({ cancelled: 3, pending: 2, approved: 0 });
    await flushNotifications();
    const subjects = mails.map((m) => m.subject!);
    expect(subjects.some((s) => s.startsWith("Cancelled (no Jira ticket):"))).toBe(true);
    expect(rcpts.flat()).toContain("sam.lee@acme-demo.com");                    // the reporter is told (the person who cancelled is not)
  });
  it("a cancelled entry can no longer be approved, edited, reassigned, returned or cancelled again", async () => {
    const [a] = await stage(); cancelRecord(a.id, "Not needed");
    await fail(() => approve(a.id), 409, /cancelled/);
    await fail(() => editRecord(a.id, { Summary: "x" }), 409, /cancelled/);
    await fail(() => reassign(a.id, "Someone Else"), 409, /cancelled/);
    await fail(() => returnToReporter(a.id, "x"), 409, /cancelled/);
    await fail(() => cancelRecord(a.id, "again"), 409, /already cancelled/);
    expect(a.JiraTicketID).toBe("");
  });
  it("an approved defect (Jira ticket exists) cannot be cancelled", async () => {
    const [a] = await stage(); await approve(a.id);
    await fail(() => cancelRecord(a.id, "too late"), 409, /already approved/);
  });
  it("cancelled entries are ignored by duplicate detection: the same defect can be uploaded again", async () => {
    const [a] = await stage(); cancelRecord(a.id, "Wrong project key");
    const s = await ingest(await buildSampleWorkbook(), "again.xlsx", "immediate");
    expect(s.duplicates).toBe(4); expect(s.staged).toBe(1);               // the 4 live entries are duplicates; the cancelled one is raised again
    expect(s.staged + s.duplicates).toBe(5);
    expect(getDb().records.filter((r) => r.AssignApprovalStatus === "Cancelled")).toHaveLength(1);
  });
});

describe("engineering feedback fields", () => {
  it("sample has the new columns: flagged rows carry details, one flagged row is incomplete on purpose", async () => {
    const rows = sampleRows();
    expect(rows.map((r) => r.AutomatedFix)).toEqual(["Yes", "Yes", "Yes", "No", "Yes"]);
    expect(missingEngineeringFields(rows[0])).toEqual([]);
    expect(missingEngineeringFields(rows[2])).toEqual(["Prerequisites", "Dependent data sources"]);
    expect(missingEngineeringFields(rows[3])).toEqual([]);                      // ordinary defect: nothing required
  });
  it("approval is blocked until the mandatory details are filled in; then it succeeds", async () => {
    const recs = await stage(); const inc = recs.find((r) => r.FixRuleId === "FIX-CFL-003")!;
    expect(inc.lastWarning).toMatch(/Engineering details missing.*Prerequisites, Dependent data sources/);
    await fail(() => approve(inc.id), 422, /Prerequisites, Dependent data sources/);
    expect(inc.JiraTicketID).toBe("");
    editRecord(inc.id, { Prerequisites: "Custom field created in Custom Fields app", DependentSources: "MATDOC, I_MaterialDocumentItem" }, "u");
    expect(inc.lastWarning).not.toMatch(/Engineering details missing/);
    await approve(inc.id); expect(inc.JiraTicketID).toMatch(/^PENG-\d+$/);
  });
  it("modes: off = never required, all = required for ordinary defects too", async () => {
    const recs = await stage(); const inc = recs.find((r) => r.FixRuleId === "FIX-CFL-003")!, ord = recs.find((r) => r.AutomatedFix === "No")!;
    process.env.ENGINEERING_REQUIRE_MODE = "off"; expect(missingEngineeringFields(inc)).toEqual([]);
    process.env.ENGINEERING_REQUIRE_MODE = "all"; expect(missingEngineeringFields(ord)).toHaveLength(5);
    await fail(() => approve(ord.id), 422, /Fix \/ Rule ID, Root cause, Impact/);
  });
  it("Automated fix issue must be Yes or No; the old 19-column sheet still uploads as ordinary defects", async () => {
    expect(validateRow({ "Project key": "JAIT", Summary: "s", Description: "d", "Issue Type": "Bug", Priority: "High", "Assignee Email": "a@b.com", "Reporter Email": "c@d.com", "Automated fix issue": "maybe" }, 2).issues[0].message).toMatch(/Yes or No/);
    expect(validateRow({ "Project key": "JAIT", Summary: "s", Description: "d", "Issue Type": "Bug", Priority: "High", "Assignee Email": "a@b.com", "Reporter Email": "c@d.com", "Automated fix issue": "y" }, 2).row!.AutomatedFix).toBe("Yes");
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Defects");
    ws.addRow(COLUMNS.slice(0, 19)); ws.addRow(["Acme", "JAIT", "n", "software", "Old format row", "Uploaded with the old template", "Bug", "Lead", "High", "a@acme.com", "b@acme.com", "", "", "", "", "", "", "", ""]);
    const p = await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), 100);
    expect(p.rows).toHaveLength(1); expect(p.rows[0].row.AutomatedFix).toBe("No"); expect(p.warnings.join(" ")).toMatch(/No engineering-feedback columns/);
  });
  it("the template contains the new columns with a Yes/No dropdown", async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildTemplate() as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Defects")!; const hdr = (ws.getRow(1).values as string[]).slice(1);
    expect(hdr).toEqual([...COLUMNS]); expect(hdr).toContain("Fix / Rule ID");
    expect((ws.getCell(3, hdr.indexOf("Automated fix issue") + 1).dataValidation as { formulae: string[] }).formulae[0]).toBe('"No,Yes"');
  });
});

describe("routing to product engineering", () => {
  it("automated-fix defects go to the engineering project with labels, component and an Engineering feedback section", async () => {
    const recs = await stage(); const flagged = recs.find((r) => r.FixRuleId === "FIX-VBAP-014")!, ord = recs.find((r) => r.AutomatedFix === "No")!;
    const f = buildIssuePayload(flagged).fields as any, o = buildIssuePayload(ord).fields as any;
    expect(f.project.key).toBe("PENG"); expect(f.labels).toEqual(expect.arrayContaining(["automated-fix-feedback", "product-engineering"])); expect(f.components).toEqual([{ name: "Automated Fixes" }]);
    const text = JSON.stringify(f.description);
    expect(text).toContain("Engineering feedback (automated-fix issue)"); expect(text).toContain("Fix / Rule ID: FIX-VBAP-014"); expect(text).toContain("Root cause: Automated fix joined VBAP");
    expect(o.project.key).toBe("JAIT"); expect(o.labels).toBeUndefined(); expect(o.components).toBeUndefined(); expect(JSON.stringify(o.description)).not.toContain("Engineering feedback");
  });
  it("on approval the Jira key uses the engineering project and product engineering gets a hand-over e-mail (ordinary defects do not)", async () => {
    const recs = await stage(); const flagged = recs.find((r) => r.FixRuleId === "FIX-VBAP-014")!, ord = recs.find((r) => r.AutomatedFix === "No")!;
    await approve(flagged.id); await approve(ord.id); await flushNotifications();
    expect(flagged.JiraTicketID).toMatch(/^PENG-/); expect(ord.JiraTicketID).toMatch(/^JAIT-/);
    const eng = mails.filter((m) => rcpts[mails.indexOf(m)].includes("product-engineering@smartshift.com"));
    expect(eng).toHaveLength(1); expect(eng[0].subject).toContain("FIX-VBAP-014"); expect(eng[0].text).toContain("Root cause:");
  });
});

describe("recurrence report", () => {
  it("groups by Fix / Rule ID, adds repeat reports, ignores cancelled entries, sorts by total reports", async () => {
    await ingest(await buildSampleWorkbook(true), "s.xlsx", "immediate");      // 6th row is a duplicate of the FIX-VBAP-014 defect
    let rep = recurrenceReport(getDb().records);
    expect(rep.rows.map((r) => [r.fix, r.defects, r.repeatReports, r.totalReports])).toEqual([["FIX-CAST-007", 2, 0, 2], ["FIX-VBAP-014", 1, 1, 2], ["FIX-CFL-003", 1, 0, 1]]);
    expect(rep.totals).toEqual({ fixes: 3, defects: 4, totalReports: 5 }); expect(rep.rows[0].topRootCause).toMatch(/MATNR|type-conversion/);
    const cast = getDb().records.filter((r) => r.FixRuleId === "FIX-CAST-007"); cancelRecord(cast[0].id, "not a defect");
    rep = recurrenceReport(getDb().records);
    const row = rep.rows.find((r) => r.fix === "FIX-CAST-007")!; expect(row).toMatchObject({ defects: 1, cancelled: 1 });
    await approve(cast[1].id); expect(recurrenceReport(getDb().records).rows.find((r) => r.fix === "FIX-CAST-007")).toMatchObject({ approved: 1, pending: 0 });
  });
  it("counts flagged defects without a Fix / Rule ID separately and exports to Excel", async () => {
    const [a] = await stage(); editRecord(a.id, { FixRuleId: "" });
    const rep = recurrenceReport(getDb().records); expect(rep.unassigned).toBe(1);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildRecurrenceWorkbook(rep) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Recurrence by fix")!; expect(String(ws.getRow(1).getCell(1).value)).toBe("Fix / Rule ID"); expect(ws.rowCount).toBeGreaterThan(3);
  });
});

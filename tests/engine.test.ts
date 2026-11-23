import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chub-"));
process.env.JIRA_BASE_URL = "";
process.env.SAMPLE_ASSIGNEE_EMAIL = "mkarthik@smartshift.com"; process.env.SAMPLE_REPORTER_EMAIL = "mkarthik@smartshift.com";
process.env.SYNC_MODE = "none";
process.env.ATTACHMENT_ROOT = process.cwd();

import { COLUMNS, canonicalHeader } from "@/lib/schema";
import { buildTemplate, parseWorkbook, ExcelFormatError } from "@/lib/excel";
import { buildSampleWorkbook, sampleRows } from "@/lib/sample";
import { saveUploadedFile, resolveAttachments } from "@/lib/attachments";
import { approve, ingest, reassign, stats, EngineError, submitUpload, runDueSchedules } from "@/lib/engine";
import { getDb, newDb, resetDbForTests, commit } from "@/lib/store";
import { buildSeed } from "@/lib/seed";
import { buildIssuePayload } from "@/lib/jira";
import { normalize, similarity } from "@/lib/dedup";

function seeded() { resetDbForTests({ ...newDb(), ...buildSeed() }); commit(); }

describe("schema & excel", () => {
  it("template has exactly the 26 headers (19 original + 7 engineering/cancel) in order (Customer first)", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildTemplate()) as unknown as ArrayBuffer);
    const hdr = (wb.getWorksheet("Defects")!.getRow(1).values as string[]).slice(1);
    expect(hdr).toEqual([...COLUMNS]);
    expect(hdr).toHaveLength(26); expect(hdr.slice(0, 19)).toEqual([...COLUMNS].slice(0, 19));
    expect(hdr[0]).toBe("Customer");
  });
  it("header aliases are tolerated (case / spacing / camelCase)", () => {
    expect(canonicalHeader("ProjectKey")).toBe("Project key");
    expect(canonicalHeader("  assignee email ")).toBe("Assignee Email");
    expect(canonicalHeader("issuetype")).toBe("Issue Type");
  });
  it("rejects a non-xlsx buffer", async () => {
    await expect(parseWorkbook(Buffer.from("hello world"), 100)).rejects.toBeInstanceOf(ExcelFormatError);
  });
  it("rejects missing required headers and names them", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Defects").addRow(["Project key", "Summary"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseWorkbook(buf, 100)).rejects.toThrow(/Missing required header.*Issue Type/);
  });
  it("sample parses: 5 valid rows, no issues, every row has attachments", async () => {
    const r = await parseWorkbook(await buildSampleWorkbook(), 100);
    expect(r.rows).toHaveLength(5); expect(r.issues).toHaveLength(0);
    expect(r.rows.every((x) => x.row.AttachmentPaths.includes("|"))).toBe(true);
    expect(r.rows[0].row.Customer).toBe("Acme Corp"); expect(r.rows[0].row.Priority).toBe("High Attention");
  });
  it("display names are accepted as assignee/reporter; system columns cannot be forged", async () => {
    const rows = sampleRows(); rows[0].AssigneeEmail = "Medisetty Karthik";
    (rows[0] as any).JiraTicketID = "FAKE-1"; rows[0].AssignApprovalStatus = "Approved";
    const { buildTemplate: bt } = await import("@/lib/excel");
    const r = await parseWorkbook(await bt({ sample: rows }), 100);
    expect(r.issues).toHaveLength(0); expect(r.rows[0].row.AssigneeEmail).toBe("Medisetty Karthik");
    expect(r.rows[0].row.JiraTicketID).toBe(""); expect(r.rows[0].row.AssignApprovalStatus).toBe("In Progress");
  });
});

describe("attachments", () => {
  it("resolves server paths, uploaded names, urls and flags missing files", () => {
    const set = "11111111-1111-4111-8111-111111111111";
    saveUploadedFile(set, "up.png", Buffer.from("x"));
    const a = resolveAttachments("attachments/samples/st22_cast_dump.png|up.png|https://example.com/a.docx|nope.xlsx", set);
    expect(a.map((x) => [x.category, x.exists, x.kind])).toEqual([["image", true, "file"], ["image", true, "file"], ["word", true, "url"], ["excel", false, "file"]]);
    expect(a[0].href).toContain(`/api/attachment?set=${set}&name=`);
    expect(a[3].note).toMatch(/not found/);
  });
});

describe("dedup", () => {
  it("normalize ignores case, dates, long numbers", () => {
    expect(normalize("Dump on 2026-10-26 doc 4500012345")).toBe(normalize("dump  ON  doc"));
  });
  it("similarity of near-identical text is high", () => {
    const a = { Summary: "x y z w", Description: "alpha beta gamma delta epsilon zeta eta theta iota" };
    expect(similarity(a, { ...a, Description: a.Description + " kappa" })).toBeGreaterThan(0.9);
  });
});

describe("workflow", () => {
  beforeEach(seeded);

  it("ingest stages unique, suppresses exact + fuzzy duplicates, increments count", async () => {
    const before = getDb().records.length;
    const prev = 0;
    const s = await ingest(await buildSampleWorkbook(true), "sample.xlsx", "immediate");
    expect(s).toMatchObject({ staged: 5, duplicates: 1, invalid: 0 });
    expect(getDb().records.length).toBe(before + 5);
    expect(getDb().records.slice(-5).every((r) => r.uploadId === s.id && r.attachments.length >= 2 && r.attachments.every((a) => a.exists))).toBe(true);
    expect(getDb().duplicates.at(-1)!.kind).toBe("exact");
    expect(getDb().records.slice(-5).every((r) => r.AssignApprovalStatus === "In Progress" && r.ExecutionStatus === "PENDING")).toBe(true);
  });

  it("re-uploading the same file suppresses everything (idempotent)", async () => {
    const buf = await buildSampleWorkbook();
    await ingest(buf, "a.xlsx", "immediate");
    const s = await ingest(buf, "a.xlsx", "immediate");
    expect(s.staged).toBe(0);
    expect(s.duplicates).toBe(5);
  });

  it("approve -> Jira key, PROCESSED, reassignment locked, no double-create", async () => {
    const rec = getDb().records.find((r) => r.AssignApprovalStatus === "In Progress")!;
    const out = await approve(rec.id);
    expect(out.JiraTicketID).toMatch(/^[A-Z]+-\d+$/);
    expect(out).toMatchObject({ AssignApprovalStatus: "Approved", ExecutionStatus: "PROCESSED" });
    expect(out.ReassignStatus).toBe("None");
    expect(out.ProcessedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await expect(reassign(rec.id, "x@y.com")).rejects.toMatchObject({ status: 409 });
    await expect(approve(rec.id)).rejects.toMatchObject({ status: 409 });
  });

  it("reassign sets Changed Assignee / In Progress, notifies, then new assignee can approve", async () => {
    const rec = getDb().records.find((r) => r.AssignApprovalStatus === "In Progress")!;
    await reassign(rec.id, "New.Person@smartshift.com");
    expect(rec).toMatchObject({ AssignApprovalStatus: "Changed Assignee", ReassignStatus: "In Progress", ReassignedToEmail: "new.person@smartshift.com" });
    expect(getDb().notifications.at(-1)!.to).toBe("new.person@smartshift.com");
    expect(buildIssuePayload(rec as any).fields).toHaveProperty("project");
    await approve(rec.id);
    expect(rec.ReassignStatus).toBe("Approved");
    expect(rec.AssignApprovalStatus).toBe("Approved");   // BOTH columns become Approved
    expect(rec.JiraTicketID).toMatch(/-\d+$/); expect(rec.ExecutionStatus).toBe("PROCESSED");
  });

  it("reassign accepts a display name, rejects blanks and the same assignee", async () => {
    const rec = getDb().records.find((r) => r.AssignApprovalStatus === "In Progress")!;
    await expect(reassign(rec.id, " ")).rejects.toBeInstanceOf(EngineError);
    await expect(reassign(rec.id, rec.AssigneeEmail)).rejects.toBeInstanceOf(EngineError);
  });

  it("Customer is never part of the Jira payload", async () => {
    await ingest(await buildSampleWorkbook(), "s.xlsx", "immediate");
    const rec = getDb().records.find((r) => r.Customer === "Acme Corp")!;
    const body = JSON.stringify(buildIssuePayload(rec, { assigneeAccountId: "a" }));
    expect(body).not.toMatch(/Acme Corp|Customer/);
    expect(Object.keys(buildIssuePayload(rec).fields)).not.toContain("components");
  });

  it("Jira failure marks FAILED, keeps record pending and retryable", async () => {
    process.env.JIRA_MOCK_FAIL_RATE = "1";
    const rec = getDb().records.find((r) => r.AssignApprovalStatus === "In Progress")!;
    await expect(approve(rec.id)).rejects.toMatchObject({ status: 502 });
    expect(rec).toMatchObject({ ExecutionStatus: "FAILED", AssignApprovalStatus: "In Progress", JiraTicketID: "" });
    expect(rec.lastError).toMatch(/503/);
    process.env.JIRA_MOCK_FAIL_RATE = "0";
    await approve(rec.id);
    expect(rec.ExecutionStatus).toBe("PROCESSED");
  }, 30000);

  it("scheduled upload runs when due and stats update", async () => {
    const out = await submitUpload(await buildSampleWorkbook(), "later.xlsx", "scheduled", new Date(Date.now() + 1500).toISOString());
    expect(stats().scheduled).toBe(1);
    await new Promise((r) => setTimeout(r, 1700));
    await runDueSchedules();
    expect(getDb().scheduled.find((s) => s.id === out.scheduled!.id)!.status).toBe("COMPLETED");
    expect(stats().scheduled).toBe(0);
  });

  it("scheduled upload keeps attachment files uploaded with it", async () => {
    const png = fs.readFileSync("attachments/samples/st22_cast_dump.png");
    const rows = sampleRows().slice(0, 1); rows[0].AttachmentPaths = "late.png";
    const { buildTemplate: bt } = await import("@/lib/excel");
    const out = await submitUpload(await bt({ sample: rows }), "late.xlsx", "scheduled", new Date(Date.now() + 1200).toISOString(), [{ name: "late.png", data: png }]);
    await new Promise((r) => setTimeout(r, 1400)); await runDueSchedules();
    const rec = getDb().records.find((r) => r.uploadId === out.scheduled!.setId)!;
    expect(rec.attachments[0]).toMatchObject({ name: "late.png", exists: true, category: "image" });
  });

  it("rejects past schedule time and wrong extension", async () => {
    const buf = await buildSampleWorkbook();
    await expect(submitUpload(buf, "x.xlsx", "scheduled", "2020-01-01T00:00:00Z")).rejects.toMatchObject({ status: 400 });
    await expect(submitUpload(buf, "x.csv", "immediate")).rejects.toMatchObject({ status: 415 });
  });
});

describe("workbooks saved by other tools", () => {
  it("a workbook whose cell notes ExcelJS cannot read is still parsed (notes are stripped)", async () => {
    const buf = fs.readFileSync("tests/fixtures/openpyxl_with_notes.xlsx");
    const r = await parseWorkbook(buf, 100);
    expect(r.rows).toHaveLength(5); expect(r.issues).toHaveLength(0);
    expect(r.rows[1].row.AssigneeEmail).toBe("Medisetty Karthik");
  });
});

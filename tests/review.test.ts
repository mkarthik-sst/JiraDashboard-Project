import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "review-"));
process.env.SAMPLE_ASSIGNEE_EMAIL = "mkarthik@smartshift.com"; process.env.SAMPLE_REPORTER_EMAIL = "mkarthik@smartshift.com";
process.env.SYNC_MODE = "none"; process.env.JIRA_BASE_URL = ""; process.env.ATTACHMENT_ROOT = process.cwd(); process.env.SEED_DEMO_DATA = "false";
process.env.APP_BASE_URL = "https://hub.smartshift.com"; process.env.SMTP_IGNORE_TLS = "true";
process.env.NOTIFY_USER_MAP = JSON.stringify({ "Rahul Verma": "rahul.verma@smartshift.com" });

import { addDocuments, approve, editRecord, ingest, reassign, resubmit, returnToReporter, stats, EngineError } from "@/lib/engine";
import { buildTemplate } from "@/lib/excel";
import { sampleRows } from "@/lib/sample";
import { flushNotifications, mailStatusIndex } from "@/lib/notify";
import { getDb, newDb, resetDbForTests } from "@/lib/store";
import { emailAllowed, canOpenDrive, signToken, verifyToken } from "@/lib/auth";

const mails: ParsedMail[] = []; let rcpts: string[][] = []; let srv: SMTPServer; let down = false;
beforeAll(async () => {
  srv = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, session, cb) {
    simpleParser(stream).then((m) => { mails.push(m); rcpts.push(session.envelope.rcptTo.map((r) => r.address)); cb(); }, cb);
  } });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String((srv.server.address() as { port: number }).port);
});
afterAll(() => srv.close());
beforeEach(() => { mails.length = 0; rcpts = []; resetDbForTests(newDb()); down = false; });

const stage = async (n = 2) => {
  const rows = sampleRows().slice(0, n); rows.forEach((r) => { r.ReporterEmail = "reporter@smartshift.com"; r.AssigneeEmail = "mkarthik@smartshift.com"; });
  await ingest(await buildTemplate({ sample: rows }), "r.xlsx", "immediate"); await flushNotifications(); mails.length = 0; rcpts = [];
  return getDb().records;
};
const fail = async (fn: () => unknown, status: number, re?: RegExp) => {
  try { await fn(); } catch (e) { expect(e).toBeInstanceOf(EngineError); expect((e as EngineError).status).toBe(status); if (re) expect((e as Error).message).toMatch(re); return; }
  throw new Error("expected an error");
};

describe("editing", () => {
  it("edits the six allowed fields, keeps an activity trail, recalculates the duplicate fingerprint", async () => {
    const [a] = await stage(); const fp = a.fingerprint;
    editRecord(a.id, { Summary: "New title", Description: "New text", IssueType: "Task", Priority: "Low", Lead: "Priya", AttachmentPaths: "https://example.com/x.pdf" }, "mkarthik@smartshift.com");
    expect(a).toMatchObject({ Summary: "New title", Description: "New text", IssueType: "Task", Priority: "Low", Lead: "Priya" });
    expect(a.fingerprint).not.toBe(fp); expect(a.attachments).toHaveLength(1); expect(a.attachments[0].kind).toBe("url");
    const h = a.history!.at(-1)!; expect(h).toMatchObject({ kind: "edited", by: "mkarthik@smartshift.com" });
    expect(h.changes!.map((c) => c.field).sort()).toEqual(["AttachmentPaths", "Description", "Issue Type", "Priority", "Project lead", "Summary"]);
  });
  it("rejects empty / too long values and fields that must not change; approved records are locked", async () => {
    const [a, b] = await stage();
    await fail(() => editRecord(a.id, { Summary: "  " }), 422, /Summary cannot be empty/);
    await fail(() => editRecord(a.id, { Summary: "x".repeat(300) }), 422, /255/);
    await fail(() => editRecord(a.id, { AttachmentPaths: "../secret.txt" }), 422, /\.\./);
    await fail(() => editRecord(a.id, { JiraTicketID: "X-1" } as never), 400, /cannot be edited/);
    await fail(() => editRecord(a.id, { AssigneeEmail: "x@y.com" } as never), 400);
    await approve(b.id);
    await fail(() => editRecord(b.id, { Summary: "late" }), 409, /already approved/);
  });
  it("adds documents to ONE defect without overwriting a same-named file of another defect", async () => {
    const [a, b] = await stage();
    addDocuments(a.id, [{ name: "extra.png", data: Buffer.from("A") }], "u");
    addDocuments(b.id, [{ name: "extra.png", data: Buffer.from("B") }], "u");
    expect(a.AttachmentPaths.split("|")).toContain("extra.png"); expect(b.AttachmentPaths.split("|").some((n) => /^extra_2\.png$/.test(n))).toBe(true);
    const dir = path.join(process.env.DATA_DIR!, "attachments", a.uploadId);
    expect(fs.readFileSync(path.join(dir, "extra.png"), "utf8")).toBe("A"); expect(fs.readFileSync(path.join(dir, "extra_2.png"), "utf8")).toBe("B");
    expect(a.attachments.find((x) => x.name === "extra.png")?.exists).toBe(true);
    await fail(() => addDocuments(a.id, [], "u"), 400);
  });
});

describe("Reporter Review", () => {
  it("approver returns to the reporter with a comment: status, e-mail, locks", async () => {
    const [a] = await stage();
    await fail(() => returnToReporter(a.id, "   "), 400, /comment/);
    returnToReporter(a.id, "Please add the ST22 dump & the object name", "mkarthik@smartshift.com"); await flushNotifications();
    expect(a.AssignApprovalStatus).toBe("Reporter Review"); expect(stats()).toMatchObject({ reporterReview: 1, pending: 1 });
    expect(rcpts).toEqual([["reporter@smartshift.com"]]);
    expect(mails[0].subject).toMatch(/^Action needed - please review:/); expect(mails[0].text).toContain("Please add the ST22 dump");
    expect(mails[0].text).toContain(`https://hub.smartshift.com/?tab=reporter&record=${a.id}`); expect(mails[0].html).toContain("Send for approval");
    await fail(() => approve(a.id), 409, /with the reporter/); await fail(() => reassign(a.id, "Rahul Verma"), 409, /with the reporter/);
    await fail(() => returnToReporter(a.id, "again"), 409, /already with the reporter/);
    expect(a.history!.map((h) => h.kind)).toEqual(["uploaded", "returned"]);
  });
  it("reporter edits and sends it for approval again: back to the SAME assignee, optional comment mailed", async () => {
    const [a] = await stage();
    returnToReporter(a.id, "needs more detail"); await flushNotifications(); mails.length = 0; rcpts = [];
    editRecord(a.id, { Description: "More detail now" }, "reporter@smartshift.com");     // reporter may edit while in review
    resubmit(a.id, "Added the dump and the object names", "reporter@smartshift.com"); await flushNotifications();
    expect(a.AssignApprovalStatus).toBe("In Progress"); expect(stats()).toMatchObject({ reporterReview: 0, pending: 2 });
    expect(rcpts).toEqual([["mkarthik@smartshift.com"]]);
    expect(mails[0].subject).toMatch(/^Back for approval:/); expect(mails[0].text).toContain("Added the dump and the object names");
    expect(mails[0].text).toContain(`?tab=pending&record=${a.id}`);
    await fail(() => resubmit(a.id), 409, /not waiting for the reporter/);
    mails.length = 0; rcpts = [];
    returnToReporter(a.id, "once more"); await flushNotifications(); mails.length = 0; rcpts = [];
    resubmit(a.id, ""); await flushNotifications();                                       // comment is optional
    expect(mails[0].text).not.toContain("Comment:"); expect(a.history!.filter((h) => h.kind === "resubmitted")).toHaveLength(2);
  });
  it("a reassigned defect returns to the REASSIGNED tab and the new assignee is mailed", async () => {
    const [a] = await stage();
    await reassign(a.id, "Rahul Verma", "yours"); await flushNotifications();
    returnToReporter(a.id, "check please"); await flushNotifications(); mails.length = 0; rcpts = [];
    resubmit(a.id, "done"); await flushNotifications();
    expect(a.AssignApprovalStatus).toBe("Changed Assignee"); expect(rcpts).toEqual([["rahul.verma@smartshift.com"]]); expect(mails[0].text).toContain("?tab=reassigned");
    await approve(a.id); expect(a.AssignApprovalStatus).toBe("Approved");
  });
});

describe("e-mail status per defect", () => {
  it("shows the latest mail for each defect: sent, failed, none", async () => {
    resetDbForTests(newDb());
    const rows = sampleRows().slice(0, 2); rows.forEach((r) => (r.AssigneeEmail = "mkarthik@smartshift.com"));
    await ingest(await buildTemplate({ sample: rows }), "m.xlsx", "immediate"); await flushNotifications();
    const [a, b] = getDb().records;
    expect(mailStatusIndex().get(a.id)).toMatchObject({ label: "Approval request", delivered: true, to: "mkarthik@smartshift.com" });
    returnToReporter(a.id, "x"); await flushNotifications();
    expect(mailStatusIndex().get(a.id)).toMatchObject({ label: "Returned to reporter", delivered: true });
    expect(mailStatusIndex().get(b.id)?.label).toBe("Approval request");
    await approve(b.id); await flushNotifications();
    expect(mailStatusIndex().get(b.id)).toMatchObject({ label: "Jira ticket created", delivered: true });
    process.env.SMTP_HOST = ""; resubmit(a.id, ""); await flushNotifications(); process.env.SMTP_HOST = "127.0.0.1";
    expect(mailStatusIndex().get(a.id)).toMatchObject({ label: "Sent for approval again", delivered: false });
  });
});

describe("sign-in tokens and permissions", () => {
  it("signs and verifies tokens, rejects tampering, wrong kind and expiry", async () => {
    const t = await signToken({ t: "login", e: "a@smartshift.com", exp: Date.now() + 60000 }, "s3cret-s3cret");
    expect(await verifyToken(t, "login", "s3cret-s3cret")).toMatchObject({ e: "a@smartshift.com" });
    expect(await verifyToken(t, "session", "s3cret-s3cret")).toBeNull(); expect(await verifyToken(t, "login", "other-secret")).toBeNull();
    expect(await verifyToken(t.slice(0, -2) + "xx", "login", "s3cret-s3cret")).toBeNull();
    expect(await verifyToken(await signToken({ t: "login", e: "a@smartshift.com", exp: Date.now() - 1 }, "s3cret-s3cret"), "login", "s3cret-s3cret")).toBeNull();
  });
  it("allows only listed domains / addresses, and Open repo only for the listed users", () => {
    process.env.AUTH_ALLOWED_DOMAINS = "smartshift.com"; process.env.AUTH_ALLOWED_EMAILS = "partner@other.com"; process.env.ADMIN_EMAILS = "mkarthik@smartshift.com";
    expect(emailAllowed("Rahul@SmartShift.com")).toBe(true); expect(emailAllowed("partner@other.com")).toBe(true);
    expect(emailAllowed("x@evil.com")).toBe(false); expect(emailAllowed("not-an-email")).toBe(false); expect(emailAllowed("a@smartshift.com.evil.com")).toBe(false);
    delete process.env.OPEN_DRIVE_USERS;
    expect(canOpenDrive("mkarthik@smartshift.com")).toBe(true); expect(canOpenDrive("rahul@smartshift.com")).toBe(false);
    process.env.OPEN_DRIVE_USERS = "mkarthik@smartshift.com, priya@smartshift.com"; expect(canOpenDrive("priya@smartshift.com")).toBe(true); expect(canOpenDrive("rahul@smartshift.com")).toBe(false);
    process.env.OPEN_DRIVE_USERS = "*"; expect(canOpenDrive("rahul@smartshift.com")).toBe(true);
  });
});

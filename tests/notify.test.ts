import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "notify-"));
process.env.SAMPLE_ASSIGNEE_EMAIL = "mkarthik@smartshift.com"; process.env.SAMPLE_REPORTER_EMAIL = "mkarthik@smartshift.com";
process.env.SYNC_MODE = "none"; process.env.JIRA_BASE_URL = ""; process.env.ATTACHMENT_ROOT = process.cwd(); process.env.SEED_DEMO_DATA = "false";
process.env.APP_BASE_URL = "https://hub.smartshift.com/"; process.env.SMTP_FROM = "CleanCore Defect Hub <hub@smartshift.com>";
process.env.SMTP_IGNORE_TLS = "true"; process.env.NOTIFY_USER_MAP = JSON.stringify({ "Medisetty Karthik": "mkarthik@smartshift.com", "Senior Person": "senior.person@smartshift.com" });

import { approve, ingest, reassign } from "@/lib/engine";
import { buildTemplate } from "@/lib/excel";
import { sampleRows } from "@/lib/sample";
import { flushNotifications, sendTestMail, resolveRecipient } from "@/lib/notify";
import { getDb, newDb, resetDbForTests } from "@/lib/store";

const mails: ParsedMail[] = []; let rcpts: string[][] = [];
let srv: SMTPServer; let port = 0;
beforeAll(async () => {
  srv = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, session, cb) {
    simpleParser(stream).then((m) => { mails.push(m); rcpts.push(session.envelope.rcptTo.map((r) => r.address)); cb(); }, cb);
  } });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r)); port = (srv.server.address() as { port: number }).port;
  process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String(port);
});
afterAll(() => srv.close());
beforeEach(() => { mails.length = 0; rcpts = []; resetDbForTests(newDb()); delete process.env.NOTIFY_FALLBACK_EMAIL; process.env.SMTP_HOST = "127.0.0.1"; });

const wb = async (mut: (rows: ReturnType<typeof sampleRows>) => void = () => undefined) => { const r = sampleRows(); mut(r); return buildTemplate({ sample: r }); };

describe("e-mail notifications", () => {
  it("test mode NOTIFY_REDIRECT_TO: mail goes to the test inbox, dashboard keeps the real recipient", async () => {
    process.env.NOTIFY_REDIRECT_TO = JSON.stringify({ "mkarthik@smartshift.com": "karthik-hub@yopmail.com", "*": "other-hub@yopmail.com" });
    try {
      await ingest(await wb((r) => { r[1].AssigneeEmail = "other.user@smartshift.com"; }), "x.xlsx", "immediate"); await flushNotifications();
      expect(rcpts.flat().sort()).toEqual(["karthik-hub@yopmail.com", "other-hub@yopmail.com"]);
      expect(mails.every((m) => /^\[for [^\]]+\] Approval requested/.test(m.subject ?? ""))).toBe(true);
      expect(getDb().notifications.map((n) => n.to).sort()).toEqual(["mkarthik@smartshift.com", "other.user@smartshift.com"]);
      expect(getDb().notifications.every((n) => n.delivered)).toBe(true);
    } finally { delete process.env.NOTIFY_REDIRECT_TO; }
  });

  it("upload: ONE digest mail to the assignee listing all their defects, with dashboard links", async () => {
    await ingest(await wb(), "Revised_Sample.xlsx", "immediate"); await flushNotifications();
    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(rcpts[0]).toEqual(["mkarthik@smartshift.com"]);
    expect(m.subject).toMatch(/Approval requested: 5 defects/); expect(m.from?.text).toContain("hub@smartshift.com");
    expect(m.text).toContain("https://hub.smartshift.com/?tab=pending");           // trailing slash in APP_BASE_URL is normalised
    for (const r of getDb().records) expect(m.text).toContain(`record=${r.id}`);
    expect(m.html).toContain("Review and approve".slice(0, 6)); expect(m.html).toContain("Open Pending Approvals");
    expect(getDb().notifications.at(-1)).toMatchObject({ to: "mkarthik@smartshift.com", channel: "email", delivered: true });
  });

  it("assignee given as NAME or EMAIL both get a mail; one mail per assignee", async () => {
    await ingest(await wb((r) => { r[0].AssigneeEmail = "Medisetty Karthik"; r[1].AssigneeEmail = "other.user@smartshift.com"; r[2].AssigneeEmail = "MKarthik@smartshift.com"; }), "x.xlsx", "immediate"); await flushNotifications();
    expect(mails).toHaveLength(2);                                   // 2 addresses -> 2 mails (name + email of the same person are merged)
    expect(rcpts.flat().sort()).toEqual(["mkarthik@smartshift.com", "other.user@smartshift.com"]);
    const mk = mails[rcpts.findIndex((r) => r[0] === "mkarthik@smartshift.com")];
    expect(mk.subject).toMatch(/Approval requested: 4 defects/);
  });

  it("reassign: the NEW assignee (given as a name) is mailed a link to the Reassigned tab; approve then mails assignee + reporter", async () => {
    await ingest(await wb((r) => r.splice(1)), "one.xlsx", "immediate"); await flushNotifications(); mails.length = 0; rcpts = [];
    const rec = getDb().records[0]; rec.ReporterEmail = "reporter@smartshift.com";
    await reassign(rec.id, "Senior Person", "please check"); await flushNotifications();
    expect(rcpts).toEqual([["senior.person@smartshift.com"]]);
    expect(mails[0].subject).toMatch(/^Reassigned to you:/); expect(mails[0].text).toContain(`https://hub.smartshift.com/?tab=reassigned&record=${rec.id}`);
    expect(mails[0].text).toContain("please check");
    mails.length = 0; rcpts = [];
    await approve(rec.id); await flushNotifications();
    expect(rcpts.flat().sort()).toEqual(["reporter@smartshift.com", "senior.person@smartshift.com"]);
    expect(mails[0].subject).toMatch(/Jira ticket JAIT-\d+ created/); expect(mails[0].text).toContain(rec.JiraTicketID);
  });

  it("html is escaped (no injection from sheet text)", async () => {
    await ingest(await wb((r) => { r.splice(1); r[0].Summary = "<script>alert(1)</script> & co"; }), "e.xlsx", "immediate"); await flushNotifications();
    expect(mails[0].html).not.toContain("<script>"); expect(mails[0].html).toContain("&lt;script&gt;");
  });

  it("unknown name: warns, uses NOTIFY_FALLBACK_EMAIL when set, otherwise records a clear error; the upload never fails", async () => {
    await ingest(await wb((r) => { r.splice(1); r[0].AssigneeEmail = "Nobody Known"; }), "n.xlsx", "immediate"); await flushNotifications();
    expect(mails).toHaveLength(0); expect(getDb().notifications.at(-1)!.error).toMatch(/No e-mail address found/); expect(getDb().records).toHaveLength(1);
    process.env.NOTIFY_FALLBACK_EMAIL = "admin@smartshift.com";
    await ingest(await wb((r) => { r.splice(1); r[0].AssigneeEmail = "Nobody Known"; r[0].Summary = "different summary entirely for second upload"; r[0].Description = "other text altogether zzz"; }), "n2.xlsx", "immediate"); await flushNotifications();
    expect(rcpts).toEqual([["admin@smartshift.com"]]); expect(mails[0].subject).toMatch(/^\[no address for Nobody Known\]/);
  });

  it("SMTP down: ingest + approve still succeed, delivery recorded as failed", async () => {
    process.env.SMTP_HOST = "127.0.0.1"; const saved = process.env.SMTP_PORT; process.env.SMTP_PORT = "1";
    const s = await ingest(await wb((r) => r.splice(1)), "d.xlsx", "immediate"); await flushNotifications();
    expect(s.staged).toBe(1); expect(getDb().notifications.at(-1)).toMatchObject({ delivered: false });
    expect(getDb().notifications.at(-1)!.error).toMatch(/ECONNREFUSED|connect/i);
    await approve(getDb().records[0].id); await flushNotifications();
    expect(getDb().records[0].AssignApprovalStatus).toBe("Approved");
    process.env.SMTP_PORT = saved;
  });

  it("SMTP not configured: nothing is sent, workflow unaffected", async () => {
    delete process.env.SMTP_HOST;
    const s = await ingest(await wb(), "off.xlsx", "immediate"); await flushNotifications();
    expect(s.staged).toBe(5); expect(mails).toHaveLength(0); expect(getDb().notifications.at(-1)!.error).toMatch(/SMTP_HOST/);
  });

  it("test mail + recipient resolution", async () => {
    await sendTestMail("mkarthik@smartshift.com"); expect(mails[0].subject).toMatch(/test e-mail/);
    expect(await resolveRecipient("Medisetty Karthik")).toEqual({ email: "mkarthik@smartshift.com", via: "map" });
    expect(await resolveRecipient("A.B@X.com")).toEqual({ email: "a.b@x.com", via: "email" });
    expect(await resolveRecipient("nobody")).toBeNull();
  });
});

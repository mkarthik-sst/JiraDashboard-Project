import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import net from "node:net";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sink-"));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sinkdata-")); process.env.SYNC_MODE = "none"; process.env.JIRA_BASE_URL = "";
process.env.SMTP_HOST = "127.0.0.1"; process.env.MAIL_SINK_DIR = dir; process.env.APP_BASE_URL = "http://localhost:3000";
const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

import { startSink, stopSink, listSinkMails, sinkWanted, sinkActive } from "@/lib/sink";
import { sendTestMail } from "@/lib/notify";
import { getConfig } from "@/lib/config";

describe("built-in test mailbox", () => {
  afterAll(() => stopSink());
  it("starts itself for a local SMTP_HOST and saves mails sent by the Hub, no separate window", async () => {
    const port = await freePort(); process.env.SMTP_PORT = String(port);
    expect(sinkWanted()).toBe(true); expect(getConfig().mail.ignoreTls).toBe(true);
    expect(await startSink()).toBe(true); expect(sinkActive()).toBe(true);
    await sendTestMail("mkarthik@smartshift.com");
    const mails = listSinkMails(dir);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "mkarthik@smartshift.com", subject: "smartShift Defect Hub - test e-mail" });
    expect(fs.readFileSync(path.join(dir, mails[0].file), "utf8")).toContain("http://localhost:3000/?tab=pending");
  });
  it("is not wanted for a real SMTP host or when switched off", () => {
    process.env.SMTP_HOST = "smtp.gmail.com"; expect(sinkWanted()).toBe(false);
    process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_BUILTIN_SINK = "false"; expect(sinkWanted()).toBe(false); delete process.env.SMTP_BUILTIN_SINK;
  });
});

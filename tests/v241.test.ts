import { describe, expect, it } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "v241-"));
process.env.SYNC_MODE = "none"; process.env.JIRA_BASE_URL = ""; process.env.SEED_DEMO_DATA = "false";
process.env.SAMPLE_ASSIGNEE_EMAIL = "a@x.com"; process.env.SAMPLE_REPORTER_EMAIL = "r@x.com";

import { configWarnings } from "@/lib/config-check";
import { driveStatusOf } from "@/lib/links";
import { canOpenDrive } from "@/lib/auth";
import { explainMailError } from "@/components/mail-cell";
import { ingest } from "@/lib/engine";
import { buildSampleWorkbook } from "@/lib/sample";
import { getDb } from "@/lib/store";

describe("v2.4.1 usability fixes", () => {
  it("warns when no .env.local exists (settings saved under another name)", () => {
    const prev = process.cwd(); const d = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-")); fs.writeFileSync(path.join(d, ".env.local.sample"), "X=1");
    for (const k of ["SMTP_HOST", "GDRIVE_FOLDER_ID", "AUTH_MODE"]) delete process.env[k];
    process.chdir(d);
    try { const w = configWarnings(); expect(w[0].level).toBe("error"); expect(w[0].text).toContain("rename .env.local.sample to .env.local"); } finally { process.chdir(prev); }
  });
  it("OPEN_DRIVE_USERS written as '* = everybody' still means everybody", () => {
    process.env.OPEN_DRIVE_USERS = "* = everybody"; expect(canOpenDrive("anyone@x.com")).toBe(true); delete process.env.OPEN_DRIVE_USERS;
  });
  it("explains e-mail errors in plain words", () => {
    expect(explainMailError("E-mail is off (SMTP_HOST not set)").fix.join(" ")).toContain(".env.local");
    expect(explainMailError("Invalid login: 535-5.7.8 Username and Password not accepted").what).toMatch(/user name or password/);
    expect(explainMailError("connect ETIMEDOUT 1.2.3.4:465").what).toMatch(/could not reach/);
  });
  it("Drive status per defect is 'off' when Drive storage is not enabled", async () => {
    await ingest(Buffer.from(await buildSampleWorkbook(false)), "s.xlsx", "immediate");
    const r = getDb().records[0];
    expect(driveStatusOf(r, true).state).toBe("off");
  });
});

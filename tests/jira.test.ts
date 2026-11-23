import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jira-"));
const calls: { method: string; url: string; body: string; auth: string }[] = [];
let issueMode: "ok" | "429-then-ok" | "400" | "500" | "bad-priority" = "ok"; let n429 = 0;
const srv = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls.push({ method: req.method!, url: req.url!, body, auth: String(req.headers.authorization) });
    const json = (code: number, o: unknown, h: Record<string, string> = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(JSON.stringify(o)); };
    if (req.url === "/rest/api/3/myself") return json(200, { accountId: "acc-me", displayName: "Token Owner" });
    if (req.url!.startsWith("/rest/api/3/user/assignable/search")) {
      const q = decodeURIComponent(req.url!.split("query=")[1].split("&")[0]);
      return q === "Hidden Person" ? json(200, [{ accountId: "acc-hidden", displayName: "Hidden Person", active: true }]) : json(200, []);
    }
    if (req.url!.startsWith("/rest/api/3/user/search")) {
      const q = decodeURIComponent(req.url!.split("query=")[1]);
      return q.startsWith("ghost@") ? json(200, []) : json(200, [{ accountId: "acc-" + q.split("@")[0], emailAddress: q, active: true }]);
    }
    if (req.url === "/rest/api/3/issue") {
      if (issueMode === "400") return json(400, { errorMessages: [], errors: { issuetype: "Issue type 'Bugg' is not valid" } });
      if (issueMode === "bad-priority" && JSON.parse(body).fields.priority) return json(400, { errorMessages: [], errors: { priority: "Priority name 'High Attention' is not valid" } });
      if (issueMode === "500") return json(503, { errorMessages: ["down"] });
      if (issueMode === "429-then-ok" && n429++ < 1) return json(429, {}, { "retry-after": "0" });
      return json(201, { key: "JAIT-4242" });
    }
    json(404, {});
  });
});
let port = 0;
beforeAll(async () => { await new Promise<void>((r) => srv.listen(0, r)); port = (srv.address() as { port: number }).port;
  Object.assign(process.env, { JIRA_BASE_URL: `http://127.0.0.1:${port}`, JIRA_EMAIL: "svc@smartshift.com", JIRA_API_TOKEN: "tok", JIRA_PROJECT_MAP: '{"OLD":"NEWKEY"}', JIRA_USER_MAP: '{"mapped@smartshift.com":"acc-mapped"}', JIRA_LEAD_FIELD: "customfield_10042" }); });
afterAll(() => srv.close());

import { createJiraIssue, buildIssuePayload, resolveProjectKey, JiraError } from "@/lib/jira";
import { buildSeed } from "@/lib/seed";
const rec = () => ({ ...buildSeed().records[4], Customer: "SECRET-CUSTOMER-NAME", ProjectKey: "JAIT", Priority: "High Attention", AttachmentPaths: "", attachments: [] as any[] });

describe("Jira live path (emulator)", () => {
  it("routes project keys via JIRA_PROJECT_MAP; sheet key is used as-is otherwise", () => {
    expect(resolveProjectKey("OLD")).toBe("NEWKEY"); expect(resolveProjectKey("JAIT")).toBe("JAIT");
  });
  it("builds a minimal v3 payload: ADF description, NO Customer / components / labels", () => {
    const r = rec();
    const f = buildIssuePayload(r as any, { assigneeAccountId: "a1" }).fields as any;
    expect(f.project).toEqual({ key: "JAIT" }); expect(f.description.type).toBe("doc");
    expect(f.priority).toEqual({ name: "High Attention" }); expect(f.customfield_10042).toBe(r.Lead); expect(f.assignee).toEqual({ accountId: "a1" });
    expect(f.components).toBeUndefined();
    expect(JSON.stringify(f)).not.toContain("SECRET-CUSTOMER-NAME");
  });
  it("creates an issue with Basic auth and looks up accountIds (ReassignedToEmail wins)", async () => {
    calls.length = 0; issueMode = "ok";
    const r = { ...rec(), ReassignedToEmail: "senior.cfl@smartshift.com" };
    const out = await createJiraIssue(r as any);
    expect(out.key).toBe("JAIT-4242"); expect(out.url).toMatch(/\/browse\/JAIT-4242$/);
    const create = calls.find((c) => c.url === "/rest/api/3/issue")!;
    expect(create.auth).toBe("Basic " + Buffer.from("svc@smartshift.com:tok").toString("base64"));
    expect(JSON.parse(create.body).fields.assignee.accountId).toBe("acc-senior.cfl");
  });
  it("drops an unknown optional field (priority) and still creates the ticket, with a warning", async () => {
    issueMode = "bad-priority"; calls.length = 0;
    const out = await createJiraIssue(rec() as any);
    expect(out.key).toBe("JAIT-4242"); expect(out.warnings.join(" ")).toMatch(/priority/i);
    expect(calls.filter((c) => c.url === "/rest/api/3/issue")).toHaveLength(2);
  });
  it("resolves a display name as assignee", async () => {
    issueMode = "ok";
    const out = await createJiraIssue({ ...rec(), AssigneeEmail: "Medisetty Karthik" } as any);
    expect(out.key).toBe("JAIT-4242");
  });
  it("resolves the API token owner via /myself even when e-mail search is blocked", async () => {
    issueMode = "ok"; calls.length = 0;
    await createJiraIssue({ ...rec(), AssigneeEmail: "svc@smartshift.com" } as any);
    expect(JSON.parse(calls.find((c) => c.url === "/rest/api/3/issue")!.body).fields.assignee.accountId).toBe("acc-me");
  });
  it("finds users with a private e-mail via the project-assignable search by display name", async () => {
    issueMode = "ok"; calls.length = 0;
    await createJiraIssue({ ...rec(), AssigneeEmail: "Hidden Person" } as any);
    expect(JSON.parse(calls.find((c) => c.url === "/rest/api/3/issue")!.body).fields.assignee.accountId).toBe("acc-hidden");
  });
  it("JIRA_USER_MAP overrides lookup", async () => {
    issueMode = "ok"; calls.length = 0;
    await createJiraIssue({ ...rec(), AssigneeEmail: "mapped@smartshift.com" } as any);
    expect(JSON.parse(calls.find((c) => c.url === "/rest/api/3/issue")!.body).fields.assignee.accountId).toBe("acc-mapped");
  });
  it("retries on 429 and succeeds", async () => { issueMode = "429-then-ok"; n429 = 0; expect((await createJiraIssue(rec() as any)).key).toBe("JAIT-4242"); });
  it("surfaces 400 field errors without retrying", async () => {
    issueMode = "400"; calls.length = 0;
    await expect(createJiraIssue(rec() as any)).rejects.toThrow(/Issue type 'Bugg' is not valid/);
    expect(calls.filter((c) => c.url === "/rest/api/3/issue")).toHaveLength(1);
  });
  it("gives up after 3 attempts on persistent 503", async () => {
    issueMode = "500"; calls.length = 0;
    await expect(createJiraIssue(rec() as any)).rejects.toBeInstanceOf(JiraError);
    expect(calls.filter((c) => c.url === "/rest/api/3/issue")).toHaveLength(3);
  }, 20000);
  it("fails clearly when assignee does not exist in Jira", async () => {
    issueMode = "ok";
    await expect(createJiraIssue({ ...rec(), AssigneeEmail: "ghost@smartshift.com" })).rejects.toThrow(/not found in Jira/);
  });
});

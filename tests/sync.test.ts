import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http";
import ExcelJS from "exceljs";

const d = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
process.env.DATA_DIR = d; process.env.SYNC_MODE = "folder"; process.env.SYNC_FOLDER_PATH = path.join(d, "share");
process.env.ATTACHMENT_ROOT = process.cwd(); process.env.JIRA_BASE_URL = ""; process.env.SEED_DEMO_DATA = "false";
import crypto from "node:crypto";
import { runSync, MASTER_FILE, restoreFromDrive, testDrive } from "@/lib/sync";
import { resetDriveAuthCache, driveLinkOf } from "@/lib/drive";
import { COLUMNS } from "@/lib/schema";
import { buildSeed } from "@/lib/seed";
import { parseWorkbook } from "@/lib/excel";
import { getDb, newDb, resetDbForTests, replaceDb } from "@/lib/store";
import { approve, ingest, reassign } from "@/lib/engine";
import { buildSampleWorkbook } from "@/lib/sample";

describe("folder + webhook", () => {
  it("folder sync writes a parseable master + no stray lock/tmp", async () => {
    resetDbForTests({ ...newDb(), ...buildSeed() });
    const st = await runSync();
    expect(st.state).toBe("ok");
    expect(fs.readdirSync(path.join(d, "share"))).toEqual([MASTER_FILE]);
    const r = await parseWorkbook(fs.readFileSync(path.join(d, "share", MASTER_FILE)), 1000);
    expect(r.rows.length + r.issues.length).toBeGreaterThan(5);
  });
  it("webhook sends base64 xlsx + secret header", async () => {
    let got: any = {}; let hdr = "";
    const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got = JSON.parse(b); hdr = String(req.headers["x-defect-hub-secret"]); res.end("ok"); }); });
    await new Promise<void>((r) => srv.listen(0, r));
    process.env.SYNC_MODE = "webhook"; process.env.POWER_AUTOMATE_URL = `http://127.0.0.1:${(srv.address() as any).port}/x`; process.env.POWER_AUTOMATE_SECRET = "s3cret"; process.env.POWER_AUTOMATE_INCLUDE_ROWS = "true";
    resetDbForTests({ ...newDb(), ...buildSeed() });
    const st = await runSync();
    srv.close();
    expect(st.state).toBe("ok"); expect(hdr).toBe("s3cret"); expect(got.count).toBe(11);
    expect(Buffer.from(got.fileBase64, "base64").subarray(0, 2).toString()).toBe("PK"); expect(Object.keys(got.rows[0])).toHaveLength(COLUMNS.length);
    expect(got.rows[0].Customer).toBeDefined();
  });
});

/** Minimal Google Drive v3 + token endpoint emulator: folders, multipart create, media update, list by name/parent, media download. */
describe("Google Drive storage (Drive API emulator)", () => {
  type Item = { id: string; name: string; mime: string; parent: string | null; data: Buffer | null };
  const items = new Map<string, Item>(); let n = 0; let failUploads = 0; let quotaError = false; let srv: http.Server;
  let hideFiles = false; let tokenCalls = 0; let lastGrant = ""; let lastAssertion = "";
  const pathOf = (it: Item): string => (it.parent && it.parent !== "ROOT" ? pathOf(items.get(it.parent)!) + "/" : "") + (it.id === "ROOT" ? "" : it.name);
  const byPath = (p: string) => [...items.values()].find((i) => i.id !== "ROOT" && pathOf(i) === p);
  const folders = () => [...items.values()].filter((i) => i.mime.endsWith("folder") && i.id !== "ROOT").map(pathOf);
  const view = (i: Item) => ({ id: i.id, name: i.name, mimeType: i.mime, webViewLink: `https://drive.test/view/${i.id}` });
  beforeAll(async () => {
    items.set("ROOT", { id: "ROOT", name: "Defect Hub", mime: "application/vnd.google-apps.folder", parent: null, data: null });
    srv = http.createServer((req, res) => {
      const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks), u = new URL(req.url!, "http://x");
        const json = (c: number, o: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
        if (u.pathname === "/token") { tokenCalls++; const f = new URLSearchParams(body.toString()); lastGrant = f.get("grant_type") ?? ""; lastAssertion = f.get("assertion") ?? ""; return json(200, { access_token: "tok-1", expires_in: 3600 }); }
        if (req.headers.authorization !== "Bearer tok-1") return json(401, { error: { message: "bad token" } });
        if (u.pathname === "/drive/v3/files" && req.method === "GET") {
          const q = u.searchParams.get("q") ?? ""; const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, "$1"); const parent = /'([^']+)' in parents/.exec(q)?.[1];
          const wf = /mimeType='application\/vnd.google-apps.folder'/.test(q), nf = /mimeType!=/.test(q);
          if (hideFiles && nf) return json(200, { files: [] });                  // real Drive: name search can lag behind a just-created file
          return json(200, { files: [...items.values()].filter((i) => i.parent === parent && i.name === name && (!wf || i.mime.endsWith("folder")) && (!nf || !i.mime.endsWith("folder"))).map(view) });
        }
        if (u.pathname === "/drive/v3/files" && req.method === "POST") {
          const j = JSON.parse(body.toString()); const it: Item = { id: `f${++n}`, name: j.name, mime: j.mimeType, parent: j.parents[0], data: null }; items.set(it.id, it); return json(200, view(it));
        }
        let m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
        if (m && req.method === "GET") {
          const it = items.get(m[1]); if (!it) return json(404, { error: { message: "File not found" } });
          if (u.searchParams.get("alt") === "media") { res.writeHead(200); return res.end(it.data ?? Buffer.alloc(0)); }
          return json(200, { ...view(it), capabilities: { canAddChildren: true } });
        }
        if (u.pathname === "/upload/drive/v3/files" && req.method === "POST") {
          if (quotaError) return json(403, { error: { message: "Service Accounts do not have storage quota.", errors: [{ reason: "storageQuotaExceeded" }] } });
          if (failUploads > 0) { failUploads--; return json(500, { error: { message: "boom" } }); }
          const b = /boundary=(.+)$/.exec(String(req.headers["content-type"]))![1]; const parts = body.toString("binary").split(`--${b}`).slice(1, -1);
          const meta = JSON.parse(parts[0].split("\r\n\r\n")[1].trim()); const raw = parts[1]; const start = raw.indexOf("\r\n\r\n") + 4;
          const it: Item = { id: `f${++n}`, name: meta.name, mime: "application/octet-stream", parent: meta.parents[0], data: Buffer.from(raw.slice(start, raw.length - 2), "binary") }; items.set(it.id, it); return json(200, view(it));
        }
        m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
        if (m && req.method === "PATCH") { if (quotaError) return json(403, { error: { message: "Service Accounts do not have storage quota.", errors: [{ reason: "storageQuotaExceeded" }] } }); const it = items.get(m[1]); if (!it) return json(404, {}); if (failUploads > 0) { failUploads--; return json(500, {}); } it.data = body; return json(200, view(it)); }
        json(404, { error: { message: "Not Found" } });
      });
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as any).port}`;
    Object.assign(process.env, {
      SYNC_MODE: "gdrive", GDRIVE_FOLDER_ID: "ROOT", GDRIVE_API_URL: `${base}/drive/v3`, GDRIVE_UPLOAD_URL: `${base}/upload/drive/v3`, GDRIVE_TOKEN_URL: `${base}/token`,
      GDRIVE_OAUTH_CLIENT_ID: "cid", GDRIVE_OAUTH_CLIENT_SECRET: "sec", GDRIVE_OAUTH_REFRESH_TOKEN: "rt",
    });
    delete process.env.GDRIVE_KEY_FILE; delete process.env.GDRIVE_SERVICE_ACCOUNT_JSON; resetDriveAuthCache();
  });
  afterAll(() => srv.close());

  it("connection test opens the folder and writes one file (OAuth refresh-token sign-in)", async () => {
    const r = await testDrive();
    expect(r.folder).toBe("Defect Hub"); expect(r.signIn).toBe("oauth"); expect(lastGrant).toBe("refresh_token");
    expect(byPath("state/connection-test.txt")).toBeTruthy(); expect(r.link).toMatch(/^https:\/\/drive\.test\/view\//);
  });

  it("service-account sign-in sends a valid RS256-signed JWT assertion", async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GDRIVE_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify({ client_email: "hub@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) })).toString("base64");
    delete process.env.GDRIVE_OAUTH_REFRESH_TOKEN; resetDriveAuthCache();
    const r = await testDrive();
    expect(r.signIn).toBe("service-account"); expect(r.account).toBe("hub@proj.iam.gserviceaccount.com"); expect(lastGrant).toMatch(/jwt-bearer/);
    const [h, c, sig] = lastAssertion.split(".");
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64"))).toBe(true);
    expect(JSON.parse(Buffer.from(c, "base64").toString()).iss).toBe("hub@proj.iam.gserviceaccount.com");
    delete process.env.GDRIVE_SERVICE_ACCOUNT_JSON; process.env.GDRIVE_OAUTH_REFRESH_TOKEN = "rt"; resetDriveAuthCache();
  });

  it("token is cached between calls", async () => {
    resetDriveAuthCache(); tokenCalls = 0;
    await testDrive(); await testDrive();
    expect(tokenCalls).toBe(1);
  });

  it("a service-account storage-quota error explains Shared Drive / OAuth", async () => {
    quotaError = true;
    try { await expect(testDrive()).rejects.toThrow(/Shared Drive/); } finally { quotaError = false; }
  });

  it("upload stores original + attachments + tracking + master + state; approvals update the tracking workbook; folders are created once", async () => {
    resetDbForTests(newDb());
    const s = await ingest(await buildSampleWorkbook(), "Revised_Sample.xlsx", "immediate");
    expect(s.originalDrivePath).toMatch(/^uploads\/\d{4}-\d{2}-\d{2}\/.+_Revised_Sample\.xlsx$/);
    expect(getDb().driveFiles.filter((f) => f.kind === "attachment").length).toBeGreaterThanOrEqual(5);
    await runSync();
    expect(byPath(s.originalDrivePath!)).toBeTruthy(); expect(byPath(s.trackingDrivePath!)).toBeTruthy();
    for (const x of ["analysis_cast_error.docx", "cds_duplicate_rows.png", "cds_row_counts.xlsx", "cfl_field_missing.png", "cfl_propagation_notes.docx", "mrp_type_comparison.xlsx", "st22_cast_dump.png"])
      expect(byPath(`attachments/${s.id}/${x}`)).toBeTruthy();
    expect(byPath(`master/${MASTER_FILE}`)).toBeTruthy(); expect(byPath("state/store.json")).toBeTruthy();
    expect(getDb().driveFiles.every((f) => f.pushedAt)).toBe(true);
    expect(driveLinkOf(s.originalDrivePath!)).toMatch(/^https:\/\/drive\.test\/view\//);
    const fl = folders(); expect(new Set(fl).size).toBe(fl.length);                              // no duplicate folders

    const [a, b] = getDb().records;
    await approve(a.id); await reassign(b.id, "Senior Person"); await approve(b.id);
    await runSync();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(byPath(s.trackingDrivePath!)!.data as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Defects")!;
    const hdr = (ws.getRow(1).values as string[]).slice(1); const col = (h: string) => hdr.indexOf(h) + 1;
    const get = (row: number, h: string) => String(ws.getRow(row).getCell(col(h)).value ?? "");
    expect(get(2, "AssignApprovalStatus")).toBe("Approved"); expect(get(2, "JiraTicketID")).toMatch(/-\d+$/); expect(get(2, "ExecutionStatus")).toBe("PROCESSED"); expect(get(2, "Fix / Rule ID")).toBe("FIX-CAST-007");
    expect(get(3, "AssignApprovalStatus")).toBe("Approved"); expect(get(3, "ReassignStatus")).toBe("Approved"); expect(get(3, "ReassignedToEmail")).toBe("Senior Person");
    expect(get(4, "AssignApprovalStatus")).toBe("In Progress");
    expect(wb.getWorksheet("Attachments")).toBeTruthy();
    expect(items.size).toBeGreaterThan(10);
    const copies = [...items.values()].filter((i) => i.name === `${s.id}_Revised_Sample.xlsx` || i.name === MASTER_FILE);
    expect(copies.length).toBe(3);                                                                 // original + tracking (same name, other folder) + master... updated in place, not duplicated
  });

  it("a Jira ID / status change made WHILE a sync is running still reaches the tracking workbook", async () => {
    resetDbForTests(newDb());
    const s = await ingest(await buildSampleWorkbook(), "Race.xlsx", "immediate");
    const running = runSync();                                    // first push in flight (many files)
    await new Promise((r) => setTimeout(r, 5));
    const [a] = getDb().records;
    await approve(a.id);                                          // ticket created mid-sync
    await running;
    for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 120)); await runSync(); }   // the follow-up run(s)
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(byPath(s.trackingDrivePath!)!.data as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Defects")!; const hdr = (ws.getRow(1).values as string[]).slice(1);
    expect(String(ws.getRow(2).getCell(hdr.indexOf("JiraTicketID") + 1).value ?? "")).toMatch(/-\d+$/);
    expect(String(ws.getRow(2).getCell(hdr.indexOf("AssignApprovalStatus") + 1).value ?? "")).toBe("Approved");
  });

  it("Drive search lag does not create a second (stale) tracking file: known files are updated by id", async () => {
    resetDbForTests(newDb());
    const s = await ingest(await buildSampleWorkbook(), "Lag.xlsx", "immediate");
    await runSync();
    hideFiles = true;
    try {
      const [a] = getDb().records; await approve(a.id);
      await runSync();
    } finally { hideFiles = false; }
    const trackName = s.trackingDrivePath!.split("/").pop()!; const copies = [...items.values()].filter((i) => i.name === trackName && pathOf(i).startsWith("tracking/"));
    expect(copies.length).toBe(1);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(copies[0].data as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Defects")!; const hdr = (ws.getRow(1).values as string[]).slice(1);
    expect(String(ws.getRow(2).getCell(hdr.indexOf("JiraTicketID") + 1).value ?? "")).toMatch(/-\d+$/);
    expect(byPath("master/CleanCore_Recurrence_Report.xlsx")).toBeTruthy();
  });

  it("restore rebuilds the dashboard on an empty machine from state/store.json", async () => {
    const before = getDb().records.map((r) => [r.id, r.JiraTicketID, r.AssignApprovalStatus]);
    resetDbForTests(newDb());
    const r = await restoreFromDrive();
    expect(r).toEqual({ restored: true, records: before.length });
    expect(getDb().records.map((x) => [x.id, x.JiraTicketID, x.AssignApprovalStatus])).toEqual(before);
    expect(getDb().driveFiles.every((f) => f.pushedAt)).toBe(true);
    expect(getDb().records[0].attachments.length).toBeGreaterThan(0);
  });

  it("a Drive outage keeps files queued, then retries successfully (no data loss)", async () => {
    resetDbForTests(newDb());
    const s = await ingest(await buildSampleWorkbook(), "Outage.xlsx", "immediate");
    failUploads = 100;
    const bad = await runSync();
    expect(bad.state).toBe("error"); expect(bad.lastError).toMatch(/500/); expect(bad.queued).toBeGreaterThan(0);
    failUploads = 0;
    const ok = await runSync();
    expect(ok.state).toBe("ok"); expect(ok.queued).toBe(0);
    expect(byPath(s.originalDrivePath!)).toBeTruthy();
  });
});

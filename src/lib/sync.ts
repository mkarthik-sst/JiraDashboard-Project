/**
 * Background sync layer. After every committed change (debounced) the data is pushed to ONE target.
 *   gdrive  = durable STORAGE in a shared Google Drive folder: original uploads, attachment files, a live per-upload tracking
 *             workbook (statuses + Jira IDs), the master workbook and state/store.json (used to restore a fresh install). See drive.ts.
 *   folder  = master workbook to an SMB/UNC/mapped drive.
 *   webhook = master workbook (base64) to a Power Automate flow.
 * Edit this file to change targets, file names or the webhook payload.
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import { buildMasterWorkbook, buildRecurrenceWorkbook, buildTrackingWorkbook } from "./excel";
import { recurrenceReport } from "./engineering";
import { driveAuthKind, driveEnabled, driveFolderUrl, driveLinkOf, drivePut, driveRaw, driveRootInfo, serviceAccountEmail } from "./drive";
import { COLUMNS, FIELD, type DefectRecord } from "./schema";
import type { SyncStatus } from "./types";
import { log } from "./logger";
import { getDb, replaceDb, type DB } from "./store";

export const MASTER_FILE = "CleanCore_Defects_Master.xlsx";
export const RECURRENCE_FILE = "CleanCore_Recurrence_Report.xlsx";
type St = { status: SyncStatus; timer?: NodeJS.Timeout; retry?: NodeJS.Timeout; running: boolean; dirty: boolean };
const g = globalThis as unknown as { __chSync?: St };
const st = (g.__chSync ??= { status: { mode: "none", state: "idle", lastSyncAt: "", lastError: "", target: "", queued: 0, folderUrl: "", filesPushed: 0 }, running: false, dirty: false });

export function describeTarget(): string {
  const c = getConfig().sync;
  switch (c.mode) {
    case "folder": return path.join(c.folderPath, MASTER_FILE);
    case "gdrive": return `Google Drive folder ${c.gdriveFolderId}`;
    case "webhook": return c.webhookUrl ? new URL(c.webhookUrl).host : "";
    default: return "local only (data/store.json)";
  }
}
const queuedCount = () => { try { const d = getDb(); return d.driveFiles.filter((f) => !f.pushedAt).length + d.dirtySets.length; } catch { return 0; } };
export function getSyncStatus(): SyncStatus {
  const c = getConfig().sync;
  return { ...st.status, mode: c.mode, target: describeTarget(), queued: c.mode === "gdrive" ? queuedCount() : 0, folderUrl: c.mode === "gdrive" && driveEnabled() ? driveFolderUrl() : "" };
}

export function scheduleSync() {
  const c = getConfig().sync;
  if (c.mode === "none") return;
  st.dirty = true;
  st.status.state = "pending";
  if (st.timer) clearTimeout(st.timer);
  st.timer = setTimeout(() => void runSync(), c.debounceMs);
}

export async function runSync(): Promise<SyncStatus> {
  const c = getConfig().sync;
  if (c.mode === "none") return getSyncStatus();
  if (st.running) { st.dirty = true; return getSyncStatus(); }
  st.running = true; st.dirty = false; st.status.state = "syncing";
  if (st.retry) { clearTimeout(st.retry); st.retry = undefined; }
  let failed = false;
  try {
    const records = getDb().records;
    if (c.mode === "folder") await pushFolder(records);
    else if (c.mode === "gdrive") await pushDrive();
    else if (c.mode === "webhook") await pushWebhook(records);
    st.status.state = "ok"; st.status.lastError = ""; st.status.lastSyncAt = new Date().toISOString();
    log("SUCCESS", `Sync (${c.mode}) complete: ${records.length} records -> ${describeTarget()}`);
  } catch (e) {
    failed = true;
    st.status.state = "error"; st.status.lastError = (e as Error).message;
    log("ERROR", `Sync (${c.mode}) failed: ${(e as Error).message}`, { err: e });
  } finally {
    st.running = false;
    if (st.dirty) scheduleSync();
    else if (failed) { st.retry = setTimeout(() => void runSync(), 60000); st.retry.unref?.(); }  // nothing is lost: queue lives in the store
  }
  return getSyncStatus();
}

/** SMB / mapped-drive / UNC share. Atomic write (tmp + rename) and a .lock file to avoid clobbering a concurrent writer. */
async function pushFolder(records: DefectRecord[]) {
  const dir = getConfigFolder();
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, `${MASTER_FILE}.lock`);
  let fd: number | undefined;
  for (let i = 0; i < 10 && fd === undefined; i++) {
    try { fd = fs.openSync(lock, "wx"); }
    catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 60000) fs.unlinkSync(lock); } catch { /* raced */ }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (fd === undefined) throw new Error(`Could not acquire lock ${lock} (another writer holds it)`);
  try {
    const buf = await buildMasterWorkbook(records);
    const target = path.join(dir, MASTER_FILE);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, target);
  } finally {
    fs.closeSync(fd);
    try { fs.unlinkSync(lock); } catch { /* ignore */ }
  }
}
function getConfigFolder(): string {
  const p = getConfig().sync.folderPath;
  if (!p) throw new Error("SYNC_FOLDER_PATH is not set");
  return p;
}

/** Google Drive storage. Everything queued in the store is copied; a failure leaves it queued for the next run. */
async function pushDrive() {
  if (!driveEnabled()) throw new Error("Google Drive is not configured: set GDRIVE_FOLDER_ID and a sign-in (GDRIVE_KEY_FILE or the OAuth values)");
  const db = getDb();
  // 1) originals + attachment files
  for (const f of db.driveFiles.filter((x) => !x.pushedAt)) {
    if (!fs.existsSync(f.localPath)) { f.pushedAt = "missing-local"; log("WARNING", `Google Drive: local file for ${f.drivePath} is gone, skipped`); continue; }
    await drivePut(f.drivePath, fs.readFileSync(f.localPath));
    f.pushedAt = new Date().toISOString(); st.status.filesPushed++;
    log("INFO", `Google Drive: saved ${f.drivePath}`);
  }
  // 2) live tracking workbook per upload (statuses, Jira IDs, reassign / cancel info).
  //    The set is taken out of the dirty list BEFORE the (slow) upload, so a change made while it runs marks it dirty again and is pushed by the follow-up run.
  const todo = [...db.dirtySets]; db.dirtySets = [];
  try {
    for (const setId of todo) {
      const up = db.uploads.find((u) => u.id === setId);
      if (up?.trackingDrivePath) {
        const recs = db.records.filter((r) => r.uploadId === setId);
        const dups = db.duplicates.filter((d) => d.uploadId === setId);
        await drivePut(up.trackingDrivePath, await buildTrackingWorkbook(recs, up, dups));
        st.status.filesPushed++;
        log("INFO", `Google Drive: tracking workbook updated (${recs.length} records) ${up.trackingDrivePath}`);
      }
    }
  } catch (e) { for (const id of todo) if (!db.dirtySets.includes(id)) db.dirtySets.push(id); throw e; }
  // 3) master workbook + state snapshot (for restore)
  await drivePut("master/" + MASTER_FILE, await buildMasterWorkbook(db.records));
  await drivePut("master/" + RECURRENCE_FILE, await buildRecurrenceWorkbook(recurrenceReport(db.records)));
  const snapshot: DB = { ...db, driveFiles: db.driveFiles.map((f) => ({ ...f })) };
  await drivePut("state/store.json", Buffer.from(JSON.stringify(snapshot)));
  st.status.filesPushed += 2;
  fs.writeFileSync(path.join(getConfig().dataDir, "store.json"), JSON.stringify(db));
}

/** Fresh machine / new hosting instance: rebuild the dashboard from state/store.json in the Drive folder. Attachments are fetched lazily from Drive on demand. */
export async function restoreFromDrive(): Promise<{ restored: boolean; records: number }> {
  if (!driveEnabled()) throw new Error("Google Drive storage is not configured");
  const raw = await driveRaw("state/store.json");
  if (!raw) { log("INFO", "Google Drive restore: no state/store.json in the folder yet - starting empty"); return { restored: false, records: 0 }; }
  const db = JSON.parse(raw.toString("utf8")) as DB;
  if (db.version !== 1 || !Array.isArray(db.records)) throw new Error("state/store.json has an unexpected format");
  // everything in a snapshot is already in Drive; local copies may not exist on this machine
  db.driveFiles = (db.driveFiles ?? []).map((f) => ({ ...f, pushedAt: f.pushedAt || new Date().toISOString() }));
  db.driveLinks = db.driveLinks ?? {}; db.driveIds = db.driveIds ?? {};
  db.dirtySets = []; db.scheduled = (db.scheduled ?? []).filter((s) => s.status !== "SCHEDULED" && s.status !== "RUNNING");
  replaceDb({ ...db, duplicates: db.duplicates ?? [], notifications: db.notifications ?? [], uploads: db.uploads ?? [] });
  log("SUCCESS", `Restored ${db.records.length} records from Google Drive (${driveFolderUrl()})`);
  return { restored: true, records: db.records.length };
}

/** Connectivity + permission check ("Test Google Drive"): opens the shared folder and writes one small file. */
export async function testDrive(): Promise<{ folder: string; link: string; signIn: string; account: string }> {
  const c = getConfig().sync;
  if (c.mode !== "gdrive") throw new Error("Set SYNC_MODE=gdrive first");
  if (!c.gdriveFolderId) throw new Error("GDRIVE_FOLDER_ID is not set (the folder id is the last part of the folder's URL)");
  if (!driveEnabled()) throw new Error("No Google sign-in configured: set GDRIVE_KEY_FILE (service account) or GDRIVE_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN");
  const info = await driveRootInfo();
  if (!info.canEdit) throw new Error(`The Hub's Google account can see the folder "${info.name}" but may not add files: share it as Editor.`);
  await drivePut("state/connection-test.txt", Buffer.from(`Defect Hub connection test ${new Date().toISOString()}\n`));
  return { folder: info.name, link: driveLinkOf("state/connection-test.txt"), signIn: driveAuthKind(), account: serviceAccountEmail() };
}

/** Power Automate "When an HTTP request is received" trigger -> SharePoint / OneDrive.
 *  Payload: { sentAt, count, fileName, fileBase64 (the full 26-column master .xlsx), rows? (only if POWER_AUTOMATE_INCLUDE_ROWS=true) }. */
async function pushWebhook(records: DefectRecord[]) {
  const c = getConfig().sync;
  if (!c.webhookUrl) throw new Error("POWER_AUTOMATE_URL not set");
  const payload: Record<string, unknown> = {
    sentAt: new Date().toISOString(), count: records.length, fileName: MASTER_FILE,
    fileBase64: (await buildMasterWorkbook(records)).toString("base64"),
  };
  if (c.webhookIncludeRows) {
    payload.rows = records.map((r) => Object.fromEntries(COLUMNS.map((k) => [k, (r as unknown as Record<string, unknown>)[FIELD[k]]])));
  }
  const res = await fetch(c.webhookUrl, {
    method: "POST", headers: { "Content-Type": "application/json", "x-defect-hub-secret": c.webhookSecret },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Power Automate HTTP ${res.status}`);
}

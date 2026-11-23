/**
 * Persistence: in-memory state (globalThis singleton, survives Next.js hot reloads) mirrored to
 * DATA_DIR/store.json with atomic writes. commit() also triggers the background sync layer.
 * Swap this file's load/persist for SQLite/Postgres if you outgrow a JSON file (~50k records).
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import type { DefectRecord } from "./schema";
import type { DriveFile, DuplicateEvent, NotificationEntry, ScheduledRun, UploadSummary } from "./types";
import { buildSeed } from "./seed";
import { scheduleSync, restoreFromDrive } from "./sync";
import { driveEnabled } from "./drive";
import { seedMockCounter } from "./jira";
import { log } from "./logger";

export interface DB {
  version: 1;
  records: DefectRecord[]; duplicates: DuplicateEvent[]; scheduled: ScheduledRun[];
  notifications: NotificationEntry[]; uploads: UploadSummary[];
  /** files waiting to be (or already) copied to the Google Drive folder */
  driveFiles: DriveFile[];
  /** Drive path -> file id. Drive's name search can lag by seconds, so known files are updated by id and never re-created. */
  driveIds: Record<string, string>;
  /** browser links of files already in Drive, keyed by their path in the folder */
  driveLinks: Record<string, string>;
  /** upload sets whose tracking workbook must be re-pushed */
  dirtySets: string[];
}
const g = globalThis as unknown as { __chDb?: DB; __chBoot?: boolean };

const file = () => path.join(getConfig().dataDir, "store.json");

function load(): DB {
  try {
    const raw = fs.readFileSync(file(), "utf8");
    const db = JSON.parse(raw) as DB;
    if (db.version !== 1 || !Array.isArray(db.records)) throw new Error("unexpected store format");
    return { ...db, duplicates: db.duplicates ?? [], scheduled: db.scheduled ?? [], notifications: db.notifications ?? [], uploads: db.uploads ?? [], driveFiles: db.driveFiles ?? [], driveLinks: db.driveLinks ?? {}, driveIds: db.driveIds ?? {}, dirtySets: db.dirtySets ?? [] };
  } catch (e) {
    const exists = fs.existsSync(file());
    if (exists) { // corrupt file: keep a copy, never silently destroy data
      const bak = `${file()}.corrupt-${Date.now()}`;
      fs.copyFileSync(file(), bak);
      log("ERROR", `store.json unreadable (${(e as Error).message}); backed up to ${bak} and re-seeded`);
    }
    const cfg = getConfig().sync;
    const willRestore = !exists && driveEnabled() && cfg.gdriveRestoreOnEmpty;   // fresh machine + Google Drive => pull state instead of seeding demo data
    const demo = process.env.SEED_DEMO_DATA === "true" && !willRestore;   // default: start EMPTY. Set SEED_DEMO_DATA=true only to see demo data
    const s = demo ? buildSeed() : { records: [], duplicates: [], uploads: [] };
    const db: DB = { version: 1, ...s, scheduled: [], notifications: [], driveFiles: [], driveLinks: {}, driveIds: {}, dirtySets: [] };
    if (willRestore) setTimeout(() => void restoreFromDrive().catch((err) => log("ERROR", `Google Drive restore failed: ${(err as Error).message}`)), 50);
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    persist(db);
    log("INFO", `Initialised data store with ${db.records.length} ${demo ? "demo " : ""}records (${getConfig().dataDir})`);
    return db;
  }
}

function persist(db: DB) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, file());
}

export function getDb(): DB {
  if (!g.__chDb) {
    g.__chDb = load();
    const max = g.__chDb.records.map((r) => Number(r.JiraTicketID.split("-").pop())).filter(Number.isFinite);
    if (max.length) seedMockCounter(Math.max(...max));
  }
  if (!g.__chBoot) {
    g.__chBoot = true;
    // lazy import breaks the store <-> engine cycle
    const t = setInterval(() => { void import("./engine").then((m) => m.runDueSchedules()); }, 5000);
    t.unref?.();
  }
  return g.__chDb;
}

export function commit() {
  const db = getDb();
  db.duplicates = db.duplicates.slice(-500);
  db.notifications = db.notifications.slice(-500);
  db.uploads = db.uploads.slice(-200);
  persist(db);
  scheduleSync();
}

export function resetDbForTests(db?: DB) { g.__chDb = db; }
export const newDb = (): DB => ({ version: 1, records: [], duplicates: [], scheduled: [], notifications: [], uploads: [], driveFiles: [], driveLinks: {}, driveIds: {}, dirtySets: [] });
export function replaceDb(db: DB) { g.__chDb = db; persist(db); }
/** Mark an upload's tracking workbook as needing a re-push to Google Drive. */
export function markDirty(uploadId: string) { if (uploadId) { const d = getDb(); if (!d.dirtySets.includes(uploadId)) d.dirtySets.push(uploadId); } }

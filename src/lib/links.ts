import { driveEnabled, driveLinkOf } from "./drive";
import type { AttachmentInfo, DefectRecord } from "./schema";
import type { DriveStatus } from "./types";
import { getDb } from "./store";
import { getSyncStatus } from "./sync";

/** Attachments as shown on the dashboard: Google Drive links are filled in (or hidden for users who may not open the Drive folder). */
export function withLinks(r: DefectRecord, allowDrive: boolean): AttachmentInfo[] {
  return r.attachments.map((a) => ({ ...a, driveUrl: a.kind === "file" && allowDrive && driveEnabled() ? driveLinkOf(a.drivePath) : "" }));
}

/** Per-defect Google Drive state: saved (every file of its upload is in the folder), queued (waiting / retrying), error (last sync failed), off (Drive storage not enabled). */
export function driveStatusOf(r: DefectRecord, allowDrive: boolean): DriveStatus {
  if (!driveEnabled()) return { state: "off", files: 0, queued: 0, url: "", detail: "Google Drive storage is not enabled (SYNC_MODE=gdrive and GDRIVE_* settings in .env.local)." };
  const db = getDb();
  const mine = db.driveFiles.filter((f) => f.setId === r.uploadId);
  const waiting = mine.filter((f) => !f.pushedAt).length + (db.dirtySets.includes(r.uploadId) ? 1 : 0);
  const up = db.uploads.find((u) => u.id === r.uploadId);
  const url = allowDrive && up?.originalDrivePath ? driveLinkOf(up.originalDrivePath) : "";
  const sync = getSyncStatus();
  if (waiting > 0 && sync.state === "error") return { state: "error", files: mine.length, queued: waiting, url, detail: sync.lastError || "The last Google Drive upload failed. It will be retried automatically." };
  if (waiting > 0) return { state: "queued", files: mine.length, queued: waiting, url, detail: `${waiting} file(s) waiting to be copied to Google Drive.` };
  return { state: "saved", files: mine.length, queued: 0, url, detail: `${mine.length} file(s) and the tracking workbook are saved in the Google Drive folder.` };
}

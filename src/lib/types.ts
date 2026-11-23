export type LogLevel = "INFO" | "SUCCESS" | "WARNING" | "ERROR";
export interface LogEntry { seq: number; ts: string; level: LogLevel; message: string; stack?: string; recordId?: string }

export interface DuplicateEvent {
  id: string; at: string; summary: string; score: number; kind: "exact" | "fuzzy";
  matchedRecordId: string; matchedJiraId: string; newCount: number; sourceFile: string; sourceRow: number; uploadId?: string;
}
export interface ScheduledRun {
  id: string; fileName: string; runAt: string; createdAt: string; storedPath: string;
  status: "SCHEDULED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"; resultMessage: string; setId?: string; by?: string;
}
export interface NotificationEntry { id: string; at: string; to: string; subject: string; body: string; channel: "log" | "webhook" | "email"; delivered: boolean; error?: string; event?: string; recordIds?: string[] }
export interface UploadSummary {
  id: string; at: string; fileName: string; mode: "immediate" | "scheduled"; totalRows: number;
  staged: number; duplicates: number; invalid: number; issues: { row: number; column: string; message: string }[]; warnings: string[];
  /** Google Drive locations (empty when Drive storage is off). The *Url fields are filled in when the state is read. */
  originalDrivePath?: string; trackingDrivePath?: string; originalDriveUrl?: string; trackingDriveUrl?: string;
}
/** A local file that must be copied to the Google Drive folder (queued in the store so a restart never loses it). */
export interface DriveFile { drivePath: string; localPath: string; kind: "original" | "attachment"; setId: string; pushedAt: string }
export interface SyncStatus {
  mode: string; state: "idle" | "pending" | "syncing" | "ok" | "error"; lastSyncAt: string; lastError: string; target: string;
  queued: number; folderUrl: string; filesPushed: number;
}

/** Latest e-mail sent about one defect (shown in the "E-mail status update" column). */
export interface MailStatus { event: string; label: string; to: string; at: string; delivered: boolean; error?: string; channel: string }
export type TabKey = "pending" | "reassigned" | "reporter" | "approved" | "cancelled" | "report";

/** Google Drive state of one defect's files (shown as an icon in every tab). */
export interface DriveStatus { state: "off" | "saved" | "queued" | "error"; files: number; queued: number; url: string; detail: string }

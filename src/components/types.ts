import type { DefectRecord } from "@/lib/schema";
import type { DriveStatus, DuplicateEvent, LogEntry, MailStatus, NotificationEntry, ScheduledRun, SyncStatus, TabKey, UploadSummary } from "@/lib/types";

export type RecordView = DefectRecord & { mail: MailStatus | null; drive?: DriveStatus; missingEng?: string[] };
export type DupView = DuplicateEvent & { target: { tab: TabKey; recordId: string; jiraId: string } | null };
export interface DashState {
  stats: { pending: number; reassigned: number; reporterReview: number; approved: number; cancelled: number; scheduled: number; preventedDuplicates: number; failed: number; total: number };
  pending: RecordView[]; reassigned: RecordView[]; reporterReview: RecordView[]; cancelled: RecordView[]; scheduled: ScheduledRun[]; duplicates: DupView[];
  warnings?: { level: "error" | "warn"; text: string }[];
  lastUpload: UploadSummary | null; notifications: NotificationEntry[]; logs: LogEntry[]; lastSeq: number; sync: SyncStatus;
  env: { workspace: string; jiraMode: "live" | "mock"; threshold: number; defaultProject: string; issueTypes: string[]; priorities: string[]; engineering: { mode: "flagged" | "all" | "off"; required: string[]; project: string; labels: string[]; notify: boolean } }; mail: { enabled: boolean; baseUrl: string; from: string; sink?: boolean }; me: { auth: "none" | "email"; email: string; admin: boolean }; now: string;
}
export class ApiError extends Error { constructor(message: string, public details: string[] = []) { super(message); } }
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { cache: "no-store", ...init }); } catch { throw new ApiError("Cannot reach the dashboard server. Is it still running?"); }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) { window.location.href = "/login"; throw new ApiError("Please sign in"); }
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, body.details ?? []);
  return body as T;
}

import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { stats } from "@/lib/engine";
import { lastSeq, logsAfter } from "@/lib/logger";
import { getDb } from "@/lib/store";
import { getSyncStatus } from "@/lib/sync";
import { emailEnabled, mailStatusIndex } from "@/lib/notify";
import { configWarnings } from "@/lib/config-check";
import { sinkActive, sinkWanted } from "@/lib/sink";
import { authMode, canOpenDrive, sessionOf } from "@/lib/auth";
import type { DefectRecord } from "@/lib/schema";
import { fail } from "@/lib/http";
import { withLinks, driveStatusOf } from "@/lib/links";
import { driveLinkOf } from "@/lib/drive";
import { missingEngineeringFields } from "@/lib/engineering";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TAB_OF: Record<string, "pending" | "reassigned" | "reporter" | "approved" | "cancelled"> = { "In Progress": "pending", "Changed Assignee": "reassigned", "Reporter Review": "reporter", Approved: "approved", Cancelled: "cancelled" };

/** Polled every 2s by the dashboard. `since` = last log seq the client has seen. */
export async function GET(req: NextRequest) {
  try {
    const since = Number(req.nextUrl.searchParams.get("since") ?? 0) || 0;
    const db = getDb();
    const cfg = getConfig();
    const s = await sessionOf(req);
    const mode = authMode();
    const repoOk = mode === "none" || canOpenDrive(s?.email ?? "");
    const idx = mailStatusIndex();
    const byCreated = (a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt);
    // a user who may not open the Drive folder also gets no Google Drive links for files
    const shape = (r: DefectRecord) => ({ ...r, mail: idx.get(r.id) ?? null, attachments: withLinks(r, repoOk), drive: driveStatusOf(r, repoOk), missingEng: missingEngineeringFields(r) });
    const rows = (status: string) => db.records.filter((r) => r.AssignApprovalStatus === status).sort(byCreated).slice(0, 500).map(shape);
    const lastUpload = db.uploads.at(-1) ?? null;
    return NextResponse.json({
      stats: stats(),
      pending: rows("In Progress"), reassigned: rows("Changed Assignee"), reporterReview: rows("Reporter Review"), cancelled: rows("Cancelled"),
      scheduled: db.scheduled.slice(-20).reverse(),
      duplicates: db.duplicates.slice(-50).reverse().map((e) => {
        const r = db.records.find((x) => x.id === e.matchedRecordId);
        return { ...e, target: r ? { tab: TAB_OF[r.AssignApprovalStatus] ?? "pending", recordId: r.id, jiraId: r.JiraTicketID } : null };
      }),
      lastUpload: lastUpload ? { ...lastUpload, originalDriveUrl: repoOk && lastUpload.originalDrivePath ? driveLinkOf(lastUpload.originalDrivePath) : "", trackingDriveUrl: repoOk && lastUpload.trackingDrivePath ? driveLinkOf(lastUpload.trackingDrivePath) : "" } : null,
      notifications: db.notifications.slice(-10).reverse(),
      logs: logsAfter(since),
      lastSeq: lastSeq(),
      sync: { ...getSyncStatus(), folderUrl: repoOk ? getSyncStatus().folderUrl : "" },
      env: { workspace: cfg.jira.workspacePath, jiraMode: cfg.jira.mode, threshold: cfg.dedupThreshold, defaultProject: cfg.jira.defaultProjectKey,
        issueTypes: cfg.jira.issueTypes, priorities: cfg.jira.priorities,
        engineering: { mode: cfg.engineering.requireMode, required: cfg.engineering.requiredFields, project: cfg.engineering.projectKey, labels: cfg.engineering.labels, notify: !!cfg.engineering.notifyEmail } },
      mail: { enabled: emailEnabled(), baseUrl: cfg.mail.appBaseUrl, from: cfg.mail.from, sink: sinkActive() || sinkWanted() },
      me: { auth: mode, email: s?.email ?? "", admin: !!s?.admin },
      warnings: configWarnings(),
      now: new Date().toISOString(),
    });
  } catch (e) { return fail(e); }
}

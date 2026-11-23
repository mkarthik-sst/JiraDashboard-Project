import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/store";
import { mailStatusIndex } from "@/lib/notify";
import { canOpenDrive, authMode, sessionOf } from "@/lib/auth";
import { fail } from "@/lib/http";
import { withLinks, driveStatusOf } from "@/lib/links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-side search / filter / sort / pagination for the Approved Records audit table (each row carries its e-mail status). */
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const q = (p.get("q") ?? "").toLowerCase().trim();
    const priority = p.get("priority") ?? "";
    const project = p.get("project") ?? "";
    const mail = p.get("mail") ?? "";
    const status = p.get("status") ?? "Approved";
    const sort = p.get("sort") ?? "ProcessedAt";
    const dir = p.get("dir") === "asc" ? 1 : -1;
    const pageSize = Math.min(100, Math.max(5, Number(p.get("pageSize")) || 10));
    const idx = mailStatusIndex();
    const s = await sessionOf(req); const repoOk = authMode() === "none" || canOpenDrive(s?.email ?? "");
    const all = getDb().records.filter((r) => r.AssignApprovalStatus === status);
    let rows = all;
    if (priority) rows = rows.filter((r) => r.Priority === priority);
    if (project) rows = rows.filter((r) => r.ProjectKey === project);
    if (mail) rows = rows.filter((r) => { const m = idx.get(r.id); return mail === "sent" ? !!m?.delivered : mail === "failed" ? !!m && !m.delivered : !m; });
    if (q) rows = rows.filter((r) => [r.Summary, r.Description, r.JiraTicketID, r.AssigneeEmail, r.ReassignedToEmail, r.ReporterEmail, r.Customer, r.ProjectName, r.IssueType, r.FixRuleId, r.CancelReason].join(" ").toLowerCase().includes(q));
    const SORTABLE = ["ProcessedAt", "JiraTicketID", "Priority", "Summary", "DuplicateOccurrenceCount", "processingMs", "FixRuleId"] as const;
    const key = (SORTABLE as readonly string[]).includes(sort) ? (sort as (typeof SORTABLE)[number]) : "ProcessedAt";
    rows = [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, Math.max(1, Number(p.get("page")) || 1));
    return NextResponse.json({
      total, page, pages, pageSize,
      rows: rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r, mail: idx.get(r.id) ?? null, attachments: withLinks(r, repoOk), drive: driveStatusOf(r, repoOk) })),
      projects: [...new Set(all.map((r) => r.ProjectKey))].sort(),
      avgProcessingMs: all.length ? Math.round(all.reduce((a, r) => a + r.processingMs, 0) / all.length) : 0,
    });
  } catch (e) { return fail(e); }
}

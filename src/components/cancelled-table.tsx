"use client";
import { ChevronDown, ChevronRight, Paperclip } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { fmtTime } from "@/lib/utils";
import type { RecordView } from "./types";
import { Badge, priorityTone } from "./ui/badge";
import { Input } from "./ui/input";
import { MailCell } from "./mail-cell";
import { DriveCell } from "./drive-cell";
import { RecordDetails } from "./record-details";

/** Cancelled requests: read-only. A cancelled entry never creates a Jira ticket; the reason and who cancelled it are kept. */
export function CancelledTable({ rows, focusId = "", env, onChanged, onToast }: {
  rows: RecordView[]; focusId?: string; env: { issueTypes: string[]; priorities: string[] };
  onChanged: () => void; onToast: (t: { kind: "ok" | "err"; msg: string }) => void;
}) {
  const [open, setOpen] = useState(""); const [q, setQ] = useState("");
  useEffect(() => {
    if (!focusId || !rows.some((r) => r.id === focusId)) return;
    setOpen(focusId); setQ("");
    setTimeout(() => document.getElementById(`rec-${focusId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 200);
  }, [focusId, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const t = q.toLowerCase().trim();
    return rows.filter((r) => !t || [r.Summary, r.Description, r.CancelReason, r.AssigneeEmail, r.ReassignedToEmail, r.ReporterEmail, r.Customer, r.FixRuleId].join(" ").toLowerCase().includes(t));
  }, [rows, q]);
  const by = (r: RecordView) => [...(r.history ?? [])].reverse().find((h) => h.kind === "cancelled")?.by ?? "";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <Input aria-label="Search cancelled requests" className="max-w-sm" placeholder="Search summary, reason, assignee, reporter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-slate-500">{shown.length} of {rows.length} cancelled · no Jira ticket is created for these entries, and the same defect can be uploaded again later.</span>
      </div>
      {!rows.length ? <div className="p-10 text-center text-sm text-slate-500">No cancelled requests. Use <b>Cancel</b> on a Pending, Reassigned or Reporter Review entry that must not become a Jira ticket.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="w-8 px-2 py-2" /><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Defect</th><th className="px-3 py-2">Project</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Assignee</th><th className="px-3 py-2">Reporter</th><th className="px-3 py-2">Cancelled</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Email status update</th><th className="px-3 py-2 uppercase">Google Drive</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <tr id={`rec-${r.id}`} className={r.id === focusId ? "bg-amber-50 ring-2 ring-inset ring-amber-300" : "hover:bg-slate-50"}>
                    <td className="px-2 py-2.5"><button aria-label="Toggle details" onClick={() => setOpen(open === r.id ? "" : r.id)} className="text-slate-400 hover:text-slate-700">{open === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{r.Customer || "-"}</td>
                    <td className="max-w-[18rem] px-3 py-2.5"><div className="truncate font-medium text-slate-600 line-through decoration-slate-300" title={r.Summary}>{r.Summary}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">{r.IssueType}{r.attachments.length > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{r.attachments.length}</span>}{r.FixRuleId && <Badge tone="violet">{r.FixRuleId}</Badge>}</div></td>
                    <td className="px-3 py-2.5"><Badge tone="blue">{r.ProjectKey}</Badge></td>
                    <td className="px-3 py-2.5"><Badge tone={priorityTone(r.Priority)}>{r.Priority}</Badge></td>
                    <td className="px-3 py-2.5 text-xs">{r.ReassignedToEmail || r.AssigneeEmail}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2.5 text-xs" title={r.ReporterEmail}>{r.ReporterEmail}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs"><Badge tone="slate">Cancelled</Badge><div className="mt-1 text-slate-500">{fmtTime(r.ProcessedAt)}</div>{by(r) && <div className="max-w-[10rem] truncate text-slate-400" title={by(r)}>by {by(r)}</div>}</td>
                    <td className="max-w-[18rem] px-3 py-2.5 text-xs text-slate-700"><div className="line-clamp-3 whitespace-pre-wrap" title={r.CancelReason}>{r.CancelReason}</div></td>
                    <td className="px-3 py-2.5"><MailCell m={r.mail} /></td>
                      <td className="px-3 py-2.5"><DriveCell d={r.drive} /></td>
                  </tr>
                  {open === r.id && <tr className="bg-slate-50"><td /><td colSpan={9} className="px-3 py-3 text-xs"><RecordDetails r={r} canEdit={false} issueTypes={env.issueTypes} priorities={env.priorities} onChanged={onChanged} onToast={onToast} /></td></tr>}
                </Fragment>
              ))}
              {!shown.length && <tr><td colSpan={10} className="p-8 text-center text-sm text-slate-500">No cancelled requests match the search.</td></tr>}
            </tbody>
          </table>
        </div>)}
    </div>
  );
}

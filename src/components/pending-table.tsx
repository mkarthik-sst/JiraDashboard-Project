"use client";
import { Ban, Check, ChevronDown, ChevronRight, Loader2, MessageSquareReply, Paperclip, Pencil, Send, UserRoundCog } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { RecordView } from "./types";
import { Badge, priorityTone } from "./ui/badge";
import { Button } from "./ui/button";
import { FilterBar, NO_FILTERS, type Filters } from "./filter-bar";
import { MailCell, mailKind } from "./mail-cell";
import { DriveCell } from "./drive-cell";
import { RecordDetails } from "./record-details";

export type Variant = "pending" | "reassigned" | "reporter";
const EMPTY: Record<Variant, string> = {
  pending: "No records awaiting approval. Upload a spreadsheet to stage new defects.",
  reassigned: "No reassigned records waiting for the new assignee.",
  reporter: "No defects are waiting for a reporter. When an approver returns a defect with a comment, it appears here.",
};

/** One table for Pending Approvals, Reassigned and Reporter Review: filters, e-mail status, edit marks, return / resubmit. */
export function PendingTable({ rows, variant, focusId = "", env, onApprove, onReassign, onReturn, onResubmit, onCancel, onChanged, onToast }: {
  rows: RecordView[]; variant: Variant; focusId?: string; env: { issueTypes: string[]; priorities: string[] };
  onApprove: (r: RecordView) => Promise<void>; onReassign: (r: RecordView) => void; onReturn: (r: RecordView) => void; onResubmit: (r: RecordView) => void; onCancel: (r: RecordView) => void;
  onChanged: () => void; onToast: (t: { kind: "ok" | "err"; msg: string }) => void;
}) {
  const [busy, setBusy] = useState(""); const [open, setOpen] = useState(""); const [f, setF] = useState<Filters>(NO_FILTERS);
  useEffect(() => {
    if (!focusId || !rows.some((r) => r.id === focusId)) return;
    setOpen(focusId); setF(NO_FILTERS);
    setTimeout(() => document.getElementById(`rec-${focusId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 200);
  }, [focusId, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const projects = useMemo(() => [...new Set(rows.map((r) => r.ProjectKey))].sort(), [rows]);
  const shown = useMemo(() => {
    const q = f.q.toLowerCase().trim();
    return rows.filter((r) => (!f.priority || r.Priority === f.priority) && (!f.project || r.ProjectKey === f.project)
      && (!f.mail || (f.mail === "sent" ? mailKind(r.mail) === "sent" : f.mail === "failed" ? mailKind(r.mail) === "failed" : mailKind(r.mail) === "none"))
      && (!q || [r.Summary, r.Description, r.AssigneeEmail, r.ReassignedToEmail, r.ReporterEmail, r.Customer, r.ProjectName, r.IssueType, r.JiraTicketID, r.FixRuleId].join(" ").toLowerCase().includes(q)));
  }, [rows, f]);
  const cols = variant === "reporter" ? 10 : 11;
  return (
    <div>
      <FilterBar f={f} onChange={setF} projects={projects} shown={shown.length} total={rows.length} label={variant} />
      {!rows.length ? <div className="p-10 text-center text-sm text-slate-500">{EMPTY[variant]}</div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1300px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="w-8 px-2 py-2" /><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Defect</th><th className="px-3 py-2">Project</th><th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">{variant === "reassigned" ? "Reassigned to" : variant === "reporter" ? "Assigned to" : "Assignee"}</th><th className="px-3 py-2">Reporter</th>
                {variant !== "reporter" && <th className="px-3 py-2">Dups</th>}<th className="px-3 py-2">Status</th><th className="px-3 py-2">Email status update</th><th className="px-3 py-2">Google Drive</th><th className="px-3 py-2">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => {
                const last = [...(r.history ?? [])].reverse().find((h) => h.kind === "returned" || h.kind === "resubmitted");
                return (
                  <Fragment key={r.id}>
                    <tr id={`rec-${r.id}`} className={`${r.id === focusId ? "bg-amber-50 ring-2 ring-inset ring-amber-300" : r.ExecutionStatus === "FAILED" ? "bg-red-50/40" : "hover:bg-slate-50"}`}>
                      <td className="px-2 py-2.5"><button aria-label="Toggle details" onClick={() => setOpen(open === r.id ? "" : r.id)} className="text-slate-400 hover:text-slate-700">{open === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{r.Customer || "-"}</td>
                      <td className="max-w-[18rem] px-3 py-2.5">
                        <div className="flex items-center gap-1"><div className="truncate font-medium" title={r.Summary}>{r.Summary}</div>
                          <button aria-label="Edit this defect" title="Edit this defect" onClick={() => setOpen(r.id)} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-brand-50 hover:text-brand-700"><Pencil className="h-3 w-3" /></button></div>
                        <div className="flex items-center gap-2 truncate text-xs text-slate-500">{r.IssueType}{r.attachments.length > 0 && <span className="inline-flex items-center gap-0.5" title="Attachments"><Paperclip className="h-3 w-3" />{r.attachments.length}</span>}
                          {r.AutomatedFix === "Yes" && <Badge tone="violet">{r.FixRuleId || "automated fix"}</Badge>}</div>
                        {r.missingEng && r.missingEng.length > 0 && <div className="mt-1 max-w-[17rem] truncate rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800" title={`Needed before approval: ${r.missingEng.join(", ")}`}>Details missing: {r.missingEng.join(", ")}</div>}
                        {variant === "reporter" && last && <div className="mt-1 max-w-[17rem] truncate rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800" title={last.note}>“{last.note}”</div>}
                      </td>
                      <td className="px-3 py-2.5"><Badge tone="blue">{r.ProjectKey}</Badge></td>
                      <td className="px-3 py-2.5"><Badge tone={priorityTone(r.Priority)}>{r.Priority}</Badge></td>
                      <td className="px-3 py-2.5 text-xs">{variant === "reassigned" ? <span className="font-medium text-violet-700">{r.ReassignedToEmail}</span> : r.ReassignedToEmail || r.AssigneeEmail}{variant === "reassigned" && <div className="text-slate-400">was {r.AssigneeEmail}</div>}</td>
                      <td className="max-w-[12rem] truncate px-3 py-2.5 text-xs" title={r.ReporterEmail}>{r.ReporterEmail}</td>
                      {variant !== "reporter" && <td className="px-3 py-2.5">{r.DuplicateOccurrenceCount > 0 ? <Badge tone="violet">+{r.DuplicateOccurrenceCount}</Badge> : <span className="text-slate-300">0</span>}</td>}
                      <td className="px-3 py-2.5">{r.ExecutionStatus === "FAILED" ? <Badge tone="red">FAILED</Badge> : variant === "reporter" ? <Badge tone="sky">Reporter Review</Badge> : <Badge tone={variant === "reassigned" ? "violet" : "amber"}>{variant === "reassigned" ? "Changed Assignee" : "In Progress"}</Badge>}</td>
                      <td className="px-3 py-2.5"><MailCell m={r.mail} /></td>
                      <td className="px-3 py-2.5"><DriveCell d={r.drive} /></td>
                      <td className="px-3 py-2.5">
                        <div className="flex w-[10.5rem] flex-col gap-1.5">
                          {variant === "reporter" ? (
                            <Button size="sm" className="justify-start" onClick={() => onResubmit(r)} aria-label="Send for approval"><Send className="h-3.5 w-3.5" />Send for approval</Button>
                          ) : (<>
                            <Button size="sm" variant="success" className="justify-start" disabled={busy === r.id} aria-label="Approve"
                              onClick={async () => { setBusy(r.id); try { await onApprove(r); } finally { setBusy(""); } }}>
                              {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{r.ExecutionStatus === "FAILED" ? "Retry" : "Approve"}
                            </Button>
                            <Button size="sm" variant="outline" className="justify-start" disabled={busy === r.id} onClick={() => onReassign(r)} title="Change Assignee"><UserRoundCog className="h-3.5 w-3.5" />Reassign</Button>
                            <Button size="sm" variant="outline" className="justify-start" disabled={busy === r.id} onClick={() => onReturn(r)} title="Send back to the reporter with a comment" aria-label="Return to reporter"><MessageSquareReply className="h-3.5 w-3.5" />Return to reporter</Button>
                          </>)}
                          <Button size="sm" variant="outline" className="justify-start text-rose-700 hover:bg-rose-50" disabled={busy === r.id} onClick={() => onCancel(r)} title="Cancel this entry: no Jira ticket will be created" aria-label="Cancel entry"><Ban className="h-3.5 w-3.5" />Cancel entry</Button>
                        </div>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr className="bg-slate-50"><td /><td colSpan={cols} className="px-3 py-3 text-xs">
                        <RecordDetails r={r} canEdit missing={r.missingEng} issueTypes={env.issueTypes} priorities={env.priorities} onChanged={onChanged} onToast={onToast} />
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              {!shown.length && <tr><td colSpan={cols + 1} className="p-8 text-center text-sm text-slate-500">No records match the filters.</td></tr>}
            </tbody>
          </table>
        </div>)}
    </div>
  );
}

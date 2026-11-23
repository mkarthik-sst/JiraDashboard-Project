"use client";
import { Ban, CheckCheck, FilePlus2, FileText, Loader2, MessageSquareReply, Pencil, Send, UserRoundCog, Upload, Wrench } from "lucide-react";
import { useRef, useState } from "react";
import type { DefectRecord, HistoryEntry } from "@/lib/schema";
import { fmtTime } from "@/lib/utils";
import { AttachmentList } from "./attachment-list";
import { EditField } from "./edit-field";
import { api, ApiError } from "./types";
import { Button } from "./ui/button";

const Field = ({ label, children, reference }: { label: string; children: React.ReactNode; reference?: boolean }) => (
  <div className="min-w-0"><dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}{reference && <span className="ml-1 rounded bg-teal-100 px-1 text-[10px] normal-case text-teal-800">reference only - not sent to Jira</span>}</dt><dd className="truncate text-slate-800" title={typeof children === "string" ? children : undefined}>{children || "-"}</dd></div>
);

const KIND: Record<HistoryEntry["kind"], { icon: typeof Pencil; text: string; tone: string }> = {
  uploaded: { icon: Upload, text: "Uploaded", tone: "text-slate-500" }, edited: { icon: Pencil, text: "Edited", tone: "text-blue-600" },
  documents: { icon: FilePlus2, text: "Documents added", tone: "text-blue-600" }, returned: { icon: MessageSquareReply, text: "Returned to reporter", tone: "text-amber-600" },
  resubmitted: { icon: Send, text: "Sent for approval again", tone: "text-sky-600" }, reassigned: { icon: UserRoundCog, text: "Reassigned", tone: "text-violet-600" },
  approved: { icon: CheckCheck, text: "Approved", tone: "text-emerald-600" }, cancelled: { icon: Ban, text: "Cancelled", tone: "text-rose-600" },
};

/** Expanded row: editable fields (pencil marks), reviewable attachments + "add document", activity & comments. */
export function RecordDetails({ r, canEdit, issueTypes, priorities, onChanged, onToast, missing = [] }: {
  missing?: string[]; r: DefectRecord; canEdit: boolean; issueTypes: string[]; priorities: string[]; onChanged: () => void; onToast: (t: { kind: "ok" | "err"; msg: string }) => void;
}) {
  const [busy, setBusy] = useState(false); const file = useRef<HTMLInputElement>(null);
  const save = (key: string) => async (value: string) => {
    await api(`/api/records/${r.id}/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: value }) });
    onToast({ kind: "ok", msg: "Saved" }); onChanged();
  };
  async function addDocs(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    try {
      const fd = new FormData(); Array.from(list).forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/records/${r.id}/documents`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error ?? `Upload failed (${res.status})`);
      onToast({ kind: "ok", msg: `${list.length} document(s) added` }); onChanged();
    } catch (e) { onToast({ kind: "err", msg: (e as Error).message }); } finally { setBusy(false); if (file.current) file.current.value = ""; }
  }
  const history = [...(r.history ?? [])].reverse();
  return (
    <div className="space-y-3">
      {canEdit && <p className="text-[11px] text-slate-500">Fields with a <Pencil className="inline h-3 w-3" /> pencil can be edited. Changes are saved straight away and recorded in the activity list.</p>}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4" data-testid="record-fields">
        <EditField wide label="Summary" value={r.Summary} canEdit={canEdit} onSave={save("Summary")} />
        <EditField wide multiline label="Description" value={r.Description} canEdit={canEdit} onSave={save("Description")} />
        <EditField label="Issue Type" value={r.IssueType} canEdit={canEdit} options={issueTypes} onSave={save("IssueType")} />
        <EditField label="Priority" value={r.Priority} canEdit={canEdit} options={priorities} onSave={save("Priority")} />
        <EditField label="Project lead" value={r.Lead} canEdit={canEdit} onSave={save("Lead")} />
        <Field label="Project key">{r.ProjectKey}</Field>
        <Field label="Customer" reference>{r.Customer}</Field><Field label="Project name" reference>{r.ProjectName}</Field>
        <Field label="Project type" reference>{r.ProjectType}</Field><Field label="Assignee">{r.AssigneeEmail}</Field>
        <Field label="Reassigned to">{r.ReassignedToEmail}</Field><Field label="Reporter">{r.ReporterEmail}</Field>
        <Field label="AssignApprovalStatus">{r.AssignApprovalStatus}</Field><Field label="ExecutionStatus">{r.ExecutionStatus}</Field>
        <Field label="Duplicates suppressed">{String(r.DuplicateOccurrenceCount)}</Field><Field label="Source">{`${r.sourceFile} row ${r.sourceRow}`}</Field>
        {r.CancelReason && <div className="col-span-2 md:col-span-4"><dt className="text-[11px] uppercase tracking-wide text-rose-500">Cancelled - reason</dt><dd className="whitespace-pre-wrap text-slate-800">{r.CancelReason}</dd></div>}
      </dl>
      <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3" data-testid="engineering-fields">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-violet-700"><Wrench className="h-3.5 w-3.5" />Engineering feedback (automated-fix issues)
          {r.AutomatedFix === "Yes" ? <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] normal-case text-white">routed to product engineering in Jira</span> : <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] normal-case text-slate-600">ordinary defect - set to Yes to route it to product engineering</span>}
          {missing.length > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] normal-case text-amber-900">missing before approval: {missing.join(", ")}</span>}</div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <EditField label="Automated fix issue" value={r.AutomatedFix} canEdit={canEdit} options={["Yes", "No"]} onSave={save("AutomatedFix")} hint="Yes or No." />
          <EditField label="Fix / Rule ID" value={r.FixRuleId} canEdit={canEdit} onSave={save("FixRuleId")} hint="e.g. FIX-VBAP-014. Groups the recurrence report." />
          <EditField wide multiline label="Root cause" value={r.RootCause} canEdit={canEdit} onSave={save("RootCause")} />
          <EditField wide multiline label="Impact" value={r.Impact} canEdit={canEdit} onSave={save("Impact")} />
          <EditField wide multiline label="Prerequisites" value={r.Prerequisites} canEdit={canEdit} onSave={save("Prerequisites")} />
          <EditField wide multiline label="Dependent data sources" value={r.DependentSources} canEdit={canEdit} onSave={save("DependentSources")} />
        </dl>
      </div>
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">AttachmentPaths - open each file to review</span>
          {canEdit && (<>
            <Button size="sm" variant="outline" onClick={() => file.current?.click()} disabled={busy} aria-label="Add document">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="h-3.5 w-3.5" />}Add document</Button>
            <input ref={file} data-testid="record-doc-input" type="file" multiple className="hidden" onChange={(e) => void addDocs(e.target.files)} />
          </>)}
        </div>
        <AttachmentList items={r.attachments} />
        <div className="mt-2 max-w-2xl"><EditField label="AttachmentPaths (links or file names, separated by |)" value={r.AttachmentPaths} canEdit={canEdit} onSave={save("AttachmentPaths")} hint="Add a link such as https://… or a file name. Use | between entries. Use “Add document” to upload a file." /></div>
      </div>
      {r.lastWarning && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">{r.lastWarning}</div>}
      {r.lastError && <div className="rounded border border-red-200 bg-red-50 p-2 text-red-800"><div className="font-medium">Last Jira error: {r.lastError}</div>
        {r.lastErrorStack && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-red-700">{r.lastErrorStack}</pre>}</div>}
      <div>
        <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-400"><FileText className="h-3 w-3" />Activity &amp; comments</div>
        {!history.length ? <p className="text-slate-400">No activity yet.</p> : (
          <ol className="space-y-1.5" data-testid="history">
            {history.map((h) => { const k = KIND[h.kind]; const Icon = k.icon; return (
              <li key={h.id} className="flex gap-2 rounded-md border border-slate-200 bg-white p-2">
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${k.tone}`} />
                <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-x-2"><b>{k.text}</b><span className="text-slate-500">{h.by} · {fmtTime(h.at)}</span></div>
                  {h.note && <div className="mt-0.5 whitespace-pre-wrap break-words text-slate-700">{h.note}</div>}
                  {h.changes?.map((c, i) => <div key={i} className="mt-0.5 text-slate-600"><b>{c.field}</b>: <span className="text-slate-400 line-through">{c.from || "(empty)"}</span> → {c.to || "(empty)"}</div>)}
                </div>
              </li>); })}
          </ol>)}
      </div>
    </div>
  );
}

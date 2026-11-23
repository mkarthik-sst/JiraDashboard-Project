import { ArrowRight, CopyX } from "lucide-react";
import { fmtTime } from "@/lib/utils";
import type { TabKey, UploadSummary } from "@/lib/types";
import type { DupView } from "./types";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const TAB_LABEL: Record<TabKey, string> = { pending: "Pending Approvals", reassigned: "Reassigned", reporter: "Reporter Review", approved: "Approved Records", cancelled: "Cancelled", report: "Recurrence report" };

/** Every suppressed duplicate links to the tab where the ORIGINAL entry is today. */
export function DupPanel({ events, last, threshold, onOpen }: { events: DupView[]; last: UploadSummary | null; threshold: number; onOpen: (e: DupView) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle>Deduplication Audit</CardTitle><span className="text-xs text-slate-500">fuzzy threshold {Math.round(threshold * 100)}%</span></CardHeader>
      <CardContent className="space-y-2">
        {last && last.duplicates > 0 && (
          <div role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <CopyX className="mt-0.5 h-4 w-4 shrink-0" />
            <div><b>{last.duplicates} duplicate{last.duplicates > 1 ? "s" : ""} suppressed</b> in <i>{last.fileName}</i>. No Jira tickets were created for them; original occurrence counts were incremented.</div>
          </div>
        )}
        {events.length === 0 && <p className="py-4 text-center text-sm text-slate-500">No duplicates detected yet.</p>}
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {events.map((e) => (
            <li key={e.id}>
              <button type="button" disabled={!e.target} onClick={() => onOpen(e)} aria-label={`Open the existing entry: ${e.summary}`}
                className="group w-full rounded-md border border-slate-200 p-2.5 text-left text-xs transition enabled:hover:border-brand-500 enabled:hover:bg-brand-50/40 disabled:cursor-default">
                <div className="flex items-center justify-between gap-2"><span className="truncate font-medium text-slate-800" title={e.summary}>{e.summary}</span><Badge tone={e.kind === "exact" ? "violet" : "amber"}>{e.kind} {Math.round(e.score * 100)}%</Badge></div>
                <div className="mt-1 text-slate-500">{e.matchedJiraId ? <>Linked to <b className="font-mono text-brand-700">{e.matchedJiraId}</b></> : "Linked to pending original"} · count now <b>{e.newCount}</b> · {e.sourceFile} row {e.sourceRow} · {fmtTime(e.at)}</div>
                <div className="mt-1.5 flex items-center gap-1 font-medium text-brand-700">{e.target ? <>Already in <b>{TAB_LABEL[e.target.tab]}</b><ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" /></> : <span className="font-normal text-slate-400">Original entry is no longer on the dashboard</span>}</div>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

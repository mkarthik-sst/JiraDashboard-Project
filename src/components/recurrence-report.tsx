"use client";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtTime } from "@/lib/utils";
import { api } from "./types";
import { Badge } from "./ui/badge";

interface Row { fix: string; defects: number; repeatReports: number; totalReports: number; pending: number; approved: number; cancelled: number; jiraTickets: string[]; topRootCause: string; firstSeen: string; lastSeen: string }
interface Rep { rows: Row[]; totals: { fixes: number; defects: number; totalReports: number }; unassigned: number }

/** Which automated fixes / rules generate the most defects (for product engineering). */
export function RecurrenceReport({ refreshKey }: { refreshKey: number }) {
  const [rep, setRep] = useState<Rep | null>(null); const [err, setErr] = useState("");
  useEffect(() => { api<Rep>("/api/report/recurrence").then((d) => { setRep(d); setErr(""); }).catch((e) => setErr((e as Error).message)); }, [refreshKey]);
  const max = Math.max(1, ...(rep?.rows.map((r) => r.totalReports) ?? [1]));
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
        <p className="max-w-3xl text-xs text-slate-600">One row per <b>Fix / Rule ID</b> from defects flagged <i>Automated fix issue = Yes</i>. <b>Total reports</b> = defects + repeat reports that were suppressed as duplicates, so the biggest numbers show which automated fixes engineering should look at first. Cancelled entries are not counted.</p>
        <a href="/api/report/recurrence?format=xlsx" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"><Download className="h-4 w-4" />Export report</a>
      </div>
      {err && <div role="alert" className="m-3 rounded bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      {rep && <div className="flex flex-wrap gap-6 border-b border-slate-100 px-4 py-3 text-sm"><span><b className="text-lg tabular-nums">{rep.totals.fixes}</b> fixes / rules</span><span><b className="text-lg tabular-nums">{rep.totals.defects}</b> defects</span><span><b className="text-lg tabular-nums">{rep.totals.totalReports}</b> total reports</span>
        {rep.unassigned > 0 && <span className="text-amber-700">{rep.unassigned} automated-fix defect(s) have no Fix / Rule ID yet</span>}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Fix / Rule ID</th><th className="px-3 py-2">Total reports</th><th className="px-3 py-2">Defects</th><th className="px-3 py-2">Repeat reports</th><th className="px-3 py-2">Pending</th><th className="px-3 py-2">Approved</th><th className="px-3 py-2">Jira tickets</th><th className="px-3 py-2">Most common root cause</th><th className="px-3 py-2">Last seen</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rep?.rows.map((r) => (
              <tr key={r.fix} className="hover:bg-slate-50">
                <td className="px-3 py-2.5 font-mono text-xs font-semibold text-violet-700">{r.fix}</td>
                <td className="w-48 px-3 py-2.5"><div className="flex items-center gap-2"><div className="h-2 flex-1 rounded bg-slate-100"><div className="h-2 rounded bg-violet-500" style={{ width: `${(r.totalReports / max) * 100}%` }} /></div><b className="tabular-nums">{r.totalReports}</b></div></td>
                <td className="px-3 py-2.5 tabular-nums">{r.defects}</td>
                <td className="px-3 py-2.5">{r.repeatReports ? <Badge tone="violet">+{r.repeatReports}</Badge> : <span className="text-slate-300">0</span>}</td>
                <td className="px-3 py-2.5 tabular-nums">{r.pending}</td><td className="px-3 py-2.5 tabular-nums">{r.approved}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-brand-700">{r.jiraTickets.join(", ") || <span className="text-slate-300">-</span>}</td>
                <td className="max-w-[22rem] px-3 py-2.5 text-xs text-slate-700">{r.topRootCause || <span className="text-slate-300">not recorded</span>}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs">{fmtTime(r.lastSeen)}</td>
              </tr>))}
            {rep && !rep.rows.length && <tr><td colSpan={9} className="p-10 text-center text-sm text-slate-500">No automated-fix defects yet. Set <b>Automated fix issue = Yes</b> and a <b>Fix / Rule ID</b> in the template, and the recurrence per fix appears here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

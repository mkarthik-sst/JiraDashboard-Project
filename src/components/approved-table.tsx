"use client";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtTime } from "@/lib/utils";
import { api, type RecordView } from "./types";
import { MailCell } from "./mail-cell";
import { DriveCell } from "./drive-cell";
import { Badge, priorityTone } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Select } from "./ui/input";

interface Resp { total: number; page: number; pages: number; rows: RecordView[]; projects: string[]; avgProcessingMs: number }

export function ApprovedTable({ refreshKey, focusId = "", focusJira = "" }: { refreshKey: number; focusId?: string; focusJira?: string }) {
  const [q, setQ] = useState(""); const [dq, setDq] = useState("");
  const [priority, setPriority] = useState(""); const [project, setProject] = useState(""); const [mail, setMail] = useState("");
  useEffect(() => { if (focusJira) { setQ(focusJira); setDq(focusJira); setPriority(""); setProject(""); setMail(""); setPage(1); } }, [focusJira, focusId]);
  const [sort, setSort] = useState("ProcessedAt"); const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<Resp | null>(null); const [err, setErr] = useState("");

  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const p = new URLSearchParams({ q: dq, priority, project, mail, sort, dir, page: String(page), pageSize: String(pageSize), status: "Approved" });
    api<Resp>(`/api/records?${p}`).then((d) => { setData(d); setErr(""); }).catch((e) => setErr((e as Error).message));
  }, [dq, priority, project, mail, sort, dir, page, pageSize, refreshKey]);

  const th = (key: string, label: string) => (
    <th className="px-3 py-2"><button className="inline-flex items-center gap-1 uppercase" onClick={() => { if (sort === key) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(key); setDir("desc"); } }}>
      {label}{sort === key && (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</button></th>
  );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative min-w-56 flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input aria-label="Search approved records" className="pl-8" placeholder="Search summary, Jira ID, assignee, reporter…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select aria-label="Priority filter" className="w-36" value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}><option value="">All priorities</option>{["Highest","High Attention","High","Medium","Low"].map((x) => <option key={x}>{x}</option>)}</Select>
        <Select aria-label="Project filter" className="w-36" value={project} onChange={(e) => { setProject(e.target.value); setPage(1); }}><option value="">All projects</option>{data?.projects.map((p) => <option key={p}>{p}</option>)}</Select>
        <Select aria-label="E-mail status filter" className="w-40" value={mail} onChange={(e) => { setMail(e.target.value); setPage(1); }}><option value="">All e-mail status</option><option value="sent">Sent</option><option value="failed">Failed / not sent</option><option value="none">Nothing sent yet</option></Select>
        <a href="/api/export?status=Approved" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"><Download className="h-4 w-4" />Export Approved</a>
        <a href="/api/export?status=all" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"><Download className="h-4 w-4" />Export All</a>
      </div>
      {err && <div role="alert" className="m-3 rounded bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1150px] text-left text-sm">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500"><tr>
            {th("JiraTicketID", "Jira ID")}<th className="px-3 py-2 uppercase">Email status update</th><th className="px-3 py-2 uppercase">Google Drive</th>{th("Summary", "Summary")}{th("FixRuleId", "Fix / Rule")}<th className="px-3 py-2 uppercase">Project</th>{th("Priority", "Priority")}
            <th className="px-3 py-2 uppercase">Assignee</th>{th("ProcessedAt", "Processed")}{th("processingMs", "Latency")}{th("DuplicateOccurrenceCount", "Dups")}<th className="px-3 py-2 uppercase">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data?.rows.map((r) => (
              <tr key={r.id} id={`rec-${r.id}`} className={r.id === focusId ? "bg-amber-50 ring-2 ring-inset ring-amber-300" : "hover:bg-slate-50"}>
                <td className="whitespace-nowrap px-3 py-2.5"><a href={r.jiraUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-brand-700 hover:underline">{r.JiraTicketID}<ExternalLink className="h-3 w-3" /></a></td>
                <td className="px-3 py-2.5"><MailCell m={r.mail} /></td>
                      <td className="px-3 py-2.5"><DriveCell d={r.drive} /></td>
                <td className="max-w-[16rem] px-3 py-2.5"><div className="truncate" title={r.Summary}>{r.Summary}</div></td>
                <td className="px-3 py-2.5">{r.FixRuleId ? <Badge tone="violet">{r.FixRuleId}</Badge> : <span className="text-slate-300">-</span>}</td>
                <td className="px-3 py-2.5"><Badge tone="blue">{r.ProjectKey}</Badge></td>
                <td className="px-3 py-2.5"><Badge tone={priorityTone(r.Priority)}>{r.Priority}</Badge></td>
                <td className="px-3 py-2.5 text-xs">{r.ReassignedToEmail || r.AssigneeEmail}{r.ReassignedToEmail && <Badge tone="violet" className="ml-1">reassigned</Badge>}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs">{fmtTime(r.ProcessedAt)}</td>
                <td className="px-3 py-2.5 text-xs tabular-nums">{r.processingMs ? `${(r.processingMs / 1000).toFixed(2)}s` : "-"}</td>
                <td className="px-3 py-2.5">{r.DuplicateOccurrenceCount ? <Badge tone="violet">+{r.DuplicateOccurrenceCount}</Badge> : <span className="text-slate-300">0</span>}</td>
                <td className="px-3 py-2.5"><Badge tone="green">{r.ExecutionStatus}</Badge></td>
              </tr>
            ))}
            {data && !data.rows.length && <tr><td colSpan={11} className="p-10 text-center text-slate-500">No approved records match the filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
        <span>{data ? `${data.total} record(s) · avg Jira latency ${(data.avgProcessingMs / 1000).toFixed(2)}s` : "Loading…"}</span>
        <div className="flex items-center gap-2">
          <Select aria-label="Rows per page" className="h-8 w-24 text-xs" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{[10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}</Select>
          <Button size="icon" variant="outline" aria-label="Previous page" disabled={!data || page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span>Page {data?.page ?? 1} / {data?.pages ?? 1}</span>
          <Button size="icon" variant="outline" aria-label="Next page" disabled={!data || page >= data.pages} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

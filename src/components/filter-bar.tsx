"use client";
import { Search } from "lucide-react";
import { Input, Select } from "./ui/input";

export interface Filters { q: string; priority: string; project: string; mail: string }
export const NO_FILTERS: Filters = { q: "", priority: "", project: "", mail: "" };

/** Same search + filters as the Approved Records table. */
export function FilterBar({ f, onChange, projects, shown, total, label }: { f: Filters; onChange: (f: Filters) => void; projects: string[]; shown: number; total: number; label: string }) {
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => onChange({ ...f, [k]: e.target.value });
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
      <div className="relative min-w-56 flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input aria-label={`Search ${label}`} className="pl-8" placeholder="Search summary, description, assignee, reporter…" value={f.q} onChange={set("q")} /></div>
      <Select aria-label="Priority filter" className="w-36" value={f.priority} onChange={set("priority")}><option value="">All priorities</option>{["Highest", "High Attention", "High", "Medium", "Low"].map((x) => <option key={x}>{x}</option>)}</Select>
      <Select aria-label="Project filter" className="w-36" value={f.project} onChange={set("project")}><option value="">All projects</option>{projects.map((p) => <option key={p}>{p}</option>)}</Select>
      <Select aria-label="E-mail status filter" className="w-40" value={f.mail} onChange={set("mail")}><option value="">All e-mail status</option><option value="sent">Sent</option><option value="failed">Failed / not sent</option><option value="none">Nothing sent yet</option></Select>
      <span className="text-xs text-slate-500">{shown === total ? `${total} record(s)` : `${shown} of ${total}`}</span>
    </div>
  );
}

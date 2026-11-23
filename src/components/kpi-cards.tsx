"use client";
import { ArrowRight, Ban, CalendarClock, CheckCircle2, Clock3, CopyX, MessageSquareReply, UserRoundCog } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashState } from "./types";

export type Target = "pending" | "reassigned" | "reporter" | "approved" | "cancelled" | "scheduled" | "duplicates";

/** Summary boxes. Clicking one opens the matching tab / section below. */
export function KpiCards({ s, active, onGo }: { s: DashState["stats"]; active: string; onGo: (t: Target) => void }) {
  const items: { t: Target; label: string; value: number; sub: string; icon: typeof Clock3; color: string; bar: string }[] = [
    { t: "pending", label: "Pending Approvals", value: s.pending, sub: `${s.failed} failed`, icon: Clock3, color: "text-amber-600 bg-amber-50", bar: "bg-amber-400" },
    { t: "reassigned", label: "Reassigned", value: s.reassigned, sub: "with the new assignee", icon: UserRoundCog, color: "text-violet-600 bg-violet-50", bar: "bg-violet-400" },
    { t: "reporter", label: "Reporter Review", value: s.reporterReview, sub: "waiting for the reporter", icon: MessageSquareReply, color: "text-sky-600 bg-sky-50", bar: "bg-sky-400" },
    { t: "approved", label: "Approved / Jira Created", value: s.approved, sub: "Jira tickets generated", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50", bar: "bg-emerald-400" },
    { t: "cancelled", label: "Cancelled Requests", value: s.cancelled, sub: "no Jira ticket created", icon: Ban, color: "text-rose-600 bg-rose-50", bar: "bg-rose-400" },
    { t: "scheduled", label: "Scheduled Runs", value: s.scheduled, sub: "queued ingestions", icon: CalendarClock, color: "text-blue-600 bg-blue-50", bar: "bg-blue-400" },
    { t: "duplicates", label: "Prevented Duplicates", value: s.preventedDuplicates, sub: "tickets suppressed", icon: CopyX, color: "text-fuchsia-600 bg-fuchsia-50", bar: "bg-fuchsia-400" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7" data-testid="kpis">
      {items.map(({ t, label, value, sub, icon: Icon, color, bar }) => (
        <button key={t} type="button" onClick={() => onGo(t)} aria-label={`${label}: ${value}. Open`} data-kpi={t}
          className={cn("group relative overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500", active === t ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200")}>
          <span className={cn("absolute inset-x-0 top-0 h-1", bar)} />
          <div className="flex items-start justify-between">
            <div className={cn("rounded-lg p-2", color)}><Icon className="h-5 w-5" /></div>
            <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
          </div>
          <div className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{value}</div>
          <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</div>
          <div className="text-xs text-slate-500">{sub}</div>
        </button>
      ))}
    </div>
  );
}

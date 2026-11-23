"use client";
import { ChevronDown, ChevronRight, Terminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LogEntry, LogLevel } from "@/lib/types";
import { cn, fmtClock } from "@/lib/utils";

const color: Record<LogLevel, string> = { INFO: "text-sky-300", SUCCESS: "text-emerald-400", WARNING: "text-amber-300", ERROR: "text-red-400" };

export function LogDrawer({ logs, open, onToggle }: { logs: LogEntry[]; open: boolean; onToggle: () => void }) {
  const [filter, setFilter] = useState<LogLevel | "ALL">("ALL");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const shown = filter === "ALL" ? logs : logs.filter((l) => l.level === filter);
  const errors = logs.filter((l) => l.level === "ERROR").length;
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "end" }); }, [shown.length, open]);

  return (
    <>
      <button onClick={onToggle} className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-slate-800">
        <Terminal className="h-4 w-4" />Live logs{errors > 0 && <span className="rounded-full bg-red-500 px-1.5 text-xs">{errors}</span>}
      </button>
      <aside aria-label="Live observability drawer" className={cn("fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col bg-slate-950 text-slate-200 shadow-2xl transition-transform", open ? "translate-x-0" : "translate-x-full")}>
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Terminal className="h-4 w-4" />Live Observability <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" /></div>
          <button onClick={onToggle} aria-label="Close log drawer" className="rounded p-1 hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex gap-1 border-b border-slate-800 px-3 py-2 text-xs">
          {(["ALL", "SUCCESS", "WARNING", "ERROR", "INFO"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("rounded px-2 py-1", filter === f ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800")}>{f}</button>
          ))}
          <span className="ml-auto self-center text-slate-500">{shown.length} lines</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed" data-testid="log-stream">
          {shown.length === 0 && <div className="p-6 text-center text-slate-500">Waiting for events…</div>}
          {shown.map((l) => (
            <div key={l.seq} className="py-0.5">
              <div className="flex gap-2">
                <span className="shrink-0 text-slate-500">{fmtClock(l.ts)}</span>
                <span className={cn("w-[68px] shrink-0 font-semibold", color[l.level])}>[{l.level}]</span>
                <span className="break-words">{l.message}</span>
                {l.stack && <button onClick={() => setExpanded((s) => { const n = new Set(s); n.has(l.seq) ? n.delete(l.seq) : n.add(l.seq); return n; })} className="ml-auto shrink-0 text-slate-400 hover:text-white" aria-label="Toggle stack trace">{expanded.has(l.seq) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>}
              </div>
              {l.stack && expanded.has(l.seq) && <pre className="ml-[100px] mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[11px] text-red-300">{l.stack}</pre>}
            </div>
          ))}
          <div ref={end} />
        </div>
      </aside>
    </>
  );
}

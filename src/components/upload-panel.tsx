"use client";
import { AlertTriangle, CalendarClock, Download, FileSpreadsheet, HardDrive, Loader2, UploadCloud, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { UploadSummary } from "@/lib/types";
import { ApiError } from "./types";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function UploadPanel({ onDone, onToast }: { onDone: () => void; onToast: (t: { kind: "ok" | "err"; msg: string }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"immediate" | "scheduled">("immediate");
  const [runAt, setRunAt] = useState(() => localInput(new Date(Date.now() + 10 * 60000)));
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<{ msg: string; details: string[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    setResult(null); setError(null);
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { setFile(null); setError({ msg: "Only .xlsx files are supported.", details: [] }); return; }
    setFile(f);
  };

  async function submit() {
    if (!file) return;
    setBusy(true); setError(null); setResult(null);
    const fd = new FormData();
    fd.append("file", file); fd.append("mode", mode);
    if (mode === "scheduled") fd.append("runAt", new Date(runAt).toISOString());
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error ?? `Upload failed (${res.status})`, body.details ?? []);
      if (body.summary) { setResult(body.summary); onToast({ kind: "ok", msg: `${body.summary.staged} staged, ${body.summary.duplicates} duplicates suppressed` }); }
      else onToast({ kind: "ok", msg: `Scheduled for ${new Date(body.scheduled.runAt).toLocaleString()}` });
      setFile(null); if (input.current) input.current.value = "";
      onDone();
    } catch (e) {
      const err = e as ApiError;
      setError({ msg: err.message, details: err.details ?? [] });
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingestion Gateway</CardTitle>
        <div className="flex gap-2">
          <a href="/api/template" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium hover:bg-slate-50"><Download className="h-3.5 w-3.5" />Template (.xlsx)</a>
          <a href="/api/template?sample=1" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium hover:bg-slate-50"><FileSpreadsheet className="h-3.5 w-3.5" />Sample data</a>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          role="button" tabIndex={0} aria-label="Upload zone"
          onClick={() => input.current?.click()} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={cn("flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors", drag ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-500 hover:bg-slate-50")}
        >
          <UploadCloud className="mb-2 h-8 w-8 text-slate-400" />
          {file ? <div className="text-sm font-medium">{file.name} <span className="text-slate-500">({(file.size / 1024).toFixed(1)} KB)</span></div>
                : <div className="text-sm text-slate-600"><b>Drop the filled 26-column .xlsx here</b> or click to browse</div>}
          <div className="mt-1 text-xs text-slate-400">Max 10 MB · 5,000 rows</div>
          <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-md border border-slate-300 p-0.5 text-sm" role="radiogroup" aria-label="Execution mode">
            {(["immediate", "scheduled"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={cn("inline-flex items-center gap-1.5 rounded px-3 py-1.5", mode === m ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100")}>
                {m === "immediate" ? <Zap className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}{m === "immediate" ? "Immediate" : "Scheduled"}
              </button>
            ))}
          </div>
          {mode === "scheduled" && (
            <label className="text-xs text-slate-600">Run at
              <Input type="datetime-local" value={runAt} min={localInput(new Date())} onChange={(e) => setRunAt(e.target.value)} className="mt-1 w-52" />
            </label>
          )}
          <Button onClick={submit} disabled={!file || busy} className="ml-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{mode === "immediate" ? "Upload & process" : "Schedule ingestion"}
          </Button>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />{error.msg}</div>
            {error.details.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{error.details.slice(0, 6).map((d, i) => <li key={i} className="break-words">{d}</li>)}</ul>}
          </div>
        )}
        {result && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="font-medium">{result.fileName}: {result.totalRows} rows read</div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs">
              <span className="text-emerald-700">{result.staged} staged for approval</span>
              <span className="text-violet-700">{result.duplicates} duplicates suppressed</span>
              <span className={result.invalid ? "text-red-700" : "text-slate-500"}>{result.invalid} invalid</span>
            </div>
            {result.originalDrivePath && <div className="mt-1 flex items-center gap-1 text-xs text-slate-600"><HardDrive className="h-3.5 w-3.5" />Being saved to the shared Google Drive folder (the original file, the attachments and a live tracking sheet)</div>}
            {result.warnings.map((w, i) => <div key={i} className="mt-1 text-xs text-amber-700">⚠ {w}</div>)}
            {result.issues.length > 0 && (
              <details className="mt-2 text-xs"><summary className="cursor-pointer text-red-700">Row errors ({result.issues.length})</summary>
                <ul className="mt-1 space-y-0.5">{result.issues.slice(0, 30).map((i, k) => <li key={k}>Row {i.row} · <b>{i.column}</b> {i.message}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

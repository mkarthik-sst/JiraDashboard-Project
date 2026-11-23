"use client";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** One field with an edit (pencil) mark. Click the pencil, change the value, Save. */
export function EditField({ label, value, canEdit, onSave, multiline = false, options, hint, wide = false }: {
  label: string; value: string; canEdit: boolean; onSave: (v: string) => Promise<void>; multiline?: boolean; options?: string[]; hint?: string; wide?: boolean;
}) {
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const listId = `opts-${label.replace(/\W+/g, "")}`;
  async function save() {
    setBusy(true); setErr("");
    try { await onSave(draft); setEditing(false); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className={`min-w-0 ${wide ? "col-span-2 md:col-span-4" : ""}`}>
      <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">{label}
        {canEdit && !editing && <button type="button" aria-label={`Edit ${label}`} title={`Edit ${label}`} onClick={() => { setDraft(value); setErr(""); setEditing(true); }} className="rounded p-0.5 text-slate-400 hover:bg-brand-50 hover:text-brand-700"><Pencil className="h-3 w-3" /></button>}
      </dt>
      <dd className="text-slate-800">
        {editing ? (
          <div className="mt-1 space-y-1.5">
            {multiline
              ? <textarea aria-label={label} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" />
              : <><Input aria-label={label} autoFocus list={options ? listId : undefined} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }} />
                  {options && <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>}</>}
            {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
            {err && <p role="alert" className="rounded bg-red-50 p-1.5 text-[11px] text-red-700">{err}</p>}
            <div className="flex gap-1.5">
              <Button size="sm" onClick={save} disabled={busy} aria-label={`Save ${label}`}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}><X className="h-3.5 w-3.5" />Cancel</Button>
            </div>
          </div>
        ) : <div className={multiline ? "whitespace-pre-wrap break-words" : "break-words"}>{value || <span className="text-slate-400">-</span>}</div>}
      </dd>
    </div>
  );
}

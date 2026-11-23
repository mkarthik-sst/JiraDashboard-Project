"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

/** Comment box used to send a defect back to the reporter (comment required) or back for approval (comment optional). */
export function NoteDialog({ open, title, description, summary, label, required, submitLabel, icon, onClose, onSubmit }: {
  open: boolean; title: string; description: string; summary: string; label: string; required: boolean; submitLabel: string; icon: React.ReactNode;
  onClose: () => void; onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (open) { setNote(""); setErr(""); } }, [open]);
  async function go() {
    setBusy(true); setErr("");
    try { await onSubmit(note.trim()); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent title={title} description={description}>
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-slate-50 p-3 font-medium">{summary}</div>
            <label className="block text-xs font-medium text-slate-700">{label}{required ? " (required)" : " (optional)"}
              <textarea aria-label="Comment" autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={5} placeholder="Write your comment…" className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" />
            </label>
            {err && <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={go} disabled={busy || (required && !note.trim())}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}{submitLabel}</Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

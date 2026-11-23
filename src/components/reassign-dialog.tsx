"use client";
import { Loader2, UserRoundCog } from "lucide-react";
import { useEffect, useState } from "react";
import type { DefectRecord } from "@/lib/schema";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Input } from "./ui/input";

export const KNOWN_ASSIGNEES = [
  "dev.lead@smartshift.com", "cds.expert@smartshift.com", "cfl.owner@smartshift.com", "amf.engineer@smartshift.com",
  "clean.core.architect@smartshift.com", "senior.cfl@smartshift.com", "basis.admin@smartshift.com",
];
const RE = /^([^\s@]+@[^\s@]+\.[^\s@]{2,}|[^@]{2,120})$/;   // email OR Jira display name

export function ReassignDialog({ record, onClose, onSubmit }: { record: DefectRecord | null; onClose: () => void; onSubmit: (id: string, email: string, note: string) => Promise<void> }) {
  const [email, setEmail] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { setEmail(""); setNote(""); setErr(""); }, [record?.id]);
  const current = record ? record.ReassignedToEmail || record.AssigneeEmail : "";
  const valid = RE.test(email.trim()) && email.trim().toLowerCase() !== current.toLowerCase();

  async function go() {
    if (!record) return;
    setBusy(true); setErr("");
    try { await onSubmit(record.id, email.trim(), note.trim()); onClose(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      {record && (
        <DialogContent title="Change Assignee" description="The new assignee is notified and must approve the ticket. Jira is not called yet.">
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-slate-50 p-3">
              <div className="font-medium">{record.Summary}</div>
              <div className="mt-1 text-xs text-slate-500">Current assignee: <b>{current}</b> · {record.Priority} · {record.ProjectKey}</div>
            </div>
            <label className="block text-xs font-medium text-slate-700">New assignee (email or name)
              <Input list="assignees" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@smartshift.com" className="mt-1" />
              <datalist id="assignees">{KNOWN_ASSIGNEES.filter((a) => a !== current).map((a) => <option key={a} value={a} />)}</datalist>
            </label>
            {email && !valid && <p className="text-xs text-red-600">{RE.test(email.trim()) ? "Same as the current assignee." : "Enter a valid email or user name."}</p>}
            <label className="block text-xs font-medium text-slate-700">Note (optional)
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why is this being reassigned?" className="mt-1" />
            </label>
            {err && <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={go} disabled={!valid || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCog className="h-4 w-4" />}Reassign & notify</Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

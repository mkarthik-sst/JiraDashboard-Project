"use client";
import { Ban, CalendarClock, MessageSquareReply, Send, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovedTable } from "@/components/approved-table";
import { CancelledTable } from "@/components/cancelled-table";
import { RecurrenceReport } from "@/components/recurrence-report";
import { DupPanel } from "@/components/dup-panel";
import { AppHeader } from "@/components/header";
import { KpiCards, type Target } from "@/components/kpi-cards";
import { LogDrawer } from "@/components/log-drawer";
import { NoteDialog } from "@/components/note-dialog";
import { PendingTable } from "@/components/pending-table";
import { ReassignDialog } from "@/components/reassign-dialog";
import { api, type DashState, type DupView, type RecordView } from "@/components/types";
import { UploadPanel } from "@/components/upload-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDashboard } from "@/components/use-dashboard";
import type { DefectRecord } from "@/lib/schema";
import type { TabKey } from "@/lib/types";
import { fmtTime } from "@/lib/utils";

type Toast = { kind: "ok" | "err"; msg: string } | null;
const TABS: TabKey[] = ["pending", "reassigned", "reporter", "approved", "cancelled", "report"];
const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function Dashboard() {
  const { state, logs, offline, refresh } = useDashboard();
  const [toast, setToast] = useState<Toast>(null);
  const [drawer, setDrawer] = useState(false);
  const [target, setTarget] = useState<DefectRecord | null>(null);
  const [note, setNote] = useState<{ rec: RecordView; kind: "return" | "resubmit" | "cancel" } | null>(null);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<TabKey>("pending");
  const [focusId, setFocusId] = useState(""); const [focusJira, setFocusJira] = useState("");
  const [linkHandled, setLinkHandled] = useState(false);
  const [flash, setFlash] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const scrollTo = useCallback((id: string) => {
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    setFlash(id); clearTimeout(timer.current); timer.current = setTimeout(() => setFlash(""), 1600);
  }, []);

  // Deep link from the notification e-mails: /?tab=pending|reassigned|reporter|approved&record=<id>
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab") as TabKey; if (TABS.includes(t)) setTab(t);
    setFocusId(q.get("record") ?? "");
  }, []);
  useEffect(() => {
    if (linkHandled || !state) return;
    setLinkHandled(true);
    if (!focusId) return;
    const where = state.pending.some((r) => r.id === focusId) ? "pending" : state.reassigned.some((r) => r.id === focusId) ? "reassigned" : state.reporterReview.some((r) => r.id === focusId) ? "reporter" : state.cancelled.some((r) => r.id === focusId) ? "cancelled" : "";
    if (where) { setTab(where); scrollTo("section-records"); }
    else { setTab("approved"); setToast({ kind: "ok", msg: "That defect is no longer waiting - it was already approved or moved on." }); setFocusId(""); }
  }, [state, focusId, linkHandled, scrollTo]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { setTick((t) => t + 1); }, [state?.stats.approved]);

  function go(t: Target) {
    if (t === "scheduled" || t === "duplicates") { scrollTo(`section-${t}`); return; }
    setTab(t); setFocusId(""); setFocusJira(""); scrollTo("section-records");
  }
  function openDuplicate(e: DupView) {
    if (!e.target) return;
    setTab(e.target.tab); setFocusId(e.target.recordId); setFocusJira(e.target.tab === "approved" ? e.target.jiraId : "");
    scrollTo("section-records");
  }

  async function approve(r: DefectRecord) {
    try {
      const { record } = await api<{ record: DefectRecord }>(`/api/records/${r.id}/approve`, { method: "POST" });
      setToast({ kind: "ok", msg: `Jira ticket ${record.JiraTicketID} created` });
    } catch (e) { setToast({ kind: "err", msg: `Approval failed: ${(e as Error).message}` }); if (!/details are missing/i.test((e as Error).message)) setDrawer(true); }
    void refresh();
  }
  async function reassign(id: string, email: string, note: string) {
    await api(`/api/records/${id}/reassign`, jsonPost({ email, note }));
    setToast({ kind: "ok", msg: `Reassigned to ${email}; notification sent` });
    void refresh();
  }
  async function cancel(id: string) {
    try { await api(`/api/scheduled/${id}`, { method: "DELETE" }); void refresh(); } catch (e) { setToast({ kind: "err", msg: (e as Error).message }); }
  }
  async function syncNow() {
    try { await api("/api/sync", { method: "POST" }); } catch (e) { setToast({ kind: "err", msg: (e as Error).message }); }
    void refresh();
  }
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }

  if (!state) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">{offline || "Loading dashboard…"}</div>;
  const s = state as DashState;
  const ring = (id: string) => (flash === id ? "ring-2 ring-brand-500 ring-offset-2 transition" : "transition");
  const rowProps = { focusId, env: s.env, onApprove: approve, onReassign: setTarget, onReturn: (r: RecordView) => setNote({ rec: r, kind: "return" }), onResubmit: (r: RecordView) => setNote({ rec: r, kind: "resubmit" }), onCancel: (r: RecordView) => setNote({ rec: r, kind: "cancel" }), onChanged: () => void refresh(), onToast: setToast };

  return (
    <main className="mx-auto max-w-[1500px] space-y-4 px-4 py-5">
      <AppHeader s={s} onSync={syncNow} onSignOut={signOut} />

      {offline && <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-800"><WifiOff className="h-4 w-4" />{offline} Retrying every 2 seconds…</div>}
      {!!s.warnings?.length && (
        <div role="alert" data-testid="config-warnings" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">Configuration check</div>
          <ul className="list-disc space-y-0.5 pl-5">{s.warnings.map((w) => <li key={w.text} className={w.level === "error" ? "font-medium text-red-800" : ""}>{w.text}</li>)}</ul>
        </div>
      )}
      {toast && (
        <div role="status" className={`fixed left-1/2 top-4 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-md px-4 py-2.5 text-sm text-white shadow-lg ${toast.kind === "ok" ? "bg-emerald-700" : "bg-red-700"}`}>
          <span>{toast.msg}</span><button aria-label="Dismiss" onClick={() => setToast(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <KpiCards s={s.stats} active={tab} onGo={go} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3"><UploadPanel onDone={refresh} onToast={setToast} /></div>
        <div id="section-duplicates" className={`scroll-mt-4 rounded-lg lg:col-span-2 ${ring("section-duplicates")}`}><DupPanel events={s.duplicates} last={s.lastUpload} threshold={s.env.threshold} onOpen={openDuplicate} /></div>
      </div>

      <div id="section-scheduled" className={`scroll-mt-4 rounded-lg ${ring("section-scheduled")}`}>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />Scheduled Ingestion Runs</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!s.scheduled.length ? <p className="p-4 text-sm text-slate-500">No scheduled runs. Choose “Scheduled” in the upload box to process a file later.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {s.scheduled.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <span className="font-medium">{r.fileName}</span><span className="text-xs text-slate-500">{fmtTime(r.runAt)}</span>
                    <Badge tone={r.status === "SCHEDULED" ? "blue" : r.status === "COMPLETED" ? "green" : r.status === "FAILED" ? "red" : "slate"}>{r.status}</Badge>
                    <span className="text-xs text-slate-500">{r.resultMessage}</span>
                    {r.status === "SCHEDULED" && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => cancel(r.id)}>Cancel</Button>}
                  </li>))}
              </ul>)}
          </CardContent>
        </Card>
      </div>

      <div id="section-records" className={`scroll-mt-4 rounded-lg ${ring("section-records")}`}>
        <Card>
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList className="px-2">
              <TabsTrigger value="pending">Pending Approvals <Badge tone="amber" className="ml-1">{s.stats.pending}</Badge></TabsTrigger>
              <TabsTrigger value="reassigned">Reassigned <Badge tone="violet" className="ml-1">{s.stats.reassigned}</Badge></TabsTrigger>
              <TabsTrigger value="reporter">Reporter Review <Badge tone="sky" className="ml-1">{s.stats.reporterReview}</Badge></TabsTrigger>
              <TabsTrigger value="approved">Approved Records <Badge tone="green" className="ml-1">{s.stats.approved}</Badge></TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled <Badge tone="slate" className="ml-1">{s.stats.cancelled}</Badge></TabsTrigger>
              <TabsTrigger value="report">Recurrence report</TabsTrigger>
            </TabsList>
            <TabsContent value="pending"><PendingTable rows={s.pending} variant="pending" {...rowProps} /></TabsContent>
            <TabsContent value="reassigned"><PendingTable rows={s.reassigned} variant="reassigned" {...rowProps} /></TabsContent>
            <TabsContent value="reporter"><PendingTable rows={s.reporterReview} variant="reporter" {...rowProps} /></TabsContent>
            <TabsContent value="approved"><ApprovedTable refreshKey={tick} focusId={focusId} focusJira={focusJira} /></TabsContent>
            <TabsContent value="cancelled"><CancelledTable rows={s.cancelled} focusId={focusId} env={s.env} onChanged={() => void refresh()} onToast={setToast} /></TabsContent>
            <TabsContent value="report"><RecurrenceReport refreshKey={tick + s.stats.total + s.stats.cancelled + s.stats.preventedDuplicates} /></TabsContent>
          </Tabs>
        </Card>
      </div>

      <ReassignDialog record={target} onClose={() => setTarget(null)} onSubmit={reassign} />
      <NoteDialog
        open={!!note} onClose={() => setNote(null)} summary={note?.rec.Summary ?? ""}
        required={note?.kind === "return" || note?.kind === "cancel"}
        title={note?.kind === "cancel" ? "Cancel this entry" : note?.kind === "return" ? "Return to reporter" : "Send for approval"}
        description={note?.kind === "cancel" ? `No Jira ticket will be created for this entry and it moves to the Cancelled tab. The assignee and reporter are told by e-mail. This cannot be undone here; the same defect can be uploaded again later.` : note?.kind === "return" ? `The reporter (${note.rec.ReporterEmail}) gets an e-mail with your comment, and the defect moves to Reporter Review.` : note ? `The defect goes back to ${note.rec.ReassignedToEmail || note.rec.AssigneeEmail}, who gets an e-mail with your comment.` : ""}
        label={note?.kind === "cancel" ? "Reason for cancelling" : note?.kind === "return" ? "Comment for the reporter" : "Comment for the approver"}
        submitLabel={note?.kind === "cancel" ? "Cancel entry" : note?.kind === "return" ? "Return & notify" : "Send for approval"}
        icon={note?.kind === "cancel" ? <Ban className="h-4 w-4" /> : note?.kind === "return" ? <MessageSquareReply className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        onSubmit={async (text) => {
          if (!note) return;
          if (note.kind === "cancel") {
            await api(`/api/records/${note.rec.id}/cancel`, jsonPost({ reason: text }));
            setToast({ kind: "ok", msg: "Entry cancelled - no Jira ticket will be created" }); setTab("cancelled"); void refresh(); return;
          }
          await api(`/api/records/${note.rec.id}/${note.kind === "return" ? "return" : "resubmit"}`, jsonPost({ note: text }));
          setToast({ kind: "ok", msg: note.kind === "return" ? `Returned to ${note.rec.ReporterEmail}; e-mail sent` : `Sent for approval to ${note.rec.ReassignedToEmail || note.rec.AssigneeEmail}; e-mail sent` });
          if (note.kind === "return") setTab("reporter"); else setTab(note.rec.ReassignedToEmail ? "reassigned" : "pending");
          void refresh();
        }}
      />
      <LogDrawer logs={logs} open={drawer} onToggle={() => setDrawer((d) => !d)} />
    </main>
  );
}

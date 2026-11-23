"use client";
import { Cloud, CloudOff, FlaskConical, FolderOpen, Layers, LogOut, MailOpen, RefreshCw, UserRound } from "lucide-react";
import { fmtTime } from "@/lib/utils";
import type { DashState } from "./types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

/** smartShift logo + "Defect Hub" title, environment badges, storage status and (for administrators) sync controls. */
export function AppHeader({ s, onSync, onSignOut }: { s: DashState; onSync: () => void; onSignOut: () => void }) {
  const sy = s.sync; const admin = s.me.admin;
  return (
    <header className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="h-1 bg-gradient-to-r from-[#1b6fb8] via-[#3a9ad9] to-[#3b3b3d]" />
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/smartshift-logo.png" alt="smartShift Technologies" className="h-11 w-auto" />
          <div className="hidden h-10 w-px bg-slate-200 sm:block" />
          <div>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-slate-800">Defect Hub</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><Layers className="h-3.5 w-3.5" />{s.env.workspace}
              <Badge tone={s.env.jiraMode === "live" ? "green" : "amber"}>{s.env.jiraMode === "live" ? "Jira LIVE" : <span className="inline-flex items-center gap-1"><FlaskConical className="h-3 w-3" />Jira MOCK mode</span>}</Badge>
              <Badge tone="slate">project {s.env.defaultProject}</Badge></p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {sy.mode !== "none" && (
            <span title={sy.lastError || sy.target} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
              {sy.state === "error" ? <CloudOff className="h-3.5 w-3.5 text-red-600" /> : <Cloud className="h-3.5 w-3.5 text-emerald-600" />}
              {sy.mode === "gdrive" ? "Google Drive" : "Sync"}: {sy.state}{sy.lastSyncAt ? ` · ${fmtTime(sy.lastSyncAt)}` : ""}{sy.mode === "gdrive" && sy.queued > 0 && ` · ${sy.queued} queued`}
            </span>)}
          {sy.folderUrl && <a href={sy.folderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-brand-700 hover:bg-slate-50"><FolderOpen className="h-3.5 w-3.5" />Open Drive folder</a>}
          {s.mail.sink && <a href="/api/mail-sink" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-brand-700 hover:bg-slate-50"><MailOpen className="h-3.5 w-3.5" />Test mailbox</a>}
          {admin && sy.mode !== "none" && <Button size="sm" variant="outline" onClick={onSync}><RefreshCw className="h-3.5 w-3.5" />Sync now</Button>}
          {s.me.auth === "email" && (
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-2.5 pr-1.5">
              <UserRound className="h-3.5 w-3.5 text-slate-500" /><span className="max-w-[12rem] truncate font-medium" title={s.me.email}>{s.me.email}</span>{admin && <Badge tone="violet">admin</Badge>}
              <button onClick={onSignOut} aria-label="Sign out" title="Sign out" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><LogOut className="h-3.5 w-3.5" /></button>
            </span>)}
        </div>
      </div>
    </header>
  );
}

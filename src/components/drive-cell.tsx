import { AlertTriangle, Cloud, CloudOff, CloudUpload } from "lucide-react";
import type { DriveStatus } from "@/lib/types";

/** Google Drive icon for one defect: green = saved, amber = waiting / retrying, red = last sync failed, grey = Drive storage off. */
export function DriveCell({ d }: { d: DriveStatus | undefined }) {
  if (!d) return <span className="text-xs text-slate-400">-</span>;
  const look = d.state === "saved" ? { Icon: Cloud, cls: "text-emerald-700 bg-emerald-50", label: "Saved" }
    : d.state === "queued" ? { Icon: CloudUpload, cls: "text-amber-700 bg-amber-50", label: "Updating" }
    : d.state === "error" ? { Icon: AlertTriangle, cls: "text-red-700 bg-red-50", label: "Failed" }
    : { Icon: CloudOff, cls: "text-slate-500 bg-slate-100", label: "Off" };
  const body = <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${look.cls}`}><look.Icon className="h-3.5 w-3.5" />{look.label}</span>;
  return (
    <div className="min-w-[5.5rem] text-xs" data-testid="drive-status" data-state={d.state} title={d.detail}>
      {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="hover:opacity-80">{body}</a> : body}
      {d.state !== "off" && <div className="mt-0.5 text-[10px] text-slate-500">{d.state === "queued" || d.state === "error" ? `${d.queued} waiting` : `${d.files} file${d.files === 1 ? "" : "s"}`}</div>}
    </div>
  );
}

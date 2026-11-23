"use client";
import { ExternalLink, FileImage, FileSpreadsheet, FileText, FileType2, HardDrive, Link2, Paperclip, TriangleAlert } from "lucide-react";
import type { AttachmentInfo } from "@/lib/schema";

const ICON: Record<AttachmentInfo["category"], typeof FileText> = {
  image: FileImage, word: FileText, excel: FileSpreadsheet, pdf: FileType2, powerpoint: FileType2, text: FileText, other: Paperclip, link: Link2,
};
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Reviewable attachment list: images show a thumbnail, every file opens in a new tab (Word/Excel download), Google Drive copy is linked. */
export function AttachmentList({ items }: { items: AttachmentInfo[] }) {
  if (!items.length) return <span className="text-slate-400">No attachments</span>;
  return (
    <ul className="flex flex-wrap gap-2" data-testid="attachment-list">
      {items.map((a, i) => {
        const Icon = ICON[a.category];
        if (!a.exists) return (
          <li key={i} className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800" title={a.note}>
            <TriangleAlert className="h-3.5 w-3.5" /><span className="font-medium">{a.name}</span><span>- {a.note}</span>
          </li>
        );
        return (
          <li key={i} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-1.5">
            {a.category === "image" && a.kind === "file" && (
              <a href={a.href} target="_blank" rel="noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.href} alt={a.name} className="h-12 w-16 rounded border border-slate-200 object-cover" />
              </a>
            )}
            <div className="min-w-0">
              <a href={a.href} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-brand-700 hover:underline" data-testid="attachment-link">
                <Icon className="h-3.5 w-3.5 shrink-0" /><span className="max-w-[14rem] truncate">{a.name}</span><ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span>{a.kind === "url" ? "web link" : `${a.category} · ${kb(a.size)}`}</span>
                {a.kind === "file" && a.driveUrl && <a href={a.driveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:underline"><HardDrive className="h-3 w-3" />Drive copy</a>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

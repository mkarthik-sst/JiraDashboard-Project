"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export function DialogContent({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-slate-900/50" />
      <D.Content className={cn("fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-5 shadow-xl focus:outline-none", className)}>
        <D.Title className="text-base font-semibold text-slate-900">{title}</D.Title>
        <D.Description className="mt-1 text-sm text-slate-500">{description ?? " "}</D.Description>
        <div className="mt-4">{children}</div>
        <D.Close aria-label="Close" className="absolute right-3 top-3 rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></D.Close>
      </D.Content>
    </D.Portal>
  );
}

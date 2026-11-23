"use client";
import { useState } from "react";
import { fmtTime } from "@/lib/utils";
import type { MailStatus } from "@/lib/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

/** Plain-English meaning and fix for the most common e-mail problems. */
export function explainMailError(error: string): { what: string; fix: string[] } {
  const e = error || "";
  if (/E-mail is off|SMTP_HOST/i.test(e)) return { what: "E-mail is switched off: the Hub has no SMTP server configured, so it did not even try to send.", fix: ["Make sure your settings file is named exactly .env.local (not .env.local.sample) and sits in the project folder.", "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM (Gmail: smtp.gmail.com, 587 or 465, a 16-character app password).", "Stop and start the Hub, then press Test mailbox in the header."] };
  if (/No e-mail address/i.test(e)) return { what: "The assignee/reporter in the sheet is a name, not an e-mail address, and the Hub could not find an address for it.", fix: ["Write e-mail addresses in the Excel sheet, or", "add the name to NOTIFY_USER_MAP in .env.local, e.g. {\"Alex Morgan\":\"alex@company.com\"}, or set NOTIFY_FALLBACK_EMAIL."] };
  if (/EAUTH|535|534|Invalid login|Username and Password|Application-specific|BadCredentials/i.test(e)) return { what: "The mail server rejected the user name or password.", fix: ["Gmail needs an APP PASSWORD (Google Account > Security > 2-Step Verification > App passwords), not the normal password.", "Check SMTP_USER is the full address and SMTP_PASSWORD has no spaces or quotes.", "Office 365: the mailbox needs Authenticated SMTP enabled."] };
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ESOCKET|ECONNECTION|EAI_AGAIN|timed? ?out|getaddrinfo/i.test(e)) return { what: "The Hub could not reach the mail server (network, wrong host, wrong port or a firewall).", fix: ["Check SMTP_HOST spelling. Gmail: smtp.gmail.com.", "Port 587 with SMTP_SECURE=false, or port 465 with SMTP_SECURE=true. Do not mix them.", "A company firewall/VPN may block outgoing SMTP; try another network or ask IT to allow it."] };
  if (/wrong version number|SSL|TLS|certificate/i.test(e)) return { what: "A secure-connection (TLS) mismatch with the mail server.", fix: ["Port 465 needs SMTP_SECURE=true. Port 587 needs SMTP_SECURE=false.", "Behind a company proxy with its own certificate you may need SMTP_REJECT_UNAUTHORIZED=false (test only)."] };
  if (/550|553|554|rejected|not allowed|relay/i.test(e)) return { what: "The mail server refused this message or recipient.", fix: ["Check SMTP_FROM is an address the mailbox is allowed to send as.", "Check the recipient address is valid and that your server allows relaying to it."] };
  return { what: "The mail server returned an error that the Hub does not recognise.", fix: ["Copy the technical message above and check docs/10-EMAIL-NOTIFICATIONS.md.", "Press Test mailbox in the header to send a plain test mail and see the same error in the Live logs drawer."] };
}

/** "E-mail status update": what was last mailed about this defect. Click it for the full detail and how to fix a failure. */
export function MailCell({ m }: { m: MailStatus | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!m) return <span className="text-xs text-slate-400" title="No e-mail has been sent about this defect yet">Not sent yet</span>;
  const off = !m.delivered && /E-mail is off/i.test(m.error ?? "");
  const x = !m.delivered ? explainMailError(m.error ?? "") : null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Show e-mail details" title="Click for the full e-mail details" className="min-w-[9rem] rounded p-1 text-left text-xs hover:bg-slate-100" data-testid="mail-status">
        {m.delivered ? <Badge tone="green">Sent</Badge> : off ? <Badge tone="amber">Not sent</Badge> : <Badge tone="red">Failed</Badge>}
        <div className="mt-0.5 font-medium text-slate-700">{m.label}</div>
        <div className="max-w-[11rem] truncate text-slate-500">{m.to} · {fmtTime(m.at)}</div>
        {!m.delivered && m.error && <div className="max-w-[11rem] truncate text-red-600">{m.error}</div>}
        <div className="mt-0.5 text-[10px] font-medium text-brand-700 underline">View details</div>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent title={m.delivered ? "E-mail sent" : off ? "E-mail not sent" : "E-mail failed"} description={m.label}>
            <div className="space-y-3 text-sm" data-testid="mail-detail">
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-xs">
                <dt className="text-slate-500">Event</dt><dd>{m.label}</dd>
                <dt className="text-slate-500">To</dt><dd className="break-all">{m.to}</dd>
                <dt className="text-slate-500">Time</dt><dd>{fmtTime(m.at)}</dd>
                <dt className="text-slate-500">Channel</dt><dd>{m.channel}</dd>
                <dt className="text-slate-500">Result</dt><dd>{m.delivered ? "Accepted by the mail server" : off ? "Not attempted (e-mail off)" : "Rejected / not delivered"}</dd>
              </dl>
              {!m.delivered && (
                <>
                  <div><div className="text-xs font-semibold text-slate-700">Technical message</div><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-900 p-2 text-xs text-red-200">{m.error || "(no message)"}</pre></div>
                  {x && <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-900"><div className="font-semibold">What it means</div><p className="mt-0.5">{x.what}</p><div className="mt-2 font-semibold">How to fix it</div><ul className="mt-0.5 list-disc space-y-0.5 pl-4">{x.fix.map((f) => <li key={f}>{f}</li>)}</ul></div>}
                </>
              )}
              <div className="flex justify-end"><Button variant="outline" onClick={() => setOpen(false)}>Close</Button></div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
export const mailKind = (m: MailStatus | null | undefined): "sent" | "failed" | "none" => (!m ? "none" : m.delivered ? "sent" : "failed");

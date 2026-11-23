/**
 * Notifications. Three events send an e-mail (SMTP) that links straight to the dashboard:
 *   1. upload     -> every assignee gets ONE mail per upload listing the defects waiting for their approval
 *   2. reassign   -> the new assignee gets a mail with a link to the Reassigned tab
 *   3. approve    -> assignee (and reporter) get the Jira ticket link
 * The recipient column may hold an e-mail OR a display name; names are resolved through NOTIFY_USER_MAP, then Jira (live mode).
 * Mail is sent in the background and can never block or fail an upload / approval; every attempt is audited in the store + log.
 * An optional Teams/Slack-style webhook (NOTIFY_WEBHOOK_URL) receives the same text.
 */
import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import { getConfig } from "./config";
import { findJiraUser } from "./jira";
import { log } from "./logger";
import { isEmail, type DefectRecord } from "./schema";
import { engineeringDescription, isEngineeringIssue } from "./engineering";
import { commit, getDb } from "./store";
import type { MailStatus, NotificationEntry } from "./types";

export const emailEnabled = () => !!getConfig().mail.host;

/* ------------------------------------------------------------------ background tracking (lets tests await delivery) */
const inflight = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>): Promise<T> {
  inflight.add(p); void p.finally(() => inflight.delete(p)).catch(() => undefined);
  return p;
}
export async function flushNotifications() { while (inflight.size) await Promise.allSettled([...inflight]); }

/* ------------------------------------------------------------------ helpers */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function dashLink(tab: "pending" | "reassigned" | "reporter" | "approved" | "cancelled" | "report", id?: string): string {
  const base = getConfig().mail.appBaseUrl;
  return `${base}/?tab=${tab}${id ? `&record=${encodeURIComponent(id)}` : ""}`;
}
const firstName = (ref: string) => (ref.includes("@") ? ref.split("@")[0].replace(/[._-]+/g, " ") : ref).split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());

export interface Recipient { email: string; via: "email" | "map" | "jira" | "fallback" }
/** Turn an assignee/reporter cell (e-mail or name) into a mail address. */
export async function resolveRecipient(ref: string, projectKey = ""): Promise<Recipient | null> {
  const t = (ref ?? "").trim();
  if (!t) return null;
  if (isEmail(t)) return { email: t.toLowerCase(), via: "email" };
  const m = getConfig().mail;
  const mapped = Object.entries(m.userMap).find(([k]) => k.trim().toLowerCase() === t.toLowerCase())?.[1];
  if (mapped && isEmail(mapped)) return { email: mapped.toLowerCase(), via: "map" };
  const u = await findJiraUser(t, projectKey);
  if (u?.emailAddress && isEmail(u.emailAddress)) return { email: u.emailAddress.toLowerCase(), via: "jira" };
  return null;
}

const shell = (title: string, intro: string, body: string, cta: { label: string; href: string }, footer: string) => `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:8px">
<tr><td style="background:#1d4ed8;color:#fff;padding:16px 24px;font-size:18px;font-weight:600;border-radius:8px 8px 0 0">smartShift Defect Hub</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2><p style="margin:0 0 16px;font-size:14px;line-height:1.5">${intro}</p>${body}
<p style="margin:24px 0 8px"><a href="${esc(cta.href)}" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>
<p style="margin:12px 0 0;font-size:12px;color:#64748b">If the button does not work, copy this link: <a href="${esc(cta.href)}" style="color:#1d4ed8">${esc(cta.href)}</a></p></td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">${footer}</td></tr></table></td></tr></table></body></html>`;

const th = 'style="text-align:left;padding:6px 8px;background:#f1f5f9;border:1px solid #e2e8f0;font-size:12px"';
const td = 'style="padding:6px 8px;border:1px solid #e2e8f0;font-size:13px;vertical-align:top"';
const table = (rows: DefectRecord[], link: (r: DefectRecord) => string) => `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><th ${th}>Defect</th><th ${th}>Priority</th><th ${th}>Type</th><th ${th}>Attachments</th><th ${th}>Open</th></tr>${rows.map((r) =>
  `<tr><td ${td}>${esc(r.Summary)}<br><span style="color:#64748b;font-size:12px">${esc(r.ProjectKey)}${r.Customer ? " &middot; " + esc(r.Customer) : ""}</span></td><td ${td}>${esc(r.Priority)}</td><td ${td}>${esc(r.IssueType)}</td><td ${td}>${r.attachments?.length ?? 0}</td><td ${td}><a href="${esc(link(r))}" style="color:#1d4ed8">Review</a></td></tr>`).join("")}</table>`;
const plainRows = (rows: DefectRecord[], link: (r: DefectRecord) => string) => rows.map((r, i) => `${i + 1}. [${r.Priority}] ${r.Summary}\n   ${link(r)}`).join("\n");

/* ------------------------------------------------------------------ delivery */
interface Msg { to: string; cc?: string[]; subject: string; html: string; text: string; event: string; recordIds?: string[] }
const tabOf = (r: DefectRecord) => (r.ReassignedToEmail ? "reassigned" : "pending") as "pending" | "reassigned";

function record(entry: NotificationEntry) { try { getDb().notifications.push(entry); commit(); } catch { /* store not ready (tests) */ } }

/** NOTIFY_REDIRECT_TO: where a mail for `to` is really sent in test mode ("" = no redirect). */
export function redirectFor(to: string): string {
  const v = getConfig().mail.redirectTo; if (!v) return "";
  if (!v.startsWith("{")) return v;
  try { const m = JSON.parse(v) as Record<string, string>; const k = Object.keys(m).find((x) => x.trim().toLowerCase() === to.trim().toLowerCase()); return (k ? m[k] : m["*"]) ?? ""; } catch { return ""; }
}

async function deliver(m: Msg): Promise<NotificationEntry> {
  const cfg = getConfig();
  const entry: NotificationEntry = { id: randomUUID(), at: new Date().toISOString(), to: m.to, subject: m.subject, body: m.event === "login" ? "" : m.text, channel: emailEnabled() ? "email" : "log", delivered: false, event: m.event, recordIds: m.recordIds };
  if (emailEnabled()) {
    const c = cfg.mail;
    try {
      const tx = nodemailer.createTransport({
        host: c.host, port: c.port, secure: c.secure, ignoreTLS: c.ignoreTls,
        auth: c.user ? { user: c.user, pass: c.password } : undefined,
        tls: { rejectUnauthorized: c.rejectUnauthorized }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      });
      const redirect = redirectFor(m.to);
      const info = await tx.sendMail(redirect
        ? { from: c.from, to: redirect, subject: `[for ${m.to}] ${m.subject}`, text: `TEST MODE: intended for ${m.to}\n\n${m.text}`, html: m.html }
        : { from: c.from, to: m.to, cc: m.cc?.length ? m.cc : c.cc.length ? c.cc : undefined, subject: m.subject, text: m.text, html: m.html });
      entry.delivered = true;
      log("SUCCESS", `E-mail sent to ${redirect ? `${redirect} (test redirect for ${m.to})` : m.to} (${m.event}): ${m.subject} [${info.messageId ?? "ok"}]`);
    } catch (e) {
      entry.error = (e as Error).message;
      log("ERROR", `E-mail to ${m.to} failed (${m.event}): ${entry.error}. Check SMTP_* settings (docs/10-EMAIL-NOTIFICATIONS.md).`, { err: e });
    }
  } else {
    entry.error = "E-mail is off (SMTP_HOST not set)";
    log("INFO", `E-mail not sent to ${m.to} (${m.event}) - SMTP_HOST is not configured. Subject would be: ${m.subject}`);
  }
  if (cfg.notifyWebhook) {
    try {
      const res = await fetch(cfg.notifyWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `**${m.subject}**\nTo: ${m.to}\n${m.text}` }), signal: AbortSignal.timeout(10000) });
      if (!res.ok) log("ERROR", `Webhook notification failed: HTTP ${res.status}`); else if (!entry.delivered) { entry.delivered = true; entry.channel = "webhook"; entry.error = undefined; }
    } catch (e) { log("ERROR", `Webhook notification failed: ${(e as Error).message}`); }
  }
  record(entry);
  return entry;
}

/** Resolve + send; when the address cannot be found, mail the fallback (if set) and warn loudly. */
async function send(ref: string, projectKey: string, build: (toName: string) => Omit<Msg, "to">, extraCc: string[] = [], pre?: Recipient | null): Promise<void> {
  const r = pre !== undefined ? pre : await resolveRecipient(ref, projectKey);
  if (r) { const b = build(firstName(ref)); await deliver({ ...b, to: r.email, cc: extraCc }); return; }
  const fb = getConfig().mail.fallbackTo;
  log("WARNING", `No e-mail address found for "${ref}" - add it to NOTIFY_USER_MAP (name -> e-mail) or use an e-mail in the sheet.${fb ? ` Sending to ${fb} instead.` : ""}`);
  if (fb) { const b = build(firstName(ref)); await deliver({ ...b, to: fb, subject: `[no address for ${ref}] ${b.subject}`, cc: extraCc }); }
  else { const b = build(firstName(ref)); record({ id: randomUUID(), at: new Date().toISOString(), to: ref, subject: b.subject, body: "", channel: "log", delivered: false, error: "No e-mail address found for this name", event: b.event, recordIds: b.recordIds }); }
}

/* ------------------------------------------------------------------ events */
const effective = (r: DefectRecord) => r.ReassignedToEmail || r.AssigneeEmail;

/** 1. Upload: one digest per assignee. */
export function notifyStaged(records: DefectRecord[], fileName: string): Promise<void> {
  if (!getConfig().mail.onUpload || !records.length) return Promise.resolve();
  return track((async (): Promise<void> => {
    // group by the RESOLVED address so "Medisetty Karthik" and "mkarthik@smartshift.com" get one mail, not two
    const cache = new Map<string, Recipient | null>();
    const by = new Map<string, { rec: Recipient | null; rows: DefectRecord[] }>();
    for (const r of records) {
      const ref = effective(r).trim(); const ck = ref.toLowerCase();
      if (!cache.has(ck)) cache.set(ck, await resolveRecipient(ref, r.ProjectKey));
      const rec = cache.get(ck)!; const key = rec?.email ?? `ref:${ck}`;
      by.set(key, { rec, rows: [...(by.get(key)?.rows ?? []), r] });
    }
    for (const { rec: pre, rows } of by.values()) {
      const ref = effective(rows[0]);
      await send(ref, rows[0].ProjectKey, (name) => {
        const one = rows.length === 1;
        const cta = { label: one ? "Review and approve" : "Open Pending Approvals", href: one ? dashLink("pending", rows[0].id) : dashLink("pending") };
        const subject = `Approval requested: ${one ? rows[0].Summary.slice(0, 80) : `${rows.length} defects`} (${fileName})`;
        const html = shell("You have a request to approve", `Hi ${esc(name)}, ${one ? "a defect" : `<b>${rows.length}</b> defects`} from <b>${esc(fileName)}</b> ${one ? "has" : "have"} been assigned to you. Please review the details and attachments, then <b>Approve</b> to create the Jira ticket, or <b>Reassign</b> it to someone else.`,
          table(rows, (r) => dashLink("pending", r.id)), cta, "You receive this because you are the assignee in the uploaded defect sheet. Nothing is created in Jira until you approve.");
        const text = `Hi ${name},\n\n${one ? "A defect" : `${rows.length} defects`} from ${fileName} ${one ? "has" : "have"} been assigned to you for approval.\n\n${plainRows(rows, (r) => dashLink("pending", r.id))}\n\nOpen the dashboard: ${cta.href}\nApprove to create the Jira ticket, or Reassign to someone else.`;
        return { subject, html, text, event: "upload", recordIds: rows.map((r) => r.id) };
      }, [], pre);
    }
  })().catch((e) => { log("ERROR", `Upload notification failed: ${(e as Error).message}`); }));
}

/** 2. Reassign: mail the NEW assignee. */
export function notifyReassigned(rec: DefectRecord, previous: string, note: string): Promise<void> {
  if (!getConfig().mail.onReassign) return Promise.resolve();
  return track(send(rec.ReassignedToEmail, rec.ProjectKey, (name) => {
    const cta = { label: "Review and approve", href: dashLink("reassigned", rec.id) };
    const html = shell("A defect was reassigned to you", `Hi ${esc(name)}, <b>${esc(previous)}</b> reassigned this defect to you.${note ? ` Note: <i>${esc(note)}</i>` : ""} Please review it and <b>Approve</b> to create the Jira ticket.`, table([rec], () => cta.href), cta, "You receive this because the defect was reassigned to you.");
    const text = `Hi ${name},\n\n${previous} reassigned this defect to you for approval.${note ? `\nNote: ${note}` : ""}\n\n${plainRows([rec], () => cta.href)}\n\nOpen the dashboard: ${cta.href}`;
    return { subject: `Reassigned to you: ${rec.Summary.slice(0, 80)}`, html, text, event: "reassign", recordIds: [rec.id] };
  }).catch((e) => { log("ERROR", `Reassign notification failed: ${(e as Error).message}`); }));
}

/** 3. Approve: tell the assignee (and reporter) which Jira ticket was created. */
export function notifyApproved(rec: DefectRecord): Promise<void> {
  const cfg = getConfig();
  if (!cfg.mail.onApprove) return Promise.resolve();
  return track((async () => {
    const refs = [...new Set([effective(rec), rec.ReporterEmail].map((x) => x.trim()).filter(Boolean).map((x) => x.toLowerCase()))];
    for (const lower of refs) {
      const ref = [effective(rec), rec.ReporterEmail].find((x) => x.trim().toLowerCase() === lower)!;
      await send(ref, rec.ProjectKey, (name) => {
        const cta = { label: `Open ${rec.JiraTicketID} in Jira`, href: rec.jiraUrl || dashLink("approved", rec.id) };
        const html = shell(`Jira ticket ${rec.JiraTicketID} created`, `Hi ${esc(name)}, the defect <b>${esc(rec.Summary)}</b> was approved and Jira ticket <b>${esc(rec.JiraTicketID)}</b> was created in space <b>${esc(rec.ProjectKey)}</b>.${rec.lastWarning ? `<br><br><span style="color:#92400e">Note: ${esc(rec.lastWarning)}</span>` : ""}`,
          `<p style="font-size:13px;margin:0">Dashboard: <a href="${esc(dashLink("approved", rec.id))}" style="color:#1d4ed8">Approved Records</a></p>`, cta, "You receive this because you are the assignee or reporter of this defect.");
        const text = `Hi ${name},\n\nThe defect "${rec.Summary}" was approved. Jira ticket ${rec.JiraTicketID} was created.\nJira: ${cta.href}\nDashboard: ${dashLink("approved", rec.id)}`;
        return { subject: `Jira ticket ${rec.JiraTicketID} created: ${rec.Summary.slice(0, 70)}`, html, text, event: "approve", recordIds: [rec.id] };
      });
    }
  })().catch((e) => { log("ERROR", `Approval notification failed: ${(e as Error).message}`); }));
}

/** 3b. Automated-fix defect approved: hand it over to product engineering (ENGINEERING_NOTIFY_EMAIL). */
export function notifyEngineering(rec: DefectRecord): Promise<void> {
  const eng = getConfig().engineering;
  if (!isEngineeringIssue(rec) || !eng.notifyEmail) return Promise.resolve();
  return track((async () => {
    for (const to of eng.notifyEmail.split(/[,;\s]+/).filter(isEmail)) {
      await send(to, rec.ProjectKey, () => {
        const cta = { label: `Open ${rec.JiraTicketID} in Jira`, href: rec.jiraUrl || dashLink("report") };
        const lines = engineeringDescription(rec).slice(2);
        const body = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${lines.map((l) => { const i = l.indexOf(": "); return `<tr><th ${th} width="30%">${esc(l.slice(0, i))}</th><td ${td}>${esc(l.slice(i + 2))}</td></tr>`; }).join("")}</table>`;
        const html = shell(`Automated-fix defect: ${rec.FixRuleId || "no Fix / Rule ID"}`, `Hi team, a defect caused by one of our automated fixes was approved and logged as <b>${esc(rec.JiraTicketID)}</b> (project <b>${esc(rec.ProjectKey)}</b>). Summary: <b>${esc(rec.Summary)}</b>. Please use the analysis below as the starting point.`, body, cta, "You receive this because your address is set as ENGINEERING_NOTIFY_EMAIL in the Defect Hub.");
        const text = `Hi team,\n\nA defect caused by an automated fix was approved: ${rec.JiraTicketID} - ${rec.Summary}\n\n${lines.join("\n")}\n\nJira: ${cta.href}`;
        return { subject: `Automated-fix defect ${rec.JiraTicketID}: ${rec.FixRuleId || rec.Summary.slice(0, 60)}`, html, text, event: "engineering", recordIds: [rec.id] };
      });
    }
  })().catch((e) => { log("ERROR", `Engineering notification failed: ${(e as Error).message}`); }));
}

/** 3c. Entry cancelled: tell the assignee and the reporter (not the person who cancelled it). */
export function notifyCancelled(rec: DefectRecord, reason: string, by: string): Promise<void> {
  if (!getConfig().mail.onReview) return Promise.resolve();
  return track((async () => {
    const refs = [...new Set([effective(rec), rec.ReporterEmail].map((x) => x.trim()).filter(Boolean).map((x) => x.toLowerCase()))].filter((x) => !by || x !== by.toLowerCase());
    for (const lower of refs) {
      const ref = [effective(rec), rec.ReporterEmail].find((x) => x.trim().toLowerCase() === lower)!;
      await send(ref, rec.ProjectKey, (name) => {
        const cta = { label: "Open cancelled entries", href: dashLink("cancelled", rec.id) };
        const quote = `<div style="margin:0 0 16px;padding:10px 14px;border-left:4px solid #94a3b8;background:#f8fafc;font-size:14px;white-space:pre-wrap">${esc(reason)}</div>`;
        const html = shell("Defect entry cancelled", `Hi ${esc(name)}, <b>${esc(by || "a user")}</b> cancelled this entry. <b>No Jira ticket will be created.</b> Reason:`, quote + table([rec], () => cta.href), cta, "You receive this because you are the assignee or reporter of this defect.");
        const text = `Hi ${name},\n\n${by || "A user"} cancelled this entry. No Jira ticket will be created.\nReason: "${reason}"\n\n${plainRows([rec], () => cta.href)}\n\nDashboard: ${cta.href}`;
        return { subject: `Cancelled (no Jira ticket): ${rec.Summary.slice(0, 80)}`, html, text, event: "cancelled", recordIds: [rec.id] };
      });
    }
  })().catch((e) => { log("ERROR", `Cancel notification failed: ${(e as Error).message}`); }));
}

/** 4. Approver returns the defect to the REPORTER with a comment. */
export function notifyReturnedToReporter(rec: DefectRecord, note: string, by: string): Promise<void> {
  if (!getConfig().mail.onReview) return Promise.resolve();
  return track(send(rec.ReporterEmail, rec.ProjectKey, (name) => {
    const cta = { label: "Review and send for approval", href: dashLink("reporter", rec.id) };
    const from = by || effective(rec);
    const quote = `<div style="margin:0 0 16px;padding:10px 14px;border-left:4px solid #f59e0b;background:#fffbeb;font-size:14px;white-space:pre-wrap">${esc(note)}</div>`;
    const html = shell("Please review your defect", `Hi ${esc(name)}, <b>${esc(from)}</b> reviewed your defect and sent it back with a comment. Please correct it (you can edit the fields and add documents on the dashboard), then click <b>Send for approval</b>.`,
      quote + table([rec], () => cta.href), cta, "You receive this because you are the reporter of this defect. It stays in the Reporter Review tab until you send it for approval again.");
    const text = `Hi ${name},\n\n${from} reviewed your defect and sent it back with a comment:\n\n"${note}"\n\n${plainRows([rec], () => cta.href)}\n\nCorrect it on the dashboard and click "Send for approval": ${cta.href}`;
    return { subject: `Action needed - please review: ${rec.Summary.slice(0, 80)}`, html, text, event: "returned", recordIds: [rec.id] };
  }).catch((e) => { log("ERROR", `Return-to-reporter notification failed: ${(e as Error).message}`); }));
}

/** 5. Reporter sends the defect for approval again: mail the SAME assignee, with the reporter's optional comment. */
export function notifyResubmitted(rec: DefectRecord, note: string, by: string): Promise<void> {
  if (!getConfig().mail.onReview) return Promise.resolve();
  return track(send(effective(rec), rec.ProjectKey, (name) => {
    const tab = tabOf(rec);
    const cta = { label: "Review and approve", href: dashLink(tab, rec.id) };
    const from = by || rec.ReporterEmail;
    const quote = note ? `<div style="margin:0 0 16px;padding:10px 14px;border-left:4px solid #3b82f6;background:#eff6ff;font-size:14px;white-space:pre-wrap">${esc(note)}</div>` : "";
    const html = shell("Defect sent for approval again", `Hi ${esc(name)}, <b>${esc(from)}</b> reviewed the defect you returned and sent it for approval again.${note ? " Their comment:" : ""}`,
      quote + table([rec], () => cta.href), cta, "You receive this because you are the assignee of this defect.");
    const text = `Hi ${name},\n\n${from} reviewed the defect you returned and sent it for approval again.${note ? `\nComment: "${note}"` : ""}\n\n${plainRows([rec], () => cta.href)}\n\nOpen the dashboard: ${cta.href}`;
    return { subject: `Back for approval: ${rec.Summary.slice(0, 80)}`, html, text, event: "resubmitted", recordIds: [rec.id] };
  }).catch((e) => { log("ERROR", `Resubmit notification failed: ${(e as Error).message}`); }));
}

/** Sign-in link (see auth.ts). The link is NOT stored in the audit trail. */
export async function sendLoginMail(to: string, link: string, minutes: number): Promise<void> {
  if (!emailEnabled()) throw new Error("E-mail (SMTP_HOST) is not configured, so sign-in links cannot be sent");
  const cta = { label: "Sign in to the Defect Hub", href: link };
  const e = await deliver({ to, subject: "Your smartShift Defect Hub sign-in link", event: "login",
    text: `Use this link to sign in to the smartShift Defect Hub (valid for ${minutes} minutes):\n${link}\n\nIf you did not ask for it, ignore this mail.`,
    html: shell("Sign in", `Click the button to sign in. The link works for ${minutes} minutes. If you did not ask for it, you can ignore this mail.`, "", cta, "Never forward this mail: the link signs in as you.") });
  if (!e.delivered) throw new Error(e.error || "Delivery failed");
}

/* ------------------------------------------------------------------ e-mail status per defect (dashboard column) */
const EVENT_LABEL: Record<string, string> = { upload: "Approval request", reassign: "Reassigned", approve: "Jira ticket created", cancelled: "Entry cancelled", engineering: "Sent to product engineering", returned: "Returned to reporter", resubmitted: "Sent for approval again" };
/** Latest notification per defect id (null = nothing sent yet). */
export function mailStatusIndex(): Map<string, MailStatus> {
  const idx = new Map<string, MailStatus>();
  for (const n of getDb().notifications) {                    // oldest -> newest, so the last write wins
    for (const id of n.recordIds ?? []) idx.set(id, { event: n.event ?? "", label: EVENT_LABEL[n.event ?? ""] ?? (n.event || "E-mail"), to: n.to, at: n.at, delivered: n.delivered, error: n.error, channel: n.channel });
  }
  return idx;
}

/** Manual check used by POST /api/notify/test. */
export async function sendTestMail(to: string): Promise<NotificationEntry> {
  if (!emailEnabled()) throw new Error("SMTP_HOST is not set");
  if (!isEmail(to)) throw new Error("A valid recipient e-mail is required");
  const cta = { label: "Open the dashboard", href: dashLink("pending") };
  const e = await deliver({ to, subject: "smartShift Defect Hub - test e-mail", event: "test", text: `This is a test e-mail from the smartShift Defect Hub.\nDashboard: ${cta.href}`,
    html: shell("Test e-mail", "If you can read this, SMTP is configured correctly and the Hub can notify assignees.", "", cta, "Sent from the Hub's SMTP settings.") });
  if (!e.delivered) throw new Error(e.error || "Delivery failed");
  return e;
}

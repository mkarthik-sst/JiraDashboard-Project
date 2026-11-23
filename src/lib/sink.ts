/**
 * Built-in test mailbox. When SMTP_HOST is this computer (127.0.0.1 / localhost) the Hub starts its own small SMTP server on
 * SMTP_PORT at launch and saves every mail it receives as an .html file in MAIL_SINK_DIR (default ./mail-sink).
 * No separate "node scripts/smtp-sink.mjs" window is needed. Nothing is delivered to real inboxes.
 * Off with SMTP_BUILTIN_SINK=false. If something already listens on the port (e.g. the old script), the Hub just uses that.
 */
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";

const LOCAL = /^(127\.0\.0\.1|localhost|::1)$/i;
type G = typeof globalThis & { __ccSink?: { port: number; dir: string; close?: () => void } | null; __ccSinkStarting?: boolean };

export const sinkDir = () => path.resolve(process.env.MAIL_SINK_DIR || "./mail-sink");
export const sinkWanted = () => LOCAL.test((process.env.SMTP_HOST ?? "").trim()) && process.env.SMTP_BUILTIN_SINK !== "false";
export const sinkActive = () => !!(globalThis as G).__ccSink;
export const loopbackHost = (h: string) => LOCAL.test(h.trim());

export interface SinkMail { file: string; to: string; subject: string; at: string }

export function listSinkMails(dir = sinkDir()): SinkMail[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".html")).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    const head = fs.readFileSync(path.join(dir, f), "utf8").slice(0, 600);
    const m = /<!-- To: (.*?) \| Subject: (.*?) -->/.exec(head);
    return { file: f, to: m?.[1] ?? "", subject: m?.[2] ?? f, at: st.mtime.toISOString() };
  }).sort((a, b) => b.at.localeCompare(a.at));
}

export async function startSink(opts: { port?: number; dir?: string; force?: boolean } = {}): Promise<boolean> {
  const g = globalThis as G;
  if (g.__ccSink || g.__ccSinkStarting) return !!g.__ccSink;
  if (!opts.force && !sinkWanted()) return false;
  const port = opts.port ?? (Number(process.env.SMTP_PORT) || 1025), dir = opts.dir ?? sinkDir();
  g.__ccSinkStarting = true;
  try {
    const { SMTPServer } = await import("smtp-server");
    const { simpleParser } = await import("mailparser");
    fs.mkdirSync(dir, { recursive: true });
    let n = fs.readdirSync(dir).filter((f) => f.endsWith(".html")).length;
    const srv = new SMTPServer({
      authOptional: true, disabledCommands: ["STARTTLS"],
      onAuth(_a, _s, cb) { cb(null, { user: "test" }); },
      onData(stream, session, cb) {
        simpleParser(stream).then((m) => {
          const to = session.envelope.rcptTo.map((r) => r.address).join(", ");
          const subject = (m.subject || "mail").replace(/[\r\n]+/g, " ");
          const f = path.join(dir, `${String(++n).padStart(3, "0")}_${subject.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 50)}.html`);
          fs.writeFileSync(f, `<!-- To: ${to} | Subject: ${subject} -->\n${m.html || `<pre>${m.text}</pre>`}`);
          log("INFO", `Test mailbox: saved mail #${n} to ${to}: ${subject}`);
          cb();
        }, cb);
      },
    });
    await new Promise<void>((resolve, reject) => { srv.once("error", reject); srv.listen(port, "127.0.0.1", () => resolve()); });
    srv.on("error", (e) => log("ERROR", `Test mailbox error: ${(e as Error).message}`));
    g.__ccSink = { port, dir, close: () => srv.close() };
    log("INFO", `Built-in test mailbox listening on 127.0.0.1:${port}; mails are saved in ${dir} (open /api/mail-sink in the browser).`);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE") log("INFO", `Port ${port} is already in use - assuming a mail catcher is already running there; using it.`);
    else log("ERROR", `Could not start the built-in test mailbox: ${err.message}`);
    return false;
  } finally { g.__ccSinkStarting = false; }
}

/** Tests only. */
export function stopSink() { const g = globalThis as G; g.__ccSink?.close?.(); g.__ccSink = null; }

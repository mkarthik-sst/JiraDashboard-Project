// Local "mail catcher" for trying the e-mail notifications WITHOUT a real mail server.
//   node scripts/smtp-sink.mjs [port] [dir]     then in .env.local:  SMTP_HOST=127.0.0.1  SMTP_PORT=1025  SMTP_IGNORE_TLS=true
// Every mail the Hub sends is saved as an .html file in <dir> (default ./mail-sink) - open it in a browser.
import { SMTPServer } from "smtp-server"; import { simpleParser } from "mailparser"; import fs from "node:fs"; import path from "node:path";
const port = Number(process.argv[2] || 1025), dir = path.resolve(process.argv[3] || "./mail-sink");
fs.mkdirSync(dir, { recursive: true }); let n = 0;
new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, session, cb) {
  simpleParser(stream).then((m) => {
    const to = session.envelope.rcptTo.map((r) => r.address).join(", ");
    const f = path.join(dir, `${String(++n).padStart(3, "0")}_${(m.subject || "mail").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 50)}.html`);
    fs.writeFileSync(f, `<!-- To: ${to} | Subject: ${m.subject} -->\n${m.html || `<pre>${m.text}</pre>`}`);
    console.log(`mail #${n} to ${to}: ${m.subject}  ->  ${f}`); cb();
  }, cb);
} }).listen(port, "127.0.0.1", () => console.log(`SMTP sink listening on 127.0.0.1:${port}, saving mails to ${dir}`));

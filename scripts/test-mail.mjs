// Tests the SMTP settings in .env.local WITHOUT starting the Hub.   Usage:  npm run test-mail -- you@company.com
// Step 1 reaches the server, step 2 logs in, step 3 sends a real mail. Prints plain-English hints. Never prints the password.
import { readFileSync, existsSync } from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url); const nodemailer = require("nodemailer");
const env = { ...process.env };
if (existsSync(".env.local")) for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const to = process.argv[2] || env.SMTP_USER; const host = env.SMTP_HOST, port = Number(env.SMTP_PORT || 587);
if (!host) { console.log("FAIL: SMTP_HOST is empty in .env.local"); process.exit(1); }
if (!to) { console.log("FAIL: give a recipient:  npm run test-mail -- you@company.com"); process.exit(1); }
const secure = /^true$/i.test(env.SMTP_SECURE || "");
console.log(`Settings: host=${host} port=${port} secure=${secure} user=${env.SMTP_USER || "(none)"} password=${env.SMTP_PASSWORD ? "set (" + env.SMTP_PASSWORD.length + " chars)" : "NOT SET"}`);
if (/smtp\.gmail\.com/i.test(host) && env.SMTP_PASSWORD && env.SMTP_PASSWORD.length !== 16) console.log("HINT: a Gmail app password is exactly 16 characters, with no spaces. Yours is " + env.SMTP_PASSWORD.length + ".");
if (port === 587 && secure) console.log("HINT: port 587 normally needs SMTP_SECURE=false.");
if (port === 465 && !secure) console.log("HINT: port 465 normally needs SMTP_SECURE=true.");
const tx = nodemailer.createTransport({ host, port, secure, ignoreTLS: /^true$/i.test(env.SMTP_IGNORE_TLS || ""), auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
function why(e) { const m = `${e.code || ""} ${e.responseCode || ""} ${e.message}`;
  if (/535|534|Invalid login|Username and Password not accepted|BadCredentials/i.test(m)) return "Login refused. Wrong user or password. For Gmail use a 16-character APP password (2-Step Verification must be on), and SMTP_USER must be the same account.";
  if (/5\.7\.57|SmtpClientAuthentication|disabled/i.test(m)) return "Microsoft 365: Authenticated SMTP is switched off for this mailbox. Ask IT to enable it.";
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ESOCKET|EDNS/i.test(m)) return "Cannot reach the server. Check SMTP_HOST spelling, the port, and that your network/firewall allows it. Try port 465 with SMTP_SECURE=true.";
  if (/Greeting never received|wrong version number|ssl/i.test(m)) return "Security setting does not match the port. Port 587 = SMTP_SECURE=false, port 465 = SMTP_SECURE=true.";
  if (/553|550|sender|from/i.test(m)) return "The sender address was refused. Use the mailbox's own address in SMTP_FROM."; return "See the message above."; }
try { await tx.verify(); console.log("STEP 1+2 OK: server reached and login accepted."); } catch (e) { console.log("STEP 1/2 FAILED: " + e.message + "\n=> " + why(e)); process.exit(1); }
try { const r = await tx.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to, subject: "smartShift Defect Hub - SMTP test", text: "If you can read this, your SMTP settings work." });
  console.log("STEP 3 OK: mail sent to " + to + " (server said: " + String(r.response).slice(0, 80) + "). Check Inbox and Junk."); } catch (e) { console.log("STEP 3 FAILED: " + e.message + "\n=> " + why(e)); process.exit(1); }

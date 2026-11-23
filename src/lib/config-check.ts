/** Start-up / dashboard hints for settings that silently do nothing (the most common cause: values saved in the wrong file name). */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import { authMode } from "./auth";

export interface ConfigWarning { level: "error" | "warn"; text: string }

export function configWarnings(): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  const c = getConfig();
  const here = process.cwd();
  const has = (f: string) => { try { return fs.existsSync(path.join(here, f)); } catch { return false; } };
  if (!has(".env.local") && !process.env.SMTP_HOST && !process.env.GDRIVE_FOLDER_ID && !process.env.AUTH_MODE) {
    const wrong = [".env.local.sample", ".env.example", ".env.local.txt", "env.local", ".env.local.sample.txt"].filter(has);
    out.push({ level: "error", text: `No .env.local file was found in ${here}. The Hub reads settings ONLY from a file named exactly ".env.local"${wrong.length ? ` - rename ${wrong[0]} to .env.local` : " - copy .env.local.sample to .env.local"}, then restart the Hub. Until then sign-in, e-mail, Google Drive and Jira run with defaults (sign-in off, e-mail off, Drive off, Jira mock).` });
    return out;
  }
  if (authMode() === "none") out.push({ level: "warn", text: "Sign-in is OFF (AUTH_MODE=none). Set AUTH_MODE=email, AUTH_SECRET and SMTP settings in .env.local for the sign-in page." });
  if (c.sync.mode === "none" && (c.sync.gdriveFolderId || process.env.GDRIVE_KEY_FILE)) out.push({ level: "error", text: "Google Drive settings are present but SYNC_MODE is not 'gdrive'. Set SYNC_MODE=gdrive in .env.local." });
  if (c.sync.mode === "gdrive" && c.sync.gdriveKeyFile && !fs.existsSync(path.resolve(here, c.sync.gdriveKeyFile))) out.push({ level: "error", text: `GDRIVE_KEY_FILE points to a file that does not exist: ${c.sync.gdriveKeyFile}. Save the service-account JSON key there (relative to ${here}).` });
  if (!c.mail.host) out.push({ level: "warn", text: "E-mail is OFF: SMTP_HOST is empty in .env.local, so no notification (or sign-in link) can be sent." });
  if (/\s|=/.test((process.env.OPEN_DRIVE_USERS ?? "").trim())) out.push({ level: "warn", text: `OPEN_DRIVE_USERS has an unusual value ("${process.env.OPEN_DRIVE_USERS}"). Use * for everybody or a comma-separated list of e-mail addresses.` });
  if (c.jira.mode === "mock") out.push({ level: "warn", text: "Jira is in MOCK mode (JIRA_BASE_URL empty): tickets are simulated, nothing is created in Jira." });
  return out;
}

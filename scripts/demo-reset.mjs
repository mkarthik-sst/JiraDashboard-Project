// DEMO ONLY: wipes what the dashboard shows, locally and in Google Drive, so you can start a demo from a clean screen.
//   1. Stop the Hub (Ctrl+C in its window).   2. npm run demo-reset   3. npm start
//   npm run demo-reset -- --yes      skip the question          npm run demo-reset -- --local   do NOT touch Google Drive
// Local: deletes ./data and ./mail-sink.  Drive: moves the Hub's own folders (uploads, tracking, attachments, master, state) inside GDRIVE_FOLDER_ID to the
// Google Drive TRASH (recoverable for 30 days; other files in your folder are left alone). The Drive step is needed because the Hub restores
// an empty machine from Drive (state/store.json) - clearing only the PC would bring the old entries back.
import { readFileSync, existsSync, rmSync } from "node:fs"; import crypto from "node:crypto"; import path from "node:path"; import readline from "node:readline/promises"; import net from "node:net";
const args = process.argv.slice(2), localOnly = args.includes("--local"), yes = args.includes("--yes");
const env = { ...process.env };
if (existsSync(".env.local")) for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const bad = (m) => { console.log("FAIL: " + m); process.exit(1); };
const port = Number(env.PORT || 3000);
const running = await new Promise((r) => { const s = net.connect(port, "127.0.0.1"); s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); });
if (running) bad(`The Hub looks like it is still running on port ${port}. Stop it first (Ctrl+C in its window), then run this again.`);
const useDrive = !localOnly && (env.SYNC_MODE || "none") === "gdrive";
console.log("This will clear the demo data:\n  - this PC: ./data and ./mail-sink");
console.log(useDrive ? "  - Google Drive: the Hub's folders (uploads, tracking, attachments, master, state) go to the Drive Trash" : "  - Google Drive: NOT touched" + (localOnly ? " (--local)" : " (SYNC_MODE is not gdrive)"));
if (!yes) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const a = (await rl.question("Type YES to continue: ")).trim(); rl.close(); if (a !== "YES") { console.log("Cancelled. Nothing was changed."); process.exit(0); } }

if (useDrive) {
  const folder = (env.GDRIVE_FOLDER_ID || "").trim().replace(/^.*\/folders\/([\w-]+).*$/, "$1");
  if (!folder) bad("GDRIVE_FOLDER_ID is empty in .env.local.");
  const api = (env.GDRIVE_API_URL || "https://www.googleapis.com/drive/v3").replace(/\/+$/, ""), tokenUrl = env.GDRIVE_TOKEN_URL || "https://oauth2.googleapis.com/token";
  const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = new URLSearchParams();
  if (env.GDRIVE_OAUTH_CLIENT_ID && env.GDRIVE_OAUTH_CLIENT_SECRET && env.GDRIVE_OAUTH_REFRESH_TOKEN) { body.set("grant_type", "refresh_token"); body.set("client_id", env.GDRIVE_OAUTH_CLIENT_ID); body.set("client_secret", env.GDRIVE_OAUTH_CLIENT_SECRET); body.set("refresh_token", env.GDRIVE_OAUTH_REFRESH_TOKEN); }
  else {
    let raw = (env.GDRIVE_SERVICE_ACCOUNT_JSON || "").trim(); if (raw && !raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
    if (!raw && env.GDRIVE_KEY_FILE) { const f = path.resolve(env.GDRIVE_KEY_FILE); if (!existsSync(f)) bad(`GDRIVE_KEY_FILE not found: ${f}`); raw = readFileSync(f, "utf8"); }
    if (!raw) bad("No Google sign-in set in .env.local (service-account key or OAuth refresh token). Nothing was deleted. Use --local to clear only this PC.");
    let k; try { k = JSON.parse(raw); } catch { bad("The service-account key is not valid JSON."); }
    const now = Math.floor(Date.now() / 1000), head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" })), claim = b64u(JSON.stringify({ iss: k.client_email, scope: "https://www.googleapis.com/auth/drive", aud: tokenUrl, iat: now, exp: now + 3300 }));
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"); body.set("assertion", `${head}.${claim}.${b64u(crypto.sign("RSA-SHA256", Buffer.from(`${head}.${claim}`), k.private_key))}`);
  }
  let r = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }).catch((e) => bad("Cannot reach Google: " + e.message));
  let t = await r.text(); if (!r.ok) bad(`Google refused the sign-in (${r.status}). Nothing was deleted. ${t.slice(0, 160)}`);
  const h = { Authorization: `Bearer ${JSON.parse(t).access_token}`, "Content-Type": "application/json" };
  const flags = "supportsAllDrives=true&includeItemsFromAllDrives=true";
  const ours = ["uploads", "tracking", "attachments", "master", "state"]; let n = 0;
  for (const name of ours) {
    const q = `name='${name}' and '${folder}' in parents and trashed=false`;
    r = await fetch(`${api}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&${flags}`, { headers: h }); t = await r.text();
    if (!r.ok) bad(`Could not read the Drive folder (${r.status}). Nothing more was deleted. ${t.slice(0, 160)}`);
    for (const f of JSON.parse(t).files || []) {
      r = await fetch(`${api}/files/${f.id}?${flags}`, { method: "PATCH", headers: h, body: JSON.stringify({ trashed: true }) }); t = await r.text();
      if (!r.ok) bad(`Could not move "${name}" to the Drive Trash (${r.status}). ` + (r.status === 403 ? "Your Google account needs Editor/Content-manager rights on the folder; or delete the folder contents by hand in Drive. " : "") + t.slice(0, 160));
      console.log(`Drive: moved "${name}" to the Trash`); n++;
    }
  }
  if (!n) console.log("Drive: nothing of the Hub found in the folder (already clean).");
}
rmSync("./data", { recursive: true, force: true }); rmSync("./mail-sink", { recursive: true, force: true }); console.log("PC: cleared ./data and ./mail-sink");
console.log("\nDone. Start the Hub again with:  npm start   (the dashboard will be empty)");

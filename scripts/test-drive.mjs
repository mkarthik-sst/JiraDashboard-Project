// Tests the Google Drive settings in .env.local WITHOUT starting the Hub.   Usage:  npm run test-drive
// Step 1 signs in to Google, step 2 opens the shared folder, step 3 writes one small test file into it. Plain-English hints. Never prints secrets.
import { readFileSync, existsSync } from "node:fs"; import crypto from "node:crypto"; import path from "node:path";
const env = { ...process.env };
if (existsSync(".env.local")) for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const bad = (msg) => { console.log("FAIL: " + msg); process.exit(1); }, ok = (msg) => console.log("OK:   " + msg);
if ((env.SYNC_MODE || "none") !== "gdrive") console.log(`NOTE: SYNC_MODE is "${env.SYNC_MODE || "none"}" in .env.local. Set SYNC_MODE=gdrive so the Hub uses Google Drive. Testing the Drive settings anyway.`);
const folder = (env.GDRIVE_FOLDER_ID || "").trim().replace(/^.*\/folders\/([\w-]+).*$/, "$1");
if (!folder) bad("GDRIVE_FOLDER_ID is empty. Open the folder in Google Drive and copy the last part of its web address.");
const api = (env.GDRIVE_API_URL || "https://www.googleapis.com/drive/v3").replace(/\/+$/, ""), up = (env.GDRIVE_UPLOAD_URL || "https://www.googleapis.com/upload/drive/v3").replace(/\/+$/, ""), tokenUrl = env.GDRIVE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const oauth = env.GDRIVE_OAUTH_CLIENT_ID && env.GDRIVE_OAUTH_CLIENT_SECRET && env.GDRIVE_OAUTH_REFRESH_TOKEN;
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let account = "";
const body = new URLSearchParams();
if (oauth) { console.log("Sign-in: your own Google account (OAuth refresh token)"); body.set("grant_type", "refresh_token"); body.set("client_id", env.GDRIVE_OAUTH_CLIENT_ID); body.set("client_secret", env.GDRIVE_OAUTH_CLIENT_SECRET); body.set("refresh_token", env.GDRIVE_OAUTH_REFRESH_TOKEN); }
else {
  let raw = (env.GDRIVE_SERVICE_ACCOUNT_JSON || "").trim(); if (raw && !raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
  if (!raw && env.GDRIVE_KEY_FILE) { const f = path.resolve(env.GDRIVE_KEY_FILE); if (!existsSync(f)) bad(`GDRIVE_KEY_FILE not found: ${f}. Put the downloaded JSON key there (or fix the path).`); raw = readFileSync(f, "utf8"); }
  if (!raw) bad("No Google sign-in set. Fill GDRIVE_KEY_FILE (service account) OR GDRIVE_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN.");
  let k; try { k = JSON.parse(raw); } catch { bad("The service-account key is not valid JSON. Download the JSON key from Google Cloud again."); }
  if (!k.client_email || !k.private_key) bad("The key JSON has no client_email / private_key. Use a key of type service_account.");
  account = k.client_email; console.log(`Sign-in: service account ${account}`);
  const now = Math.floor(Date.now() / 1000), head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" })), claim = b64u(JSON.stringify({ iss: k.client_email, scope: "https://www.googleapis.com/auth/drive", aud: tokenUrl, iat: now, exp: now + 3300 }));
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"); body.set("assertion", `${head}.${claim}.${b64u(crypto.sign("RSA-SHA256", Buffer.from(`${head}.${claim}`), k.private_key))}`);
}
let r = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }).catch((e) => bad("Cannot reach Google (" + e.message + "). Check the internet / proxy / firewall."));
let t = await r.text(); if (!r.ok) bad(`Google refused the sign-in (${r.status}). ` + (/invalid_grant/.test(t) ? (oauth ? "The refresh token is revoked or expired: create a new one." : "Check the PC clock and that the key was not deleted in Google Cloud.") : /invalid_client|unauthorized_client/.test(t) ? "Client id/secret wrong." : "") + " " + t.slice(0, 160));
const token = JSON.parse(t).access_token; ok("signed in to Google");
const h = { Authorization: `Bearer ${token}` };
r = await fetch(`${api}/files/${encodeURIComponent(folder)}?fields=${encodeURIComponent("id,name,mimeType,capabilities(canAddChildren)")}&supportsAllDrives=true`, { headers: h }); t = await r.text();
if (!r.ok) bad(`Cannot open the folder (${r.status}). ` + (r.status === 404 ? `Either GDRIVE_FOLDER_ID is wrong or the folder is not shared with ${account || "your Google account"}. ${account ? "Share the folder with " + account + " as Editor." : ""}` : /accessNotConfigured|has not been used/.test(t) ? "The Google Drive API is not enabled in your Google Cloud project: APIs & Services > Library > Google Drive API > Enable." : "") + " " + t.slice(0, 160));
const f = JSON.parse(t); if (f.mimeType !== "application/vnd.google-apps.folder") bad(`GDRIVE_FOLDER_ID points to the file "${f.name}", not a folder.`);
ok(`folder found: "${f.name}"`); if (f.capabilities?.canAddChildren === false) bad(`The signed-in account can read "${f.name}" but not add files: share it as Editor.`);
const name = "connection-test.txt", q = `name='${name}' and '${folder}' in parents and trashed=false`;
const ex = (await (await fetch(`${api}/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: h })).json()).files?.[0];
const txt = Buffer.from(`Defect Hub Drive test ${new Date().toISOString()}\n`);
if (ex) r = await fetch(`${up}/files/${ex.id}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { ...h, "Content-Type": "text/plain" }, body: txt });
else { const bd = "sdhtest"; const pre = Buffer.from(`--${bd}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${bd}\r\nContent-Type: text/plain\r\n\r\n`); r = await fetch(`${up}/files?uploadType=multipart&supportsAllDrives=true`, { method: "POST", headers: { ...h, "Content-Type": `multipart/related; boundary=${bd}` }, body: Buffer.concat([pre, txt, Buffer.from(`\r\n--${bd}--`)]) }); }
t = await r.text();
if (!r.ok) bad(`Could not write a file (${r.status}). ` + (/storageQuotaExceeded|storage quota/i.test(t) ? "A service account has no storage of its own. Use a SHARED DRIVE (add the service account as a member) or switch to the OAuth refresh-token sign-in." : r.status === 403 ? "No permission to add files here: share the folder as Editor." : "") + " " + t.slice(0, 160));
ok(`wrote ${name} into "${f.name}"`); console.log("\nAll good. Google Drive storage will work. Start the Hub with:  npm start");

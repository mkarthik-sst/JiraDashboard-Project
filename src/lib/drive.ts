/**
 * Minimal Google Drive v3 client (plain REST, no extra npm package) used for the Google Drive storage mode.
 *
 * Two ways to sign in (set ONE in .env.local):
 *   1. Service account  (GDRIVE_KEY_FILE or GDRIVE_SERVICE_ACCOUNT_JSON): best for a Shared Drive. Share the folder / Shared Drive with
 *      the service account's e-mail address as Editor (Content manager on a Shared Drive).
 *   2. OAuth refresh token (GDRIVE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN): files are owned by a real user, so an ordinary
 *      "My Drive" shared folder works. (A service account has no storage quota of its own and cannot own files in My Drive.)
 * Everything lives under GDRIVE_FOLDER_ID (the shared folder). Writes are serialised through one queue.
 * GDRIVE_API_URL / GDRIVE_UPLOAD_URL / GDRIVE_TOKEN_URL can point at an emulator (tests).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import { getDb } from "./store";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export const driveEnabled = () => { const c = getConfig().sync; return c.mode === "gdrive" && !!c.gdriveFolderId && driveAuthKind() !== "none"; };
export function driveAuthKind(): "service-account" | "oauth" | "none" {
  const c = getConfig().sync;
  if (c.gdriveClientId && c.gdriveClientSecret && c.gdriveRefreshToken) return "oauth";
  if (c.gdriveKeyFile || c.gdriveKeyJson) return "service-account";
  return "none";
}
export const driveFolderUrl = () => { const c = getConfig().sync; return c.gdriveFolderId ? `${c.gdriveWebUrl}/drive/folders/${c.gdriveFolderId}` : ""; };
/** Browser link of a file once it has been copied to Drive (empty until then). */
export function driveLinkOf(drivePath: string): string {
  try { return getDb().driveLinks?.[drivePath] ?? ""; } catch { return ""; }
}

interface ServiceKey { client_email: string; private_key: string; token_uri?: string }
export function readServiceKey(): ServiceKey {
  const c = getConfig().sync;
  let raw = c.gdriveKeyJson.trim();
  if (raw && !raw.startsWith("{")) { try { raw = Buffer.from(raw, "base64").toString("utf8"); } catch { /* handled below */ } }
  if (!raw && c.gdriveKeyFile) {
    try { raw = fs.readFileSync(path.resolve(c.gdriveKeyFile), "utf8"); }
    catch (e) { throw new Error(`GDRIVE_KEY_FILE could not be read (${path.resolve(c.gdriveKeyFile)}): ${(e as Error).message}`); }
  }
  let k: Partial<ServiceKey>;
  try { k = JSON.parse(raw) as Partial<ServiceKey>; } catch { throw new Error("The service-account key is not valid JSON. Download the JSON key from Google Cloud again."); }
  if (!k.client_email || !k.private_key) throw new Error("The service-account key JSON has no client_email / private_key. Use the key file downloaded from Google Cloud (type: service_account).");
  return k as ServiceKey;
}
/** E-mail address to share the Drive folder with (service-account mode). Empty in OAuth mode. */
export function serviceAccountEmail(): string { try { return driveAuthKind() === "service-account" ? readServiceKey().client_email : ""; } catch { return ""; } }

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let tok: { value: string; exp: number; kind: string } | null = null;
export function resetDriveAuthCache() { tok = null; folderCache.clear(); }

async function accessToken(): Promise<string> {
  const c = getConfig().sync, kind = driveAuthKind();
  if (kind === "none") throw new Error("Google Drive sign-in is not configured: set GDRIVE_KEY_FILE (service account) or GDRIVE_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN.");
  if (tok && tok.kind === kind && tok.exp - 60_000 > Date.now()) return tok.value;
  const body = new URLSearchParams();
  if (kind === "oauth") {
    body.set("grant_type", "refresh_token"); body.set("client_id", c.gdriveClientId); body.set("client_secret", c.gdriveClientSecret); body.set("refresh_token", c.gdriveRefreshToken);
  } else {
    const k = readServiceKey(), now = Math.floor(Date.now() / 1000);
    const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64u(JSON.stringify({ iss: k.client_email, scope: "https://www.googleapis.com/auth/drive", aud: c.gdriveTokenUrl, iat: now, exp: now + 3300 }));
    const sig = b64u(crypto.sign("RSA-SHA256", Buffer.from(`${head}.${claim}`), k.private_key));
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"); body.set("assertion", `${head}.${claim}.${sig}`);
  }
  const res = await fetch(c.gdriveTokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20000) });
  const txt = await res.text();
  if (!res.ok) {
    const hint = /invalid_grant/.test(txt) ? (kind === "oauth" ? " (the refresh token was revoked or expired: create a new one)" : " (check the server clock and that the key has not been deleted)")
      : /invalid_client|unauthorized_client/.test(txt) ? " (client id / secret wrong, or the Google Drive API is not enabled for that project)" : "";
    throw new Error(`Google sign-in failed (${res.status})${hint}: ${txt.slice(0, 200)}`);
  }
  const j = JSON.parse(txt) as { access_token: string; expires_in?: number };
  tok = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000, kind };
  return tok.value;
}

async function drive(url: string, init: RequestInit = {}, timeout = 30000): Promise<Response> {
  const t = await accessToken();
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
}
async function fail(what: string, res: Response): Promise<never> {
  const txt = (await res.text()).slice(0, 300);
  const hint = res.status === 401 ? " (sign-in rejected)"
    : /storageQuotaExceeded|do not have storage quota/i.test(txt) ? " (a service account has no storage of its own: put the folder in a Shared Drive and add the service account as a member, or use the OAuth refresh-token sign-in)"
    : res.status === 403 ? " (the signed-in Google account may not write to this folder, or the Drive API is not enabled, or a rate limit was hit)"
    : res.status === 404 ? " (folder not found, or it is not shared with the Hub's Google account: share GDRIVE_FOLDER_ID as Editor)" : "";
  throw new Error(`Google Drive ${what} -> ${res.status}${hint}: ${txt}`);
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const folderCache = new Map<string, string>();     // "uploads/2026-10-30" -> folder id

let chain: Promise<unknown> = Promise.resolve();
/** Run Drive writes strictly one after another (avoids duplicate folders / files created by parallel requests). */
export function driveSerial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

interface Item { id: string; name: string; webViewLink?: string; mimeType?: string }
async function findChildren(parent: string, name: string, folder?: boolean): Promise<Item[]> {
  const c = getConfig().sync;
  const query = `name='${q(name)}' and '${parent}' in parents and trashed=false${folder === true ? ` and mimeType='${FOLDER_MIME}'` : folder === false ? ` and mimeType!='${FOLDER_MIME}'` : ""}`;
  const url = `${c.gdriveApiUrl}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent("files(id,name,webViewLink,mimeType)")}&orderBy=createdTime&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await drive(url);
  if (!res.ok) await fail(`list "${name}"`, res);
  return ((await res.json()) as { files?: Item[] }).files ?? [];
}
async function findChild(parent: string, name: string, folder?: boolean): Promise<Item | undefined> { return (await findChildren(parent, name, folder))[0]; }
async function ensureFolder(parts: string[]): Promise<string> {
  const c = getConfig().sync;
  let parent = c.gdriveFolderId, acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    const cached = folderCache.get(acc);
    if (cached) { parent = cached; continue; }
    let f = await findChild(parent, part, true);
    if (!f) {
      const res = await drive(`${c.gdriveApiUrl}/files?supportsAllDrives=true&fields=id,name`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: part, mimeType: FOLDER_MIME, parents: [parent] }) });
      if (!res.ok) await fail(`create folder "${part}"`, res);
      f = (await res.json()) as Item;
    }
    folderCache.set(acc, f.id); parent = f.id;
  }
  return parent;
}
const split = (p: string) => { const parts = p.split("/").filter(Boolean); return { dir: parts.slice(0, -1), name: parts[parts.length - 1] }; };

/** The shared folder itself: proves the id is right and the account can see it. Returns its name. */
export async function driveRootInfo(): Promise<{ name: string; canEdit: boolean }> {
  const c = getConfig().sync;
  const res = await drive(`${c.gdriveApiUrl}/files/${encodeURIComponent(c.gdriveFolderId)}?fields=${encodeURIComponent("id,name,mimeType,capabilities(canAddChildren)")}&supportsAllDrives=true`);
  if (!res.ok) await fail("open the shared folder", res);
  const j = (await res.json()) as { name: string; mimeType: string; capabilities?: { canAddChildren?: boolean } };
  if (j.mimeType !== FOLDER_MIME) throw new Error(`GDRIVE_FOLDER_ID points to "${j.name}", which is a file, not a folder.`);
  return { name: j.name, canEdit: j.capabilities?.canAddChildren !== false };
}

const MIME: Record<string, string> = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", json: "application/json", txt: "text/plain", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const mimeOf = (n: string) => MIME[(n.split(".").pop() ?? "").toLowerCase()] ?? "application/octet-stream";

/** Create or replace a file at a path under the shared folder (folders are created as needed). Returns its browser link. */
export function drivePut(drivePath: string, data: Buffer): Promise<string> {
  return driveSerial(async () => {
    const c = getConfig().sync;
    const { dir, name } = split(drivePath);
    const parent = await ensureFolder(dir);
    const mime = mimeOf(name);
    for (let attempt = 0; attempt < 3; attempt++) {
      let known = ""; try { known = getDb().driveIds?.[drivePath] ?? ""; } catch { /* store not ready */ }
      const found = known ? [] : await findChildren(parent, name, false);
      const existing = known ? { id: known } : found[0];
      let res: Response;
      if (existing) {
        res = await drive(`${c.gdriveUploadUrl}/files/${existing.id}?uploadType=media&supportsAllDrives=true&fields=id,webViewLink`, { method: "PATCH", headers: { "Content-Type": mime }, body: new Uint8Array(data) }, 120000);
        if (res.status === 404 && known) { try { delete getDb().driveIds[drivePath]; } catch { /* ignore */ } continue; }   // file was deleted in Drive: create it again
      } else {
        const boundary = `sdh${crypto.randomBytes(8).toString("hex")}`;
        const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
        const body = Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--`)]);
        res = await drive(`${c.gdriveUploadUrl}/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body) }, 120000);
      }
      if (res.ok) {
        const j = (await res.json()) as Item;
        const link = j.webViewLink || `${c.gdriveWebUrl}/file/d/${j.id}/view`;
        try { const d = getDb(); (d.driveLinks ??= {})[drivePath] = link; (d.driveIds ??= {})[drivePath] = j.id; } catch { /* store not ready */ }
        // earlier runs may have left same-name copies (Drive's search can lag): keep every copy up to date so no stale file is left behind
        for (const extra of found.slice(1)) { try { await drive(`${c.gdriveUploadUrl}/files/${extra.id}?uploadType=media&supportsAllDrives=true&fields=id`, { method: "PATCH", headers: { "Content-Type": mime }, body: new Uint8Array(data) }, 120000); } catch { /* best effort */ } }
        return link;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); continue; }
      await fail(`upload ${drivePath}`, res);
    }
    throw new Error(`Google Drive upload ${drivePath} failed`);
  });
}

/** Bytes of a file at a path, or null if it does not exist. */
export async function driveRaw(drivePath: string): Promise<Buffer | null> {
  const c = getConfig().sync;
  const { dir, name } = split(drivePath);
  let parent = c.gdriveFolderId;
  for (const part of dir) {
    const f = await findChild(parent, part, true);
    if (!f) return null;
    parent = f.id;
  }
  const file = await findChild(parent, name, false);
  if (!file) return null;
  const res = await drive(`${c.gdriveApiUrl}/files/${file.id}?alt=media&supportsAllDrives=true`, {}, 120000);
  if (res.status === 404) return null;
  if (!res.ok) await fail(`download ${drivePath}`, res);
  return Buffer.from(await res.arrayBuffer());
}

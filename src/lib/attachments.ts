/**
 * Attachment handling for the AttachmentPaths column.
 * Each pipe-separated entry may be:
 *   1. a FILE NAME uploaded together with the workbook          e.g.  st22_dump.png
 *   2. a PATH on the server (relative to ATTACHMENT_ROOT)        e.g.  ./attachments/images/st22_dump.png
 *   3. an http(s) LINK (Google Drive, SharePoint, Confluence, ...) e.g.  https://drive.google.com/file/d/<id>/view
 * Files (1 and 2) are copied into DATA_DIR/attachments/<uploadId>/ so every upload is self-contained, can be previewed from the
 * dashboard before approval, is copied to Google Drive, and is attached to the Jira ticket on approval.
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import { driveEnabled, driveLinkOf, driveRaw } from "./drive";
import type { AttachmentInfo } from "./schema";

const EXT: Record<string, { cat: AttachmentInfo["category"]; mime: string; inline?: boolean }> = {
  png: { cat: "image", mime: "image/png", inline: true }, jpg: { cat: "image", mime: "image/jpeg", inline: true },
  jpeg: { cat: "image", mime: "image/jpeg", inline: true }, gif: { cat: "image", mime: "image/gif", inline: true },
  webp: { cat: "image", mime: "image/webp", inline: true }, bmp: { cat: "image", mime: "image/bmp" },
  pdf: { cat: "pdf", mime: "application/pdf", inline: true },
  doc: { cat: "word", mime: "application/msword" }, docx: { cat: "word", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xls: { cat: "excel", mime: "application/vnd.ms-excel" }, xlsx: { cat: "excel", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  csv: { cat: "excel", mime: "text/csv" }, ppt: { cat: "powerpoint", mime: "application/vnd.ms-powerpoint" },
  pptx: { cat: "powerpoint", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  txt: { cat: "text", mime: "text/plain" }, log: { cat: "text", mime: "text/plain" }, json: { cat: "text", mime: "application/json" },
};
export const extOf = (n: string) => (n.split("?")[0].split(".").pop() ?? "").toLowerCase();
export const categoryFor = (n: string) => EXT[extOf(n)]?.cat ?? "other";
export const mimeFor = (n: string) => EXT[extOf(n)]?.mime ?? "application/octet-stream";
export const inlineOk = (n: string) => !!EXT[extOf(n)]?.inline;
export const isFileUrl = (u: string) => !!EXT[extOf(u)];

export function sanitizeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[^A-Za-z0-9._() \-]+/g, "_").replace(/^\.+/, "").trim();
  return (base || "file").slice(0, 120);
}
export const setDir = (setId: string) => path.join(getConfig().dataDir, "attachments", setId);
export const isSetId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

function uniqueName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 500; i++) { const n = `${stem}_${i}${ext}`; if (!fs.existsSync(path.join(dir, n))) return n; }
  return `${stem}_${Date.now()}${ext}`;
}

/** Save a file uploaded together with the workbook. Same name => overwritten (so sheet references stay valid). */
export function saveUploadedFile(setId: string, filename: string, data: Buffer): string {
  const dir = setDir(setId);
  fs.mkdirSync(dir, { recursive: true });
  const name = sanitizeName(filename);
  fs.writeFileSync(path.join(dir, name), data);
  return name;
}

/** Save a document added later to ONE record. Never overwrites: other records of the same upload may use the same name. */
export function saveAdditionalFile(setId: string, filename: string, data: Buffer): string {
  const dir = setDir(setId);
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, sanitizeName(filename));
  fs.writeFileSync(path.join(dir, name), data);
  return name;
}

const baseInfo = (raw: string, setId: string): AttachmentInfo => ({
  raw, name: raw, kind: "file", category: "other", exists: false, size: 0, setId, href: "", drivePath: "", driveUrl: "", note: "",
});

/** Resolve one AttachmentPaths cell into dashboard-ready attachment descriptors. */
export function resolveAttachments(cell: string, setId: string): AttachmentInfo[] {
  const out: AttachmentInfo[] = [];
  const dir = setDir(setId);
  const root = getConfig().jira.attachmentRoot;
  for (const raw of cell.split("|").map((s) => s.trim()).filter(Boolean)) {
    const a = baseInfo(raw, setId);
    if (/^https?:\/\//i.test(raw)) {
      let name = raw;
      try { name = decodeURIComponent(path.basename(new URL(raw).pathname)) || new URL(raw).host; } catch { /* keep raw */ }
      Object.assign(a, { kind: "url", name, category: isFileUrl(raw) ? categoryFor(name) : "link", exists: true, href: raw });
      out.push(a); continue;
    }
    // 1) uploaded with the workbook (match by file name)   2) server path under ATTACHMENT_ROOT
    const base = sanitizeName(raw);
    let src = "";
    if (fs.existsSync(path.join(dir, base))) src = path.join(dir, base);
    else {
      const abs = path.resolve(root, raw.replace(/\\/g, "/"));
      if ((abs === root || abs.startsWith(root + path.sep)) && fs.existsSync(abs) && fs.statSync(abs).isFile()) src = abs;
    }
    a.name = base; a.category = categoryFor(base);
    if (!src) { a.note = "file not found: upload it together with the workbook or place it under ATTACHMENT_ROOT"; out.push(a); continue; }
    const size = fs.statSync(src).size;
    if (size > getConfig().attachments.maxBytes) { a.note = `file larger than ${getConfig().attachments.maxBytes / 1048576} MB`; out.push(a); continue; }
    let finalName = base;
    if (path.dirname(src) !== dir) {          // copy a server-side file into the upload's own folder
      fs.mkdirSync(dir, { recursive: true });
      finalName = uniqueName(dir, base);
      fs.copyFileSync(src, path.join(dir, finalName));
    }
    a.name = finalName; a.exists = true; a.size = size;
    a.href = `/api/attachment?set=${setId}&name=${encodeURIComponent(finalName)}`;
    a.drivePath = `attachments/${setId}/${finalName}`;
    a.driveUrl = driveEnabled() ? driveLinkOf(a.drivePath) : "";
    out.push(a);
  }
  return out;
}

/** Bytes of a stored attachment: local copy first, Google Drive as fallback (e.g. after restoring on a new machine). */
export async function readStored(setId: string, name: string): Promise<Buffer | null> {
  if (!isSetId(setId) || name !== sanitizeName(name)) return null;
  const p = path.join(setDir(setId), name);
  if (fs.existsSync(p)) return fs.readFileSync(p);
  if (driveEnabled()) return driveRaw(`attachments/${setId}/${name}`).catch(() => null);
  return null;
}

// Local stand-in for the Google Drive v3 API + Google's token endpoint, to try the Google Drive storage mode WITHOUT a real Google account.
//   node scripts/drive-emulator.mjs [port] [dir]
// then in .env.local:  SYNC_MODE=gdrive  GDRIVE_FOLDER_ID=ROOT  GDRIVE_OAUTH_CLIENT_ID=x  GDRIVE_OAUTH_CLIENT_SECRET=x  GDRIVE_OAUTH_REFRESH_TOKEN=x
//                      GDRIVE_API_URL=http://127.0.0.1:<port>/drive/v3  GDRIVE_UPLOAD_URL=http://127.0.0.1:<port>/upload/drive/v3  GDRIVE_TOKEN_URL=http://127.0.0.1:<port>/token
// Files are also written to <dir>/<path in the folder> so you can open them. (Real Google behaviour can differ in details - always run "Test Google Drive" with real credentials.)
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const port = Number(process.argv[2] || 3198), dir = path.resolve(process.argv[3] || "./drive-emulator-data");
fs.mkdirSync(dir, { recursive: true });
const items = new Map([["ROOT", { id: "ROOT", name: "Defect Hub (emulated)", mime: "application/vnd.google-apps.folder", parent: null, data: null }]]);
const pathOf = (it) => (it.parent && it.parent !== "ROOT" ? pathOf(items.get(it.parent)) + "/" : "") + (it.id === "ROOT" ? "" : it.name);
const json = (res, c, o) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const view = (it) => ({ id: it.id, name: it.name, mimeType: it.mime, webViewLink: `https://drive.example/emulated/${it.id}` });
function persist(it) { if (it.data) { const f = path.join(dir, pathOf(it)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, it.data); } }
http.createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks), u = new URL(req.url, "http://x");
    if (u.pathname === "/token") return json(res, 200, { access_token: "emulated-token", expires_in: 3600 });
    if (req.headers.authorization !== "Bearer emulated-token") return json(res, 401, { error: { message: "no token" } });
    if (u.pathname === "/drive/v3/files" && req.method === "GET") {
      const q = u.searchParams.get("q") || ""; const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, "$1"); const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const wantFolder = /mimeType='application\/vnd.google-apps.folder'/.test(q), notFolder = /mimeType!='/.test(q);
      const files = [...items.values()].filter((i) => !i.trashed && i.parent === parent && i.name === name && (!wantFolder || i.mime.endsWith("folder")) && (!notFolder || !i.mime.endsWith("folder")));
      return json(res, 200, { files: files.map(view) });
    }
    if (u.pathname === "/drive/v3/files" && req.method === "POST") {
      const j = JSON.parse(body.toString()); const it = { id: crypto.randomUUID(), name: j.name, mime: j.mimeType, parent: j.parents?.[0], data: null }; items.set(it.id, it); return json(res, 200, view(it));
    }
    let m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === "GET") {
      const it = items.get(m[1]); if (!it) return json(res, 404, { error: { message: "File not found" } });
      if (u.searchParams.get("alt") === "media") { res.writeHead(200); return res.end(it.data ?? Buffer.alloc(0)); }
      return json(res, 200, { ...view(it), capabilities: { canAddChildren: true } });
    }
    if (u.pathname === "/upload/drive/v3/files" && req.method === "POST") {   // multipart/related
      const ct = req.headers["content-type"] || ""; const b = /boundary=(.+)$/.exec(ct)[1]; const parts = body.toString("binary").split(`--${b}`).slice(1, -1);
      const meta = JSON.parse(parts[0].split("\r\n\r\n")[1].trim()); const raw = parts[1]; const start = raw.indexOf("\r\n\r\n") + 4;
      const data = Buffer.from(raw.slice(start, raw.length - 2), "binary");
      const it = { id: crypto.randomUUID(), name: meta.name, mime: "application/octet-stream", parent: meta.parents?.[0], data }; items.set(it.id, it); persist(it);
      console.log(`created ${pathOf(it)}`); return json(res, 200, view(it));
    }
    m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === "PATCH") { const it = items.get(m[1]); if (!it) return json(res, 404, {}); const j = JSON.parse(body.toString() || "{}"); if (j.trashed) { it.trashed = true; for (const c of items.values()) if (c.parent === it.id) c.trashed = true; console.log(`trashed ${pathOf(it)}`); } return json(res, 200, view(it)); }
    m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === "PATCH") { const it = items.get(m[1]); if (!it) return json(res, 404, {}); it.data = body; persist(it); console.log(`updated ${pathOf(it)}`); return json(res, 200, view(it)); }
    json(res, 404, { error: { message: "Not Found" } });
  });
}).listen(port, "127.0.0.1", () => console.log(`Google Drive emulator on http://127.0.0.1:${port}, storing copies in ${dir}`));

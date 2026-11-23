/* Electron shell: starts the bundled Next.js standalone server on a free localhost port and shows it in a window.
 * User data (store.json, logs, config.env) lives in the OS user-data folder so upgrades never overwrite it.  */
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const http = require("node:http");

let server = null;
let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const serverDir = () => (app.isPackaged ? path.join(process.resourcesPath, "app-server") : path.join(__dirname, "app"));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** config.env in the user-data folder = the .env.local equivalent for non-technical users. */
function loadUserEnv(dir) {
  const file = path.join(dir, "config.env");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, [
      "# CleanCore Defect Hub settings. Restart the app after editing.",
      "# Leave JIRA_BASE_URL empty to stay in safe MOCK mode.",
      "JIRA_BASE_URL=", "JIRA_EMAIL=", "JIRA_API_TOKEN=", "JIRA_DEFAULT_PROJECT_KEY=CCRD",
      'JIRA_PROJECT_MAP={"P&G":"CCRD","SAP-CC":"CCRD"}', "DEDUP_THRESHOLD=0.9",
      "SYNC_MODE=none", "SYNC_FOLDER_PATH=", "", ].join("\n"));
  }
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

function waitReady(port, timeoutMs = 30000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get({ host: "127.0.0.1", port, path: "/api/sync", timeout: 1500 }, (res) => { res.resume(); resolve(); })
        .on("error", () => (Date.now() - t0 > timeoutMs ? reject(new Error("Server did not start in time")) : setTimeout(tick, 300)))
        .on("timeout", function () { this.destroy(); });
    };
    tick();
  });
}

async function start() {
  const userDir = app.getPath("userData");
  fs.mkdirSync(userDir, { recursive: true });
  const port = await freePort();
  const entry = path.join(serverDir(), "server.js");
  if (!fs.existsSync(entry)) throw new Error(`Bundled server not found at ${entry}. Run: npm run build && npm run desktop:prepare`);
  server = spawn(process.execPath, [entry], {
    cwd: serverDir(),
    env: { ...process.env, ...loadUserEnv(userDir), ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1", DATA_DIR: path.join(userDir, "data") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logFile = fs.createWriteStream(path.join(userDir, "server.log"), { flags: "a" });
  server.stdout.pipe(logFile); server.stderr.pipe(logFile);
  server.on("exit", (code) => { if (!app.isQuitting && code) dialog.showErrorBox("CleanCore Defect Hub", `The background server stopped (exit ${code}). See server.log in ${userDir}`); });
  await waitReady(port);

  win = new BrowserWindow({ width: 1440, height: 920, title: "CleanCore Defect Hub", autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}`)) { e.preventDefault(); shell.openExternal(url); } });
  await win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(() => start().catch((e) => { dialog.showErrorBox("CleanCore Defect Hub failed to start", String(e.message || e)); app.quit(); }));
app.on("before-quit", () => { app.isQuitting = true; if (server) server.kill(); });
app.on("window-all-closed", () => app.quit());

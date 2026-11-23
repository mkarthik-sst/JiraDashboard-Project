# 07 · Local Standalone (Offline) Packaging – double-click `.exe` / `.app`

**Approach: Electron shell around Next.js `output: "standalone"`.** The installer contains Electron, the minimal Node server (`.next/standalone`) and static assets. On launch `desktop/main.js` picks a free localhost port, starts the server with Electron's embedded Node (`ELECTRON_RUN_AS_NODE=1`), waits until `/api/sync` answers, and opens a window. Users never see a terminal. Everything works **offline** except the calls that inherently need the network (Jira, sync).

User data lives in the OS user-data folder (never inside the installer, so upgrades keep it):

| OS | Folder |
|---|---|
| Windows | `%APPDATA%\CleanCore Defect Hub\` |
| macOS | `~/Library/Application Support/CleanCore Defect Hub/` |
| Linux | `~/.config/CleanCore Defect Hub/` |

Contents: `data/store.json`, `data/logs/app.log`, `data/scheduled/*.xlsx`, `server.log`, and **`config.env`** (created on first launch – the non-technical equivalent of `.env.local`: Jira URL/email/token, project map, sync target; edit in Notepad, restart the app).

## Build steps (developer, once per release)

```bash
# 1. from the project root
npm install
npm run build                 # produces .next/standalone  (output: "standalone")
npm run desktop:prepare       # copies standalone + static into desktop/app (strips .env files & demo data)

# 2. build the installer
cd desktop
npm install                   # Electron 33 + electron-builder 25 (devDependencies, ~250 MB download)
npm run dist:win              # Windows: dist/CleanCore Defect Hub 1.0.0.exe (portable) + Setup .exe (NSIS)
npm run dist:mac              # macOS (must run on a Mac): dist/CleanCore Defect Hub-1.0.0.dmg
npm run dist:linux            # AppImage
```

Test without packaging: `cd desktop && npm start` (uses `desktop/app` directly).

## What the end user does

1. Receives `CleanCore Defect Hub 1.0.0.exe` (portable) or the Setup installer.
2. **Double-click.** Window opens in a few seconds with the demo data / their own data.
3. First time only: open `%APPDATA%\CleanCore Defect Hub\config.env`, paste Jira URL/email/API token (IT supplies), save, relaunch. Header badge changes from *Jira MOCK mode* to *Jira LIVE*.

## Notes & gotchas

- **Code signing.** Unsigned `.exe`/`.dmg` trigger SmartScreen/Gatekeeper warnings. Sign with the corporate certificate (`CSC_LINK`, `CSC_KEY_PASSWORD` env vars for electron-builder; Apple notarisation for macOS).
- **Antivirus/AppLocker.** The portable exe unpacks to `%TEMP%`; if blocked, use the NSIS installer (installs per-user to `%LOCALAPPDATA%\Programs`).
- **Single instance.** A second launch focuses the existing window (prevents two writers on `store.json`).
- **Updates.** Distribute a new installer; data is untouched. For auto-update add `electron-updater` + an internal feed (not included).
- **Scheduled ingestion needs the app running.** The scheduler is in-process; if the machine is off at the scheduled time the run executes on next launch (overdue runs fire on the next 5-second tick).
- **Shared team use.** The desktop build is *single-user*. For a team, run the same app on one server (`npm run build && npm start`, or Docker/PM2) and let people use browsers – otherwise each desktop has its own `store.json` and dedup history.
- **Bundle trimming.** `scripts/prepare-desktop.mjs` tops up transitive dependencies that Next's file tracer misses (Node's `module-sync` export condition: `generator-function`, `async-function`, …). Without that step the standalone server crashes on the first Excel call – the standalone bundle was verified end-to-end (template download + upload) in this environment.
- **Verification status.** The standalone Node bundle was run and exercised directly; `desktop/main.js` passes a syntax check. The Electron installer itself could not be built in the headless build sandbox – run `npm run dist:win` on a workstation and smoke-test the resulting `.exe` before distributing.

## Alternatives considered

| Option | Verdict |
|---|---|
| **Electron** (chosen) | Full Node runtime, native dialogs/downloads, mature signing/auto-update |
| Nativefier | Only wraps a *URL*; there is no server inside, so it is not offline. Largely unmaintained – avoid |
| PyInstaller (Python stack) | `pyinstaller --onefile app/main.py` + `webbrowser.open("http://127.0.0.1:8000")` (or `pywebview`). Good if you adopt the FastAPI variant (doc 02) |
| Tauri | Smaller binary but still needs a sidecar Node/Python server for this architecture; more build tooling (Rust) |
| Docker Desktop | Not "double-click for non-technical users" |

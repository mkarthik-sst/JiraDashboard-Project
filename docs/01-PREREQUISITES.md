# 01 · System Prerequisites & Local Workbench Setup

Target: a developer laptop with **only VS Code installed**. Everything below is installed once.
The project was built and verified with **Node 22.x / npm 10.9 / Python 3.13** (Linux); the stated minimums are what the code requires.

## 1. Required software

| # | Tool | Minimum | Recommended | Why it is needed | Install (Windows / macOS) |
|---|------|---------|-------------|------------------|---------------------------|
| 1 | **Node.js (LTS)** | 20.11 | 22 LTS | Runs Next.js 14, build, tests | `winget install OpenJS.NodeJS.LTS` / `brew install node@22` |
| 2 | **npm** | 10 (ships with Node) | 10.9+ | Default package manager (a `package-lock.json` is provided) | bundled |
| 2b | pnpm *(optional)* | 9 | 9.x | Alternative to npm: `corepack enable && corepack prepare pnpm@9 --activate` | via Corepack |
| 3 | **Git CLI** | 2.40 | latest | Clone, branch | `winget install Git.Git` / `brew install git` |
| 4 | **Python** *(only for the Python alternative stack)* | 3.11 | 3.12 | FastAPI + Streamlit alternative, `venv`, `pip` | `winget install Python.Python.3.12` / `brew install python@3.12` |
| 5 | **Microsoft Edge/Chrome** | current | current | Dashboard UI testing | usually present |
| 6 | **Desktop packaging – Electron** | Electron 33 / electron-builder 25 | pinned in `desktop/package.json` | Double-click `.exe`/`.app` (see doc 07). Installed with `npm install` *inside `desktop/`* – no global install | — |
| 6b | PyInstaller *(Python stack only)* | 6.x | 6.x | `pyinstaller --onefile` for the FastAPI variant | `pip install pyinstaller` |
| 6c | Nativefier *(not recommended)* | — | — | Only wraps a URL; **does not bundle a server**, and is no longer actively maintained. Listed for completeness – use Electron | — |

Windows extras: none for `portable`/`nsis` builds. **macOS `.dmg` must be built on macOS**; Windows `.exe` is easiest on Windows (Wine on Linux/macOS also works). Corporate proxies: set `npm config set proxy`/`https-proxy` and `NODE_EXTRA_CA_CERTS=<corp-root-ca.pem>`.

## 2. Verify the toolchain

```bash
node -v        # v20.11+  (v22.x recommended)
npm -v         # 10.x
git --version  # 2.40+
python --version   # 3.11+  (only if you will explore the Python alternative)
```

## 3. First run (5 minutes)

```bash
cd cleancore-defect-hub
npm install                 # ~560 packages, ~2 min
cp .env.example .env.local  # Windows: copy .env.example .env.local   (blank Jira creds => safe MOCK mode)
npm run dev                 # http://localhost:3000  (pre-populated with SAP Clean Core demo defects)
npm test                    # 23 tests: schema, Excel, dedup, workflow, scheduler, Jira-failure retry
npm run typecheck && npm run lint && npm run build
```

`npm run dev` works out of the box with **no Jira account**: without `JIRA_BASE_URL/EMAIL/API_TOKEN` the app runs in **MOCK mode** (clearly badged in the header) and fabricates `CCRD-2xxx` keys. Nothing is ever sent to Atlassian in this mode.

## 4. Essential VS Code extensions

| Extension (ID) | Purpose |
|---|---|
| **ESLint** `dbaeumer.vscode-eslint` | Lint (`next/core-web-vitals`) |
| **Prettier** `esbenp.prettier-vscode` | Formatting (enable *Format on Save*) |
| **Tailwind CSS IntelliSense** `bradlc.vscode-tailwindcss` | Class autocomplete/hover for `tailwind.config.ts` |
| **Python** `ms-python.python` + **Pylance** `ms-python.vscode-pylance` | Python alternative stack, type checking |
| **REST Client** `humao.rest-client` | Run requests in `api.http` against the local API |
| Markdown Preview Mermaid Support `bierner.markdown-mermaid` | Render the Mermaid diagrams in `docs/` |
| *(optional)* Error Lens `usernamehw.errorlens`, GitLens `eamodio.gitlens` | Inline diagnostics, blame |

Install all at once:

```bash
code --install-extension dbaeumer.vscode-eslint --install-extension esbenp.prettier-vscode \
     --install-extension bradlc.vscode-tailwindcss --install-extension ms-python.python \
     --install-extension ms-python.vscode-pylance --install-extension humao.rest-client \
     --install-extension bierner.markdown-mermaid
```

Suggested `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "tailwindCSS.experimental.classRegex": [["cn\\(([^)]*)\\)", "[\"'`]([^\"'`]*)[\"'`]"]],
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

## 5. External accounts you will need later (not for the first run)

| Needed for | What | Where |
|---|---|---|
| Live Jira | Atlassian **API token** for a service account that has *Create Issues*, *Browse*, *Add Attachments* in the target Jira space | id.atlassian.com → Security → API tokens |
| GitHub sync | Fine-grained PAT, repo scope *Contents: Read & write* only | GitHub → Settings → Developer settings |
| Shared-drive sync | Service account with *Modify* on the SMB share | IT / AD |
| Power Automate sync | M365 licence with **HTTP trigger (premium)** + Office Scripts enabled | Power Automate admin |

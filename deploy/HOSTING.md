# Getting a shared URL (e.g. smartshiftdefecthubplatform)

Build once: `npm ci && npm run build`. Start: `npm run start` (reads PORT, default 3000, listens on all addresses).
Always set in `.env.local` / host settings: APP_BASE_URL=https://<your-url>, real SMTP_*, AUTH_MODE=email, AUTH_SECRET, ADMIN_EMAILS, AUTH_ALLOWED_DOMAINS, OPEN_DRIVE_USERS, SYNC_MODE=gdrive + GDRIVE_* (see docs/09), JIRA_*.
Run exactly ONE instance (state is held in one process; Google Drive is the backup).

1. Render (name the service `smartshiftdefecthubplatform` -> https://smartshiftdefecthubplatform.onrender.com if the name is free). Build: `npm ci && npm run build`; Start: `npm run start`. Free plans sleep when idle - use a paid plan for always-on. Put the code in a private GitHub repo first (.gitignore already excludes .env.local and data).
2. Own PC/VM + Cloudflare Tunnel or company DNS (e.g. defecthub.smartshift.com) - keep the machine on.
3. Azure App Service - same build/start commands.
Names, prices and free-tier behaviour change; check each provider's current docs.

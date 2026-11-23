# 11 - Many users, sign-in, Open repo list and shared URL (v2.3.0)

* Sign-in: `AUTH_MODE=email` (magic link by e-mail), `AUTH_SECRET`, `ADMIN_EMAILS`, `AUTH_ALLOWED_DOMAINS`, `AUTH_ALLOWED_EMAILS`, `AUTH_ENFORCE_OWNER`.
* Open Drive list: `OPEN_DRIVE_USERS` (default = admins, `*` = everybody). Hides the Drive-folder button and Drive file links in the Hub; it does not change Google Drive's own sharing.
* Storage: all users' uploads are copied to the single shared Drive folder in `GDRIVE_FOLDER_ID`.
* Shared URL: see `deploy/HOSTING.md` and the Final Run Guide (Word). Run exactly one instance.

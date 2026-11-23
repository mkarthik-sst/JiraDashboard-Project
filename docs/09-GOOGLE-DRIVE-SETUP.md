# 09 · Google Drive storage setup (replaces GitHub)

The Hub keeps its working data in `DATA_DIR` and **copies everything to one Google Drive shared folder** after every change:

```
<your shared folder>/
├─ uploads/<date>/<uploadId>_<file>.xlsx        original files as uploaded
├─ tracking/<date>/<uploadId>_tracking.xlsx     per-upload result (what was staged, duplicates, tickets)
├─ attachments/<uploadId>/...                   evidence files added to defects
├─ master/CleanCore_Defects_Master.xlsx         all records, 26 columns (Jira ID, statuses, reassign, cancel)
├─ master/CleanCore_Recurrence_Report.xlsx      recurrence by Fix / Rule ID
└─ state/store.json                             full backup, used to restore a fresh machine
```

Links to these files appear on the dashboard ("Open Drive folder", "Drive copy") and in the Jira description.

## 1. Folder
1. In Google Drive create a folder, e.g. `CleanCore Defect Hub`.
2. Open it. The address looks like `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz` → the folder id is the last part: `1AbCdEfGhIjKlMnOpQrStUvWxYz`.

## 2. Choose a sign-in method

| | A · Service account (recommended for a Shared Drive) | B · OAuth refresh token (works with a normal My Drive folder) |
|---|---|---|
| Who owns the files | the service account | you |
| Needs | a Shared Drive (Workspace) – a service account has **no storage of its own** in My Drive | your own Google account |
| Secret | JSON key file | client id + client secret + refresh token |

### A · Service account
1. console.cloud.google.com → create/select a project → **APIs & Services → Library → Google Drive API → Enable**.
2. **IAM & Admin → Service accounts → Create**; then **Keys → Add key → JSON**. Save it as `secrets/drive-key.json` (never commit it, never e-mail it).
3. Open the Shared Drive (or folder in it) → **Share** → add the service-account e-mail (`...@...iam.gserviceaccount.com`) as **Content manager**.
4. `.env.local`:
```
SYNC_MODE=gdrive
GDRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
GDRIVE_KEY_FILE=./secrets/drive-key.json
```

### B · OAuth refresh token
1. Same project → **APIs & Services → OAuth consent screen** (Internal for Workspace, or External + add yourself as test user) → **Credentials → Create credentials → OAuth client ID → Web application**; add redirect URI `https://developers.google.com/oauthplayground`.
2. Open https://developers.google.com/oauthplayground → gear icon → *Use your own OAuth credentials* → paste client id/secret → select scope `https://www.googleapis.com/auth/drive` → **Authorize** → **Exchange authorization code for tokens** → copy the **refresh token**.
3. `.env.local`:
```
SYNC_MODE=gdrive
GDRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
GDRIVE_OAUTH_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GDRIVE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
GDRIVE_OAUTH_REFRESH_TOKEN=1//0gxxxxxxxxxxxxxxxxxxxx
```
Note: an OAuth app left in "Testing" status issues refresh tokens that expire after 7 days; publish the app (or use an Internal Workspace app) for a permanent token.

## 3. Test
```
npm run test-drive        # writes and reads a small test file in the folder, prints the link
```
or use **Sync now** on the dashboard. Common messages: `401` = wrong/expired credentials · `404` = folder id wrong or not shared with the account · `403 storageQuotaExceeded` = service account used on a My Drive folder → use a Shared Drive or method B.

## 4. Behaviour
* A failed upload keeps the files queued and retries after 60 s – the dashboard shows `Google Drive: pending · N queued`.
* Restore: on an empty machine set `GDRIVE_RESTORE_ON_EMPTY=true` (default) and the Hub loads `state/store.json` from the folder at start-up; **Settings → Restore** does the same on demand.
* There is no "pull" or "Refresh" any more – Drive is a backup/share location, the Hub stays the system of record.
* Who sees the "Open Drive folder" button: `OPEN_DRIVE_USERS` (default admins, `*` = everybody).
* Do not edit files in the Drive folder by hand – the next sync overwrites them.

## Tracking files stay current (v2.4.2)
Every approval, reassignment, return, cancellation or repeat report rewrites `tracking/<date>/<uploadId>_<file>.xlsx` (columns JiraTicketID, ExecutionStatus, AssignApprovalStatus, ReassignStatus, DuplicateOccurrenceCount, CancelReason) and the master workbook within a few seconds. Known files are updated **by id**, so Google's delayed name search can never create a second, stale copy. If you see two files with the same name in `tracking/` from an earlier version, the next sync updates both; delete the extra one.
Google Drive's preview can be a few seconds behind: press F5 or use *Open with > Google Sheets*.

## Clearing everything for a demo
Stop the Hub, run `npm run demo-reset`, answer YES, start the Hub. See README (v2.4.3). Demo use only - not for production.

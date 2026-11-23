/** Central runtime configuration. All values come from environment variables (.env.local). */
import path from "node:path";

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
}
function json<T>(v: string | undefined, d: T): T {
  if (!v) return d;
  try { return JSON.parse(v) as T; } catch { return d; }
}

export function getConfig() {
  const jiraBase = (process.env.JIRA_BASE_URL ?? "").replace(/\/+$/, "");
  const hasCreds = !!(jiraBase && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);
  return {
    dataDir: path.resolve(process.env.DATA_DIR || "./data"),
    dedupThreshold: Math.min(1, Math.max(0.5, num(process.env.DEDUP_THRESHOLD, 0.9))),
    maxUploadBytes: 10 * 1024 * 1024,
    maxRowsPerFile: 5000,
    jira: {
      mode: hasCreds ? ("live" as const) : ("mock" as const),
      baseUrl: jiraBase,
      email: process.env.JIRA_EMAIL ?? "",
      token: process.env.JIRA_API_TOKEN ?? "",
      workspacePath: process.env.JIRA_WORKSPACE_PATH || "Spaces / CS Clean Core / R&D",
      defaultProjectKey: process.env.JIRA_DEFAULT_PROJECT_KEY || "JAIT",
      projectMap: json<Record<string, string>>(process.env.JIRA_PROJECT_MAP, {}),
      leadField: process.env.JIRA_LEAD_FIELD ?? "",
      userMap: ((): Record<string, string> => { try { const m = JSON.parse(process.env.JIRA_USER_MAP || "{}"); return m && typeof m === "object" ? m : {}; } catch { return {}; } })(),
      userMapError: ((): string => { const v = process.env.JIRA_USER_MAP; if (!v) return ""; try { JSON.parse(v); return ""; } catch (e) { return (e as Error).message; } })(),
      mockFailRate: Math.min(1, Math.max(0, num(process.env.JIRA_MOCK_FAIL_RATE, 0))),
      timeoutMs: 20000,
      maxAttempts: 3,
      attachmentRoot: path.resolve(process.env.ATTACHMENT_ROOT || "."),
      /** Drop optional fields Jira refuses (not on screen / not permitted / unknown) instead of failing the ticket. */
      lenientFields: process.env.JIRA_LENIENT_FIELDS !== "false",
      /** Add "Workspace | Source | Reporter | Lead" header lines at the top of the Jira description. */
      descriptionHeader: process.env.JIRA_DESCRIPTION_HEADER !== "false",
      defaultLabels: (process.env.JIRA_DEFAULT_LABELS ?? "").split(/[,\s]+/).filter(Boolean),
      /** Suggestions for the Excel dropdowns (users can still type other values). */
      issueTypes: (process.env.JIRA_ISSUE_TYPES || "Bug,Task,Story,Epic,Sub-task").split(",").map((s) => s.trim()).filter(Boolean),
      priorities: (process.env.JIRA_PRIORITIES || "Highest,High,High Attention,Medium,Low,Lowest").split(",").map((s) => s.trim()).filter(Boolean),
    },
    attachments: { maxFiles: 30, maxBytes: 10 * 1024 * 1024 },
    /** Engineering feedback (automated-fix issues): mandatory details, Jira routing, hand-over e-mail. */
    engineering: {
      /** flagged = required only when "Automated fix issue" is Yes (default) | all = required for every defect | off = never required */
      requireMode: ((v) => (["flagged", "all", "off"].includes(v) ? v : "flagged") as "flagged" | "all" | "off")((process.env.ENGINEERING_REQUIRE_MODE ?? "flagged").trim().toLowerCase()),
      /** Template column names that must be filled before approval. */
      requiredFields: (process.env.ENGINEERING_REQUIRED_FIELDS ?? "Fix / Rule ID,Root cause,Impact,Prerequisites,Dependent data sources").split(",").map((x) => x.trim()).filter(Boolean),
      /** Jira project that receives automated-fix defects (empty = the project key from the sheet). */
      projectKey: (process.env.ENGINEERING_JIRA_PROJECT_KEY ?? "").trim(),
      labels: (process.env.ENGINEERING_JIRA_LABELS ?? "automated-fix-feedback,product-engineering").split(/[,\s]+/).filter(Boolean),
      component: (process.env.ENGINEERING_JIRA_COMPONENT ?? "").trim(),
      /** Product-engineering mailbox that is told when an automated-fix defect is approved. */
      notifyEmail: (process.env.ENGINEERING_NOTIFY_EMAIL ?? "").trim(),
    },
    sync: {
      mode: (process.env.SYNC_MODE || "none") as "none" | "folder" | "gdrive" | "webhook",
      folderPath: process.env.SYNC_FOLDER_PATH ?? "",
      /** Google Drive storage. The folder is the shared folder (or Shared Drive folder) that holds everything. */
      gdriveFolderId: (process.env.GDRIVE_FOLDER_ID ?? "").trim().replace(/^.*\/folders\/([\w-]+).*$/, "$1"),
      gdriveKeyFile: process.env.GDRIVE_KEY_FILE ?? "",                      // service-account JSON key file
      gdriveKeyJson: process.env.GDRIVE_SERVICE_ACCOUNT_JSON ?? "",          // OR the key JSON itself (raw or base64) - for hosts without files
      gdriveClientId: process.env.GDRIVE_OAUTH_CLIENT_ID ?? "",              // OR a user's OAuth client + refresh token (My Drive folders)
      gdriveClientSecret: process.env.GDRIVE_OAUTH_CLIENT_SECRET ?? "",
      gdriveRefreshToken: process.env.GDRIVE_OAUTH_REFRESH_TOKEN ?? "",
      gdriveApiUrl: (process.env.GDRIVE_API_URL || "https://www.googleapis.com/drive/v3").replace(/\/+$/, ""),
      gdriveUploadUrl: (process.env.GDRIVE_UPLOAD_URL || "https://www.googleapis.com/upload/drive/v3").replace(/\/+$/, ""),
      gdriveTokenUrl: process.env.GDRIVE_TOKEN_URL || "https://oauth2.googleapis.com/token",
      gdriveWebUrl: (process.env.GDRIVE_WEB_URL || "https://drive.google.com").replace(/\/+$/, ""),
      gdriveRestoreOnEmpty: process.env.GDRIVE_RESTORE_ON_EMPTY !== "false",
      webhookUrl: process.env.POWER_AUTOMATE_URL ?? "",
      webhookSecret: process.env.POWER_AUTOMATE_SECRET ?? "",
      webhookIncludeRows: process.env.POWER_AUTOMATE_INCLUDE_ROWS === "true",
      debounceMs: 3000,
    },
    notifyWebhook: process.env.NOTIFY_WEBHOOK_URL ?? "",
    /** E-mail notifications (SMTP). Disabled until SMTP_HOST is set. */
    mail: {
      host: process.env.SMTP_HOST ?? "",
      port: num(process.env.SMTP_PORT, 587),
      secure: /^(true|1|yes)$/i.test((process.env.SMTP_SECURE ?? "").trim()) || num(process.env.SMTP_PORT, 587) === 465,   // implicit TLS: SMTP_SECURE=true or port 465 (always); otherwise STARTTLS (587)
      user: process.env.SMTP_USER ?? "",
      password: process.env.SMTP_PASSWORD ?? "",
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "smartShift Defect Hub <no-reply@localhost>",
      ignoreTls: process.env.SMTP_IGNORE_TLS === "true" || /^(127\.0\.0\.1|localhost|::1)$/i.test((process.env.SMTP_HOST ?? "").trim()),          // only for local test SMTP servers
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
      appBaseUrl: (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, ""),
      onUpload: process.env.NOTIFY_ON_UPLOAD !== "false",
      onReassign: process.env.NOTIFY_ON_REASSIGN !== "false",
      onApprove: process.env.NOTIFY_ON_APPROVE !== "false",
      onReview: process.env.NOTIFY_ON_REVIEW !== "false",         // return-to-reporter / send-for-approval-again mails
      userMap: json<Record<string, string>>(process.env.NOTIFY_USER_MAP, {}),   // display name -> e-mail address
      fallbackTo: process.env.NOTIFY_FALLBACK_EMAIL ?? "",        // receives mails whose recipient e-mail cannot be found
      cc: (process.env.NOTIFY_CC ?? "").split(/[,;\s]+/).filter(Boolean),
      /** Test mode: deliver every mail to this address (e.g. a Yopmail inbox) while the dashboard still shows the real recipient.
       *  One address, or JSON {"real@company.com":"test@yopmail.com","*":"fallback@yopmail.com"}. Empty = off. */
      redirectTo: (process.env.NOTIFY_REDIRECT_TO ?? "").trim(),
    },
  };
}
export type AppConfig = ReturnType<typeof getConfig>;

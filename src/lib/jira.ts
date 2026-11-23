/**
 * Jira Cloud REST API v3 client.
 *  - buildIssuePayload(): the exact JSON sent to POST /rest/api/3/issue  (edit here to change fields)
 *  - resolveProjectKey(): project / space routing (sheet "Project key" is used as-is unless JIRA_PROJECT_MAP aliases it)
 *  - createJiraIssue():   live call with retry/backoff + optional-field fallback, or MOCK mode when credentials are absent
 * NEVER sent to Jira: Customer, Project name, Project type (reference-only columns).
 */
import { getConfig } from "./config";
import { driveLinkOf } from "./drive";
import { engineeringDescription, isEngineeringIssue } from "./engineering";
import { isFileUrl, readStored, categoryFor } from "./attachments";
import type { AttachmentInfo, DefectRecord } from "./schema";
import { log } from "./logger";

export class JiraError extends Error {
  constructor(message: string, public status = 0, public retryable = false, public details: string[] = [], public fieldErrors: Record<string, string> = {}) {
    super(message); this.name = "JiraError";
  }
}

export function resolveProjectKey(sheetKey: string): string {
  const cfg = getConfig().jira;
  const k = (sheetKey ?? "").trim();
  return cfg.projectMap[k] ?? cfg.projectMap[k.toUpperCase()] ?? (k || cfg.defaultProjectKey);
}

/** Jira project that receives this defect: the product-engineering project for automated-fix issues (when configured), otherwise the sheet's project. */
export function jiraProjectFor(rec: Pick<DefectRecord, "ProjectKey" | "AutomatedFix">): string {
  const eng = getConfig().engineering;
  return isEngineeringIssue(rec) && eng.projectKey ? eng.projectKey : resolveProjectKey(rec.ProjectKey);
}

interface Link { title: string; url: string }
const adfPara = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const adfLink = (l: Link) => ({ type: "paragraph", content: [{ type: "text", text: l.title, marks: [{ type: "link", attrs: { href: l.url } }] }] });
export function toAdf(text: string, links: Link[] = []) {
  const content: unknown[] = text.split(/\r?\n/).map(adfPara);
  if (links.length) { content.push(adfPara(""), adfPara("Reference links / evidence:"), ...links.map(adfLink)); }
  return { type: "doc", version: 1, content: content.length ? content : [adfPara("")] };
}
export const parseAttachments = (s: string) => s.split("|").map((x) => x.trim()).filter(Boolean);

export interface IssueContext { assigneeAccountId?: string; reporterAccountId?: string }

/** Links shown in the Jira description: external URLs (not downloaded) and Google Drive copies of stored files. */
export function referenceLinks(rec: DefectRecord, linkOnlyUrls: Set<string> = new Set()): Link[] {
  const out: Link[] = [];
  for (const a of rec.attachments ?? []) {
    if (a.kind === "url" && (linkOnlyUrls.has(a.raw) || a.category === "link")) out.push({ title: a.name || a.raw, url: a.raw });
    else if (a.kind === "file" && a.exists && driveLinkOf(a.drivePath)) out.push({ title: `${a.name} (Google Drive)`, url: driveLinkOf(a.drivePath) });
  }
  return out;
}

/** Builds the Jira payload. `ctx` carries accountIds resolved from the assignee / reporter emails or names. */
export function buildIssuePayload(rec: DefectRecord, ctx: IssueContext = {}, linkOnlyUrls: Set<string> = new Set()) {
  const cfg = getConfig().jira;
  const lines: string[] = [];
  if (cfg.descriptionHeader) {
    lines.push(`Workspace: ${cfg.workspacePath} | Source: ${rec.sourceFile} (row ${rec.sourceRow}) | Reporter: ${rec.ReporterEmail}`);
    if (rec.Lead && !cfg.leadField) lines.push(`Project lead: ${rec.Lead}`);
    lines.push("");
  }
  lines.push(rec.Description);
  lines.push(...engineeringDescription(rec));
  const fields: Record<string, unknown> = {
    project: { key: jiraProjectFor(rec) },
    issuetype: { name: rec.IssueType },
    summary: rec.Summary,
    description: toAdf(lines.join("\n"), referenceLinks(rec, linkOnlyUrls)),
    priority: { name: rec.Priority },
  };
  const eng = getConfig().engineering;
  const labels = [...cfg.defaultLabels, ...(isEngineeringIssue(rec) ? eng.labels : [])];
  if (labels.length) fields.labels = [...new Set(labels)];
  if (isEngineeringIssue(rec) && eng.component) fields.components = [{ name: eng.component }];
  if (ctx.assigneeAccountId) fields.assignee = { accountId: ctx.assigneeAccountId };
  if (ctx.reporterAccountId) fields.reporter = { accountId: ctx.reporterAccountId };
  if (cfg.leadField && rec.Lead) fields[cfg.leadField] = rec.Lead;
  return { fields };
}

export const effectiveAssignee = (r: DefectRecord) => r.ReassignedToEmail || r.AssigneeEmail;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jiraFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  const cfg = getConfig().jira;
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    return await fetch(`${cfg.baseUrl}${pathname}`, { ...init, signal: ctrl.signal, headers: { Authorization: `Basic ${auth}`, Accept: "application/json", ...(init.headers ?? {}) } });
  } catch (e) {
    throw new JiraError((e as Error).name === "AbortError" ? `Jira request timed out after ${cfg.timeoutMs}ms` : `Network error: ${(e as Error).message}`, 0, true);
  } finally { clearTimeout(t); }
}

async function toJiraError(res: Response): Promise<JiraError> {
  let body: { errorMessages?: string[]; errors?: Record<string, string> } = {};
  try { body = (await res.json()) as typeof body; } catch { /* non-JSON */ }
  const fieldErrors = body.errors ?? {};
  const details = [...(body.errorMessages ?? []), ...Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v}`)];
  const hint: Record<number, string> = {
    400: "Jira rejected the payload (check Project key, Issue Type and Priority names exist in that Jira space)",
    401: "Jira authentication failed (check JIRA_EMAIL / JIRA_API_TOKEN)",
    403: "Jira permission denied (service account lacks Create Issues / Add Attachments in the project)",
    404: "Jira project or endpoint not found (check JIRA_BASE_URL / Project key)",
    429: "Jira rate limit hit",
  };
  const e = new JiraError(`${hint[res.status] ?? `Jira returned HTTP ${res.status}`}${details.length ? " - " + details.join("; ") : ""}`, res.status, res.status === 429 || res.status >= 500, details, fieldErrors);
  (e as JiraError & { retryAfterMs?: number }).retryAfterMs = Number(res.headers.get("retry-after") ?? 0) * 1000;
  return e;
}

type JUser = { accountId: string; emailAddress?: string; displayName?: string; active?: boolean; accountType?: string };
const pickUser = (users: JUser[], ref: string, what: string): string | undefined => {
  users = users.filter((u) => u.active !== false && u.accountType !== "app");
  const q = ref.trim().toLowerCase();
  const exact = users.find((u) => u.emailAddress?.toLowerCase() === q) ?? users.find((u) => u.displayName?.toLowerCase() === q);
  if (exact) return exact.accountId;
  if (users.length === 1) return users[0].accountId;
  if (users.length > 1) throw new JiraError(`${what} '${ref}' matches several Jira users (${users.slice(0, 4).map((u) => u.displayName).join(", ")}). Use the exact display name or set JIRA_USER_MAP.`, 400, false);
  return undefined;
};

/** Resolve an email OR a display name to a Jira accountId. Order: JIRA_USER_MAP -> the API user itself (/myself) ->
 *  users assignable in the project -> global user search. Jira hides e-mail addresses that users set to private, so a plain
 *  e-mail search can return nothing even though the user exists; the display name and JIRA_USER_MAP always work. */
async function lookupAccountId(ref: string, what: string, projectKey = "", trace: string[] = []): Promise<string | undefined> {
  const cfg = getConfig().jira;
  const q = ref.trim().toLowerCase();
  const mapped = Object.entries(cfg.userMap).find(([k]) => k.trim().toLowerCase() === q)?.[1];
  if (mapped) return mapped;
  trace.push(cfg.userMapError ? `JIRA_USER_MAP is NOT valid JSON and was ignored (${cfg.userMapError})` : `JIRA_USER_MAP has ${Object.keys(cfg.userMap).length} entr${Object.keys(cfg.userMap).length === 1 ? "y" : "ies"}, none matches '${ref}'`);
  if (cfg.email && q === cfg.email.trim().toLowerCase()) {            // the token owner: always resolvable
    const me = await jiraFetch("/rest/api/3/myself");
    if (me.ok) return ((await me.json()) as JUser).accountId;
    trace.push(`/myself returned HTTP ${me.status}`);
  } else trace.push(`JIRA_EMAIL is '${cfg.email}', which is not '${ref}'`);
  if (projectKey) {
    const r = await jiraFetch(`/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&query=${encodeURIComponent(ref)}&maxResults=50`);
    if (r.ok) { const list = (await r.json()) as JUser[]; const id = pickUser(list, ref, what); if (id) return id; trace.push(`assignable search in ${projectKey} found ${list.length} users`); }
    else trace.push(`assignable search in ${projectKey} returned HTTP ${r.status}`);
  }
  const res = await jiraFetch(`/rest/api/3/user/search?query=${encodeURIComponent(ref)}`);
  if (!res.ok) throw await toJiraError(res);
  const found = (await res.json()) as JUser[];
  const id = pickUser(found, ref, what);
  if (!id) trace.push(`general user search found ${found.length} users`);
  return id;
}

/** Download an attachment from a URL. Returns null if it cannot be fetched. */
async function fetchUrlAttachment(a: AttachmentInfo): Promise<Buffer | null> {
  try {
    const res = await fetch(a.raw, { signal: AbortSignal.timeout(20000), redirect: "follow" });
    if (!res.ok || /text\/html/i.test(res.headers.get("content-type") ?? "")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= getConfig().attachments.maxBytes ? buf : null;
  } catch { return null; }
}

/** Upload stored files and downloadable URLs; returns warnings. URLs that cannot be fetched stay as description links. */
async function uploadAttachments(issueKey: string, rec: DefectRecord): Promise<string[]> {
  const warnings: string[] = [];
  for (const a of rec.attachments ?? []) {
    if (a.kind === "file" && !a.exists) { warnings.push(`Attachment skipped (${a.name}): ${a.note || "not found"}`); continue; }
    if (a.kind === "url" && !isFileUrl(a.raw)) continue;                 // plain link: already in the description
    let data: Buffer | null = a.kind === "file" ? await readStored(a.setId, a.name) : await fetchUrlAttachment(a);
    if (!data) { warnings.push(`Attachment not downloadable (${a.name}); kept as a link in the description`); continue; }
    if (getConfig().jira.mode === "mock") continue;
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)]), a.name || `file.${categoryFor(a.raw)}`);
    const res = await jiraFetch(`/rest/api/3/issue/${issueKey}/attachments`, { method: "POST", headers: { "X-Atlassian-Token": "no-check" }, body: form });
    if (!res.ok) warnings.push(`Attachment upload failed (${res.status}): ${a.name}`);
    data = null;
  }
  return warnings;
}

export interface JiraResult { key: string; url: string; warnings: string[] }
let mockCounter = 2000;
export function seedMockCounter(n: number) { mockCounter = Math.max(mockCounter, n); }

export async function createJiraIssue(rec: DefectRecord): Promise<JiraResult> {
  const cfg = getConfig().jira;
  let last: JiraError | undefined;
  for (let i = 1; i <= cfg.maxAttempts; i++) {
    try { return await createOnce(rec); }
    catch (e) {
      last = e instanceof JiraError ? e : new JiraError((e as Error).message, 0, false);
      if (!last.retryable || i === cfg.maxAttempts) break;
      const wait = Math.max((last as JiraError & { retryAfterMs?: number }).retryAfterMs ?? 0, 400 * 2 ** (i - 1));
      log("WARNING", `Jira attempt ${i}/${cfg.maxAttempts} failed (${last.message}); retrying in ${wait}ms`, { recordId: rec.id });
      await sleep(wait);
    }
  }
  throw last!;
}

/** Optional fields Jira may refuse for a given project/issue type; dropped (with a warning) instead of failing the whole ticket. */
const DROPPABLE = ["reporter", "priority", "labels", "assignee", "components"];
const UNSETTABLE = /cannot be set|appropriate screen|unknown|not valid|is not a valid|invalid|does not exist/i;

async function createOnce(rec: DefectRecord): Promise<JiraResult> {
  const cfg = getConfig().jira;
  const linkOnly = new Set((rec.attachments ?? []).filter((a) => a.kind === "url" && !isFileUrl(a.raw)).map((a) => a.raw));
  if (cfg.mode === "mock") {
    await sleep(350 + Math.random() * 400);
    if (Math.random() < cfg.mockFailRate) throw new JiraError("MOCK: simulated Jira 503 Service Unavailable", 503, true);
    const key = `${jiraProjectFor(rec)}-${++mockCounter}`;
    return { key, url: `https://mock.atlassian.net/browse/${key}`, warnings: await uploadAttachments(key, rec) };
  }
  const warnings: string[] = [];
  const ctx: IssueContext = {};
  const assignee = effectiveAssignee(rec);
  const trace: string[] = [];
  ctx.assigneeAccountId = await lookupAccountId(assignee, "Assignee", jiraProjectFor(rec), trace);
  if (!ctx.assigneeAccountId) throw new JiraError(`Assignee '${assignee}' was not found in Jira [checked: ${trace.join("; ")}]. Jira hides private e-mail addresses: use the user's exact display name, or add \"email\":\"accountId\" to JIRA_USER_MAP. The user must also be assignable in the space`, 400, false);
  try { ctx.reporterAccountId = await lookupAccountId(rec.ReporterEmail, "Reporter", jiraProjectFor(rec)); } catch (e) { warnings.push(`Reporter lookup problem: ${(e as Error).message}`); }
  if (!ctx.reporterAccountId) warnings.push(`Reporter '${rec.ReporterEmail}' not found in Jira; ticket created with the API user as reporter`);

  const payload = buildIssuePayload(rec, ctx, linkOnly);
  let key = "";
  for (let attempt = 0; attempt < 4 && !key; attempt++) {
    const res = await jiraFetch("/rest/api/3/issue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) { key = ((await res.json()) as { key: string }).key; break; }
    const err = await toJiraError(res);
    const bad = Object.entries(err.fieldErrors).filter(([f, m]) => DROPPABLE.includes(f) && UNSETTABLE.test(m)).map(([f]) => f);
    if (res.status === 400 && cfg.lenientFields && bad.length && bad.length === Object.keys(err.fieldErrors).length) {
      for (const f of bad) { delete payload.fields[f]; warnings.push(`Jira refused optional field '${f}' (${err.fieldErrors[f]}); ticket created without it`); }
      continue;
    }
    if (err.fieldErrors?.project) err.message += ` [Hub sent project key '${(payload.fields.project as { key: string }).key}' to ${cfg.baseUrl} as ${cfg.email}]`;
    throw err;
  }
  if (!key) throw new JiraError("Jira did not accept the ticket after removing optional fields", 400, false);
  const att = await uploadAttachments(key, rec).catch((e) => [`Attachment step failed: ${(e as Error).message}`]);
  return { key, url: `${cfg.baseUrl}/browse/${key}`, warnings: [...warnings, ...att] };
}

/** Best-effort lookup of a Jira user's profile (used to find the e-mail address for a display name). Live mode only. */
export async function findJiraUser(ref: string, projectKey = ""): Promise<{ accountId: string; emailAddress?: string; displayName?: string } | undefined> {
  if (getConfig().jira.mode !== "live") return undefined;
  const urls = [
    projectKey ? `/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&query=${encodeURIComponent(ref)}&maxResults=50` : "",
    `/rest/api/3/user/search?query=${encodeURIComponent(ref)}`,
  ].filter(Boolean);
  const q = ref.trim().toLowerCase();
  for (const u of urls) {
    try {
      const r = await jiraFetch(u); if (!r.ok) continue;
      const users = ((await r.json()) as JUser[]).filter((x) => x.active !== false && x.accountType !== "app");
      const hit = users.find((x) => x.emailAddress?.toLowerCase() === q || x.displayName?.toLowerCase() === q) ?? (users.length === 1 ? users[0] : undefined);
      if (hit) return hit;
    } catch { /* try next */ }
  }
  return undefined;
}


/** Read-only self-test for the Jira connection: who the Hub is, whether it sees the project, and whether it may create issues. */
export async function diagnoseJira(projectKey = ""): Promise<Record<string, unknown>> {
  const cfg = getConfig().jira;
  const key = (projectKey || cfg.defaultProjectKey).trim();
  const out: Record<string, unknown> = { mode: cfg.mode, baseUrl: cfg.baseUrl, jiraEmailInEnv: cfg.email, projectKeyChecked: key };
  if (cfg.mode !== "live") { out.note = "MOCK mode: JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN are not all set, so nothing is sent to Jira."; return out; }
  const step = async (name: string, path: string, pick: (j: any) => unknown) => {  
    try { const r = await jiraFetch(path); const t = await r.text(); let j: unknown = null; try { j = JSON.parse(t); } catch { /* not json */ }
      out[name] = r.ok ? pick(j) : { httpStatus: r.status, body: t.slice(0, 300) }; } catch (e) { out[name] = { error: (e as Error).message }; }
  };
  await step("tokenOwner", "/rest/api/3/myself", (j) => ({ displayName: j.displayName, emailAddress: j.emailAddress ?? "(hidden)", accountId: j.accountId, locale: j.locale, active: j.active }));
  await step("project", `/rest/api/3/project/${encodeURIComponent(key)}`, (j) => ({ key: j.key, name: j.name, style: j.style, id: j.id }));
  await step("permissions", `/rest/api/3/mypermissions?projectKey=${encodeURIComponent(key)}&permissions=CREATE_ISSUES,BROWSE_PROJECTS,ASSIGN_ISSUES,CREATE_ATTACHMENTS`, (j) => Object.fromEntries(Object.entries(j.permissions ?? {}).map(([k, v]) => [k, (v as { havePermission: boolean }).havePermission])));
  await step("visibleProjectsForThisToken", "/rest/api/3/project/search?maxResults=50", (j) => (j.values ?? []).map((p: { key: string; name: string }) => `${p.key} (${p.name})`));
  return out;
}

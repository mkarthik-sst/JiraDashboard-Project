/**
 * Business workflow: ingestion -> dedup -> staging -> approve / reassign, plus the scheduler.
 * This is where status transitions are enforced. Edit here to change workflow rules.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import { findMatch, fingerprint } from "./dedup";
import { parseWorkbook, ExcelFormatError } from "./excel";
import { createJiraIssue, effectiveAssignee, JiraError } from "./jira";
import { log } from "./logger";
import { notifyApproved, notifyCancelled, notifyEngineering, notifyReassigned, notifyResubmitted, notifyReturnedToReporter, notifyStaged } from "./notify";
import { missingEngineeringFields } from "./engineering";
import { isUserRef, MAX_DESCRIPTION, MAX_SUMMARY, type DefectRecord, type HistoryEntry } from "./schema";
import { commit, getDb, markDirty } from "./store";
import { resolveAttachments, saveAdditionalFile, saveUploadedFile, sanitizeName } from "./attachments";
import { driveEnabled } from "./drive";
import type { ScheduledRun, UploadSummary } from "./types";

export class EngineError extends Error {
  constructor(message: string, public status = 400, public details: string[] = []) { super(message); this.name = "EngineError"; }
}

/* ------------------------------------------------------------------ ingestion */

export interface UploadedAttachment { name: string; data: Buffer }

/** Queue a local file for copying to the Google Drive folder (no-op when Drive storage is off). */
function queueDrive(drivePath: string, localPath: string, kind: "original" | "attachment", setId: string) {
  if (!driveEnabled()) return;
  const files = getDb().driveFiles;
  const ex = files.find((f) => f.drivePath === drivePath);
  if (ex) { ex.localPath = localPath; ex.pushedAt = ""; } else files.push({ drivePath, localPath, kind, setId, pushedAt: "" });
}

export async function ingest(buf: Buffer, fileName: string, mode: "immediate" | "scheduled", setId: string = randomUUID(), by = ""): Promise<UploadSummary> {
  const cfg = getConfig();
  let parsed;
  try { parsed = await parseWorkbook(buf, cfg.maxRowsPerFile); }
  catch (e) {
    if (e instanceof ExcelFormatError) {
      log("ERROR", `Rejected ${fileName}: ${e.message}`, { err: e });
      throw new EngineError(e.message, 422, e.details);
    }
    log("ERROR", `Unexpected failure parsing ${fileName}`, { err: e });
    throw new EngineError("Unexpected error while parsing the workbook.", 500, [(e as Error).message]);
  }
  const db = getDb();
  const summary: UploadSummary = {
    id: setId, at: new Date().toISOString(), fileName, mode, totalRows: parsed.totalRows,
    staged: 0, duplicates: 0, invalid: new Set(parsed.issues.map((i) => i.row)).size, issues: parsed.issues.slice(0, 200), warnings: parsed.warnings,
  };
  // keep the original upload (local copy + Google Drive) and name its tracking workbook
  const day = summary.at.slice(0, 10), safe = sanitizeName(fileName);
  const localOrig = path.join(cfg.dataDir, "uploads", `${setId}_${safe}`);
  fs.mkdirSync(path.dirname(localOrig), { recursive: true });
  fs.writeFileSync(localOrig, buf);
  if (driveEnabled()) {
    summary.originalDrivePath = `uploads/${day}/${setId}_${safe}`;
    summary.trackingDrivePath = `tracking/${day}/${setId}_${safe}`;
    queueDrive(summary.originalDrivePath, localOrig, "original", setId);
  }
  parsed.warnings.forEach((w) => log("WARNING", `${fileName}: ${w}`));
  const bad = new Map<number, string[]>();
  parsed.issues.forEach((i) => bad.set(i.row, [...(bad.get(i.row) ?? []), `${i.column} ${i.message}`]));
  bad.forEach((msgs, row) => log("ERROR", `${fileName} row ${row} rejected: ${msgs.join("; ")}`));

  const newRecords: DefectRecord[] = [];
  for (const { row, sourceRow } of parsed.rows) {
    const history = db.records.filter((r) => r.AssignApprovalStatus !== "Cancelled");   // a cancelled entry never blocks the same defect from being raised again
    const m = findMatch(row, history, cfg.dedupThreshold);
    if (m) markDirty(history.find((r) => r.id === m.id)?.uploadId ?? "");
    if (m) {
      const orig = history.find((r) => r.id === m.id)!;
      orig.DuplicateOccurrenceCount += 1;
      summary.duplicates++;
      db.duplicates.push({
        id: randomUUID(), at: new Date().toISOString(), summary: row.Summary, score: Number(m.score.toFixed(3)), kind: m.kind,
        matchedRecordId: orig.id, matchedJiraId: orig.JiraTicketID, newCount: orig.DuplicateOccurrenceCount, sourceFile: fileName, sourceRow,
      });
      log("WARNING", `Duplicate suppressed (${m.kind} ${(m.score * 100).toFixed(0)}%): "${row.Summary.slice(0, 70)}" matches ${orig.JiraTicketID || "pending record"}; DuplicateOccurrenceCount=${orig.DuplicateOccurrenceCount}`, { recordId: orig.id });
      continue;
    }
    const attachments = resolveAttachments(row.AttachmentPaths, setId);
    const missing = attachments.filter((a) => !a.exists);
    missing.forEach((a) => log("WARNING", `${fileName} row ${sourceRow}: attachment "${a.name}" ${a.note}`));
    attachments.filter((a) => a.exists && a.kind === "file").forEach((a) => queueDrive(`attachments/${setId}/${a.name}`, path.join(cfg.dataDir, "attachments", setId, a.name), "attachment", setId));
    const staged: DefectRecord = {
      ...row, id: randomUUID(), fingerprint: fingerprint(row.Summary, row.Description), sourceFile: fileName, sourceRow, uploadId: setId,
      createdAt: new Date().toISOString(), lastError: "", lastErrorStack: "", jiraUrl: "", processingMs: 0,
      lastWarning: [missing.length ? `${missing.length} attachment(s) not found: ${missing.map((a) => a.name).join(", ")}` : "",
        missingEngineeringFields(row).length ? `Engineering details missing (needed before approval): ${missingEngineeringFields(row).join(", ")}` : ""].filter(Boolean).join(" | "), attachments,
      uploadedBy: by, history: [{ id: randomUUID(), at: new Date().toISOString(), by: by || "uploader", kind: "uploaded", note: `${fileName} row ${sourceRow}` }],
    };
    db.records.push(staged); newRecords.push(staged);
    summary.staged++;
    log("SUCCESS", `Staged for approval: "${row.Summary.slice(0, 80)}" (${fileName} row ${sourceRow})`);
  }
  db.uploads.push(summary);
  markDirty(setId);
  commit();
  void notifyStaged(newRecords, fileName);          // background e-mail to each assignee (never blocks the upload)
  log(summary.invalid ? "WARNING" : "SUCCESS", `Ingested ${fileName}: ${summary.staged} staged, ${summary.duplicates} duplicates suppressed, ${summary.invalid} invalid row(s)`);
  return summary;
}

/** Immediate => ingest now. Scheduled => validate headers now (fail fast), store file, run at runAt. */
export async function submitUpload(buf: Buffer, fileName: string, mode: "immediate" | "scheduled", runAt?: string, files: UploadedAttachment[] = [], by = "") {
  if (buf.length > getConfig().maxUploadBytes) throw new EngineError("File exceeds the 10 MB limit.", 413);
  if (!/\.xlsx$/i.test(fileName)) throw new EngineError("Only .xlsx workbooks are supported.", 415);
  const max = getConfig().attachments;
  if (files.length > max.maxFiles) throw new EngineError(`Too many attachment files (max ${max.maxFiles}).`, 413);
  const big = files.find((f) => f.data.length > max.maxBytes);
  if (big) throw new EngineError(`Attachment ${big.name} exceeds ${max.maxBytes / 1048576} MB.`, 413);
  const setId = randomUUID();
  const saveFiles = () => files.forEach((f) => saveUploadedFile(setId, f.name, f.data));
  if (mode === "immediate") {
    saveFiles();
    return { summary: await ingest(buf, fileName, "immediate", setId, by), scheduled: null };
  }

  const when = runAt ? new Date(runAt) : null;
  if (!when || Number.isNaN(when.getTime())) throw new EngineError("A valid run date/time is required for scheduled ingestion.", 400);
  if (when.getTime() < Date.now() - 30000) throw new EngineError("Scheduled time is in the past.", 400);
  try { await parseWorkbook(buf, getConfig().maxRowsPerFile); }
  catch (e) {
    if (e instanceof ExcelFormatError) { log("ERROR", `Rejected scheduled file ${fileName}: ${e.message}`, { err: e }); throw new EngineError(e.message, 422, e.details); }
    throw e;
  }
  saveFiles();
  const id = randomUUID();
  const dir = path.join(getConfig().dataDir, "scheduled");
  fs.mkdirSync(dir, { recursive: true });
  const storedPath = path.join(dir, `${id}.xlsx`);
  fs.writeFileSync(storedPath, buf);
  const run: ScheduledRun = { id, fileName, runAt: when.toISOString(), createdAt: new Date().toISOString(), storedPath, status: "SCHEDULED", resultMessage: "", setId, by };
  getDb().scheduled.push(run);
  commit();
  log("INFO", `Scheduled ${fileName} for ${run.runAt}`);
  return { summary: null, scheduled: run };
}

let ticking = false;
export async function runDueSchedules() {
  if (ticking) return; ticking = true;
  try {
    const due = getDb().scheduled.filter((s) => s.status === "SCHEDULED" && new Date(s.runAt).getTime() <= Date.now());
    for (const run of due) {
      run.status = "RUNNING"; commit();
      log("INFO", `Scheduled run started: ${run.fileName}`);
      try {
        const s = await ingest(fs.readFileSync(run.storedPath), run.fileName, "scheduled", run.setId, run.by ?? "");
        run.status = "COMPLETED"; run.resultMessage = `${s.staged} staged, ${s.duplicates} duplicates, ${s.invalid} invalid`;
        try { fs.unlinkSync(run.storedPath); } catch { /* keep */ }
      } catch (e) {
        run.status = "FAILED"; run.resultMessage = (e as Error).message;
        log("ERROR", `Scheduled run failed for ${run.fileName}: ${run.resultMessage}`, { err: e });
      }
      commit();
    }
  } finally { ticking = false; }
}

export function cancelSchedule(id: string) {
  const run = getDb().scheduled.find((s) => s.id === id);
  if (!run) throw new EngineError("Scheduled run not found.", 404);
  if (run.status !== "SCHEDULED") throw new EngineError(`Cannot cancel a run that is ${run.status}.`, 409);
  run.status = "CANCELLED";
  try { fs.unlinkSync(run.storedPath); } catch { /* ignore */ }
  commit(); log("INFO", `Scheduled run cancelled: ${run.fileName}`);
}

/* ------------------------------------------------------------------ human-in-the-loop */

const inflight = new Set<string>();
const find = (id: string) => {
  const r = getDb().records.find((x) => x.id === id);
  if (!r) throw new EngineError("Record not found.", 404);
  return r;
};

const addHistory = (rec: DefectRecord, e: Omit<HistoryEntry, "id" | "at">) => { (rec.history ??= []).push({ id: randomUUID(), at: new Date().toISOString(), ...e }); rec.history = rec.history.slice(-100); };

export async function approve(id: string, by = ""): Promise<DefectRecord> {
  const rec = find(id);
  if (rec.AssignApprovalStatus === "Approved" || rec.JiraTicketID) throw new EngineError(`Already approved (${rec.JiraTicketID}).`, 409);
  if (rec.AssignApprovalStatus === "Cancelled") throw new EngineError("This entry was cancelled, so no Jira ticket can be created for it.", 409);
  if (rec.AssignApprovalStatus === "Reporter Review") throw new EngineError("This defect is with the reporter for review. It can be approved after the reporter sends it back for approval.", 409);
  const lacking = missingEngineeringFields(rec);
  if (lacking.length) throw new EngineError(`Engineering details are missing: ${lacking.join(", ")}. Open the defect, fill them in (pencil marks) or return it to the reporter, then approve.`, 422, lacking.map((c) => `${c} is required`));
  if (inflight.has(id)) throw new EngineError("Approval already in progress for this record.", 409);
  inflight.add(id);
  const t0 = Date.now();
  try {
    log("INFO", `Dispatching Jira create for "${rec.Summary.slice(0, 70)}" -> assignee ${effectiveAssignee(rec)}`, { recordId: id });
    const res = await createJiraIssue(rec);
    rec.JiraTicketID = res.key; rec.jiraUrl = res.url;
    rec.AssignApprovalStatus = "Approved"; rec.ExecutionStatus = "PROCESSED";
    rec.ProcessedAt = new Date().toISOString(); rec.processingMs = Date.now() - t0;
    if (rec.ReassignStatus === "In Progress") rec.ReassignStatus = "Approved";
    rec.lastError = ""; rec.lastErrorStack = ""; rec.lastWarning = res.warnings.join(" | ");
    addHistory(rec, { by: by || "approver", kind: "approved", note: res.key });
    markDirty(rec.uploadId);
    commit();
    res.warnings.forEach((w) => log("WARNING", `${res.key}: ${w}`, { recordId: id }));
    log("SUCCESS", `Jira ticket ${res.key} created (${rec.processingMs}ms) - reassignment locked`, { recordId: id });
    void notifyApproved(rec);
    void notifyEngineering(rec);
    return rec;
  } catch (e) {
    rec.ExecutionStatus = "FAILED"; rec.processingMs = Date.now() - t0;
    rec.lastError = (e as Error).message; rec.lastErrorStack = (e as Error).stack ?? "";
    markDirty(rec.uploadId);
    commit();
    log("ERROR", `Jira create failed for "${rec.Summary.slice(0, 60)}": ${rec.lastError}`, { err: e, recordId: id });
    const status = e instanceof JiraError && e.status >= 400 && e.status < 500 ? 422 : 502;
    throw new EngineError(rec.lastError, status, e instanceof JiraError ? e.details : []);
  } finally { inflight.delete(id); }
}

export async function reassign(id: string, newEmail: string, note = "", by = ""): Promise<DefectRecord> {
  const rec = find(id);
  const ref = (newEmail ?? "").trim();
  const email = ref.includes("@") ? ref.toLowerCase() : ref;
  if (rec.AssignApprovalStatus === "Approved" || rec.JiraTicketID) throw new EngineError("Reassignment is permanently disabled after approval.", 409);
  if (rec.AssignApprovalStatus === "Cancelled") throw new EngineError("This entry was cancelled and cannot be reassigned.", 409);
  if (inflight.has(id)) throw new EngineError("Record is being processed.", 409);
  if (rec.AssignApprovalStatus === "Reporter Review") throw new EngineError("This defect is with the reporter for review. Reassign it after it comes back.", 409);
  if (!isUserRef(email)) throw new EngineError("A valid assignee email or user name is required.", 400);
  if (email === effectiveAssignee(rec).toLowerCase()) throw new EngineError("New assignee is the same as the current assignee.", 400);
  const previous = effectiveAssignee(rec);
  rec.ReassignedToEmail = email; rec.AssignApprovalStatus = "Changed Assignee"; rec.ReassignStatus = "In Progress";
  addHistory(rec, { by: by || "approver", kind: "reassigned", note: `${previous} -> ${email}${note ? `: ${note}` : ""}` });
  markDirty(rec.uploadId);
  commit();
  log("INFO", `Reassigned "${rec.Summary.slice(0, 60)}" ${previous} -> ${email}`, { recordId: id });
  void notifyReassigned(rec, previous, note);          // background e-mail to the NEW assignee
  return rec;
}

/* ------------------------------------------------------------------ edits, documents, reporter review */

const OPEN_STATES = ["In Progress", "Changed Assignee", "Reporter Review"];
const openRecord = (id: string) => {
  const rec = find(id);
  if (rec.AssignApprovalStatus === "Approved" || rec.JiraTicketID) throw new EngineError("This defect is already approved and can no longer be changed.", 409);
  if (rec.AssignApprovalStatus === "Cancelled") throw new EngineError("This entry was cancelled and can no longer be changed.", 409);
  if (inflight.has(id)) throw new EngineError("Record is being processed.", 409);
  if (!OPEN_STATES.includes(rec.AssignApprovalStatus)) throw new EngineError("Record cannot be changed in its current state.", 409);
  return rec;
};
const clip = (v: string) => (v.length > 200 ? `${v.slice(0, 200)}...` : v);

export interface RecordPatch { Summary?: string; Description?: string; IssueType?: string; Priority?: string; Lead?: string; AttachmentPaths?: string;
  AutomatedFix?: string; FixRuleId?: string; RootCause?: string; Impact?: string; Prerequisites?: string; DependentSources?: string }
const EDITABLE: Record<keyof RecordPatch, string> = { Summary: "Summary", Description: "Description", IssueType: "Issue Type", Priority: "Priority", Lead: "Project lead", AttachmentPaths: "AttachmentPaths",
  AutomatedFix: "Automated fix issue", FixRuleId: "Fix / Rule ID", RootCause: "Root cause", Impact: "Impact", Prerequisites: "Prerequisites", DependentSources: "Dependent data sources" };

/** Approver / reporter corrects Summary, Description, Issue Type, Priority, Project lead or AttachmentPaths before approval. */
export function editRecord(id: string, patch: RecordPatch, by = ""): DefectRecord {
  const rec = openRecord(id);
  const changes: { field: string; from: string; to: string }[] = [];
  const errors: string[] = [];
  for (const k of Object.keys(patch) as (keyof RecordPatch)[]) {
    if (!(k in EDITABLE)) throw new EngineError(`Field '${k}' cannot be edited.`, 400);
    const v = String(patch[k] ?? "").replace(/\r\n/g, "\n").trim();
    if (["Summary", "Description", "IssueType", "Priority"].includes(k) && !v) errors.push(`${EDITABLE[k]} cannot be empty`);
    if (k === "Summary" && v.length > MAX_SUMMARY) errors.push(`Summary exceeds ${MAX_SUMMARY} characters`);
    if (k === "Description" && v.length > MAX_DESCRIPTION) errors.push(`Description exceeds ${MAX_DESCRIPTION} characters`);
    if ((k === "IssueType" || k === "Priority") && v.length > 60) errors.push(`${EDITABLE[k]} is too long`);
    if (k === "Lead" && v.length > 200) errors.push("Project lead is too long");
    if (k === "AutomatedFix") { if (!/^(yes|no)$/i.test(v)) errors.push("Automated fix issue must be Yes or No"); (patch as Record<string, string>)[k] = /^yes$/i.test(v) ? "Yes" : "No"; }
    if (k === "FixRuleId" && v.length > 120) errors.push("Fix / Rule ID is too long (max 120 characters)");
    if (["RootCause", "Impact", "Prerequisites", "DependentSources"].includes(k) && v.length > 4000) errors.push(`${EDITABLE[k]} exceeds 4000 characters`);
    if (k === "AttachmentPaths") for (const p of v.split("|").map((x) => x.trim()).filter(Boolean)) if (!/^https?:\/\//i.test(p) && p.split(/[\\/]/).includes("..")) errors.push(`'${p}' must not contain '..'`);
    const nv = k === "AutomatedFix" ? (/^yes$/i.test(v) ? "Yes" : "No") : v;
    if (nv !== String(rec[k] ?? "")) changes.push({ field: EDITABLE[k], from: clip(String(rec[k] ?? "")), to: clip(nv) });
    (patch as Record<string, string>)[k] = nv;
  }
  if (errors.length) throw new EngineError(errors.join("; "), 422);
  if (!changes.length) return rec;
  Object.assign(rec, patch);
  rec.fingerprint = fingerprint(rec.Summary, rec.Description);
  { const rest = rec.lastWarning.split(" | ").filter((x) => x && !x.startsWith("Engineering details missing")); const miss = missingEngineeringFields(rec);
    rec.lastWarning = [...rest, ...(miss.length ? [`Engineering details missing (needed before approval): ${miss.join(", ")}`] : [])].join(" | "); }
  if ("AttachmentPaths" in patch) refreshAttachments(rec);
  rec.ExecutionStatus = rec.ExecutionStatus === "FAILED" ? "PENDING" : rec.ExecutionStatus; rec.lastError = ""; rec.lastErrorStack = "";
  addHistory(rec, { by: by || "user", kind: "edited", changes });
  markDirty(rec.uploadId); commit();
  log("INFO", `Edited "${rec.Summary.slice(0, 60)}": ${changes.map((c) => c.field).join(", ")}${by ? ` (by ${by})` : ""}`, { recordId: id });
  return rec;
}

function refreshAttachments(rec: DefectRecord) {
  const cfg = getConfig();
  rec.attachments = resolveAttachments(rec.AttachmentPaths, rec.uploadId);
  const missing = rec.attachments.filter((a) => !a.exists);
  const eng = rec.lastWarning.split(" | ").filter((x) => x.startsWith("Engineering details missing"));
  rec.lastWarning = [missing.length ? `${missing.length} attachment(s) not found: ${missing.map((a) => a.name).join(", ")}` : "", ...eng].filter(Boolean).join(" | ");
  rec.attachments.filter((a) => a.exists && a.kind === "file").forEach((a) => queueDrive(`attachments/${rec.uploadId}/${a.name}`, path.join(cfg.dataDir, "attachments", rec.uploadId, a.name), "attachment", rec.uploadId));
}

/** Add extra documents (images / Word / Excel / PDF ...) to ONE defect; their names are appended to AttachmentPaths. */
export function addDocuments(id: string, files: UploadedAttachment[], by = ""): DefectRecord {
  const rec = openRecord(id);
  const max = getConfig().attachments;
  if (!files.length) throw new EngineError("Choose at least one file.", 400);
  if (files.length > max.maxFiles) throw new EngineError(`Too many files (max ${max.maxFiles}).`, 413);
  const big = files.find((f) => f.data.length > max.maxBytes);
  if (big) throw new EngineError(`${big.name} exceeds ${max.maxBytes / 1048576} MB.`, 413);
  const names = files.map((f) => saveAdditionalFile(rec.uploadId, f.name, f.data));
  rec.AttachmentPaths = [rec.AttachmentPaths, ...names].filter(Boolean).join("|");
  refreshAttachments(rec);
  addHistory(rec, { by: by || "user", kind: "documents", note: `Added ${names.join(", ")}` });
  markDirty(rec.uploadId); commit();
  log("INFO", `Added ${names.length} document(s) to "${rec.Summary.slice(0, 60)}": ${names.join(", ")}`, { recordId: id });
  return rec;
}

/** Approver sends the defect back to the reporter with a comment (status "Reporter Review"); the reporter is e-mailed. */
export function returnToReporter(id: string, note: string, by = ""): DefectRecord {
  const rec = openRecord(id);
  const text = (note ?? "").trim();
  if (rec.AssignApprovalStatus === "Reporter Review") throw new EngineError("This defect is already with the reporter.", 409);
  if (!text) throw new EngineError("Please write a comment so the reporter knows what to review.", 400);
  if (text.length > 2000) throw new EngineError("The comment is too long (max 2000 characters).", 400);
  rec.AssignApprovalStatus = "Reporter Review";
  addHistory(rec, { by: by || "approver", kind: "returned", note: text });
  markDirty(rec.uploadId); commit();
  log("INFO", `Returned to reporter ${rec.ReporterEmail}: "${rec.Summary.slice(0, 60)}"`, { recordId: id });
  void notifyReturnedToReporter(rec, text, by);
  return rec;
}

/** Reporter has reviewed / corrected the defect and sends it for approval again - to the SAME assignee, with an optional comment. */
export function resubmit(id: string, note = "", by = ""): DefectRecord {
  const rec = openRecord(id);
  if (rec.AssignApprovalStatus !== "Reporter Review") throw new EngineError("This defect is not waiting for the reporter.", 409);
  const text = (note ?? "").trim();
  if (text.length > 2000) throw new EngineError("The comment is too long (max 2000 characters).", 400);
  rec.AssignApprovalStatus = rec.ReassignedToEmail ? "Changed Assignee" : "In Progress";
  addHistory(rec, { by: by || "reporter", kind: "resubmitted", note: text });
  markDirty(rec.uploadId); commit();
  log("INFO", `Sent for approval again to ${effectiveAssignee(rec)}: "${rec.Summary.slice(0, 60)}"`, { recordId: id });
  void notifyResubmitted(rec, text, by);
  return rec;
}

/** Cancel an entry that must not become a Jira ticket. A reason is required; a cancelled entry can no longer be approved, edited or reassigned,
 *  appears on the "Cancelled" tab and is ignored by duplicate detection (the same defect can be uploaded again later). */
export function cancelRecord(id: string, reason: string, by = ""): DefectRecord {
  const rec = find(id);
  if (rec.AssignApprovalStatus === "Cancelled") throw new EngineError("This entry is already cancelled.", 409);
  if (rec.AssignApprovalStatus === "Approved" || rec.JiraTicketID) throw new EngineError(`This defect is already approved (${rec.JiraTicketID}); a Jira ticket exists, so it cannot be cancelled here. Close the ticket in Jira instead.`, 409);
  if (inflight.has(id)) throw new EngineError("Record is being processed.", 409);
  const text = (reason ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length < 3) throw new EngineError("Please give a short reason for cancelling (at least 3 characters).", 400);
  if (text.length > 2000) throw new EngineError("The reason is too long (max 2000 characters).", 400);
  const was = rec.AssignApprovalStatus;
  rec.AssignApprovalStatus = "Cancelled"; rec.ExecutionStatus = "CANCELLED"; rec.CancelReason = text;
  rec.ProcessedAt = new Date().toISOString(); rec.lastError = ""; rec.lastErrorStack = "";
  addHistory(rec, { by: by || "user", kind: "cancelled", note: `${text} (was: ${was})` });
  markDirty(rec.uploadId); commit();
  log("WARNING", `Cancelled "${rec.Summary.slice(0, 60)}" by ${by || "user"}: ${text}. No Jira ticket will be created.`, { recordId: id });
  void notifyCancelled(rec, text, by);
  return rec;
}

/* ------------------------------------------------------------------ read models */

export function stats() {
  const db = getDb();
  const rs = db.records;
  return {
    pending: rs.filter((r) => r.AssignApprovalStatus === "In Progress").length,
    reassigned: rs.filter((r) => r.AssignApprovalStatus === "Changed Assignee").length,
    reporterReview: rs.filter((r) => r.AssignApprovalStatus === "Reporter Review").length,
    approved: rs.filter((r) => r.AssignApprovalStatus === "Approved").length,
    cancelled: rs.filter((r) => r.AssignApprovalStatus === "Cancelled").length,
    scheduled: db.scheduled.filter((s) => s.status === "SCHEDULED").length,
    preventedDuplicates: rs.reduce((a, r) => a + r.DuplicateOccurrenceCount, 0),
    failed: rs.filter((r) => r.ExecutionStatus === "FAILED" && r.AssignApprovalStatus !== "Approved" && r.AssignApprovalStatus !== "Cancelled").length,
    total: rs.length,
  };
}

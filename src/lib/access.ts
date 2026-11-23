/** Who may act on a defect. Only enforced with AUTH_MODE=email AND AUTH_ENFORCE_OWNER=true (administrators always may). */
import { actorOf, authMode, enforceOwner, isAdmin } from "./auth";
import { EngineError } from "./engine";
import { resolveRecipient } from "./notify";
import { getDb } from "./store";

export type Role = "approver" | "reporter" | "either";
export async function assertMay(req: Request, recordId: string, role: Role): Promise<string> {
  const who = await actorOf(req);
  if (authMode() === "none" || !enforceOwner() || isAdmin(who)) return who;
  const rec = getDb().records.find((r) => r.id === recordId);
  if (!rec) throw new EngineError("Record not found.", 404);
  const approver = (await resolveRecipient(rec.ReassignedToEmail || rec.AssigneeEmail, rec.ProjectKey))?.email;
  const reporter = (await resolveRecipient(rec.ReporterEmail, rec.ProjectKey))?.email;
  const me = who.toLowerCase();
  const ok = role === "approver" ? approver === me : role === "reporter" ? reporter === me : approver === me || reporter === me;
  if (!ok) throw new EngineError(role === "reporter" ? "Only the reporter of this defect can do this." : role === "approver" ? "Only the assignee of this defect can do this." : "Only the assignee or the reporter of this defect can do this.", 403);
  return who;
}

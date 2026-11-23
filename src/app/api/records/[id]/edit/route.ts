import { NextResponse } from "next/server";
import { editRecord, EngineError, type RecordPatch } from "@/lib/engine";
import { assertMay } from "@/lib/access";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { Summary?, Description?, IssueType?, Priority?, Lead?, AttachmentPaths? } */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => null)) as RecordPatch | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new EngineError("Request body must be a JSON object with the fields to change.", 400);
    const by = await assertMay(req, params.id, "either");
    return NextResponse.json({ record: editRecord(params.id, body, by) });
  } catch (e) { return fail(e); }
}

import { NextResponse } from "next/server";
import { returnToReporter, EngineError } from "@/lib/engine";
import { assertMay } from "@/lib/access";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { note } -> status "Reporter Review"; the reporter is e-mailed with the comment. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => null)) as { note?: string } | null;
    if (!body || typeof body.note !== "string") throw new EngineError("Request body must be JSON: { note }", 400);
    const by = await assertMay(req, params.id, "approver");
    return NextResponse.json({ record: returnToReporter(params.id, body.note, by) });
  } catch (e) { return fail(e); }
}

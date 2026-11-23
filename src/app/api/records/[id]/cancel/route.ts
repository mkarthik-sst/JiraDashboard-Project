import { NextResponse } from "next/server";
import { cancelRecord, EngineError } from "@/lib/engine";
import { assertMay } from "@/lib/access";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { reason } -> status "Cancelled": no Jira ticket can be created for the entry any more. The assignee and reporter are e-mailed. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => null)) as { reason?: string } | null;
    if (!body || typeof body.reason !== "string") throw new EngineError("Request body must be JSON: { reason }", 400);
    const by = await assertMay(req, params.id, "either");
    return NextResponse.json({ record: cancelRecord(params.id, body.reason, by) });
  } catch (e) { return fail(e); }
}

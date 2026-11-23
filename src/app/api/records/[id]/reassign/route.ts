import { NextResponse } from "next/server";
import { reassign, EngineError } from "@/lib/engine";
import { assertMay } from "@/lib/access";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: string; note?: string } | null;
    if (!body || typeof body.email !== "string") throw new EngineError("Request body must be JSON: { email, note? }", 400);
    const by = await assertMay(req, params.id, "approver");
    return NextResponse.json({ record: await reassign(params.id, body.email, body.note ?? "", by) });
  } catch (e) { return fail(e); }
}

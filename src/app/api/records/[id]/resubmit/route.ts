import { NextResponse } from "next/server";
import { resubmit } from "@/lib/engine";
import { assertMay } from "@/lib/access";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { note? } -> back to Pending Approvals / Reassigned for the same assignee; the assignee is e-mailed with the optional comment. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as { note?: string };
    const by = await assertMay(req, params.id, "reporter");
    return NextResponse.json({ record: resubmit(params.id, body.note ?? "", by) });
  } catch (e) { return fail(e); }
}

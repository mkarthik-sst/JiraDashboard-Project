import { NextResponse } from "next/server";
import { approve } from "@/lib/engine";
import { assertMay } from "@/lib/access";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try { const by = await assertMay(req, params.id, "approver"); return NextResponse.json({ record: await approve(params.id, by) }); } catch (e) { return fail(e); }
}

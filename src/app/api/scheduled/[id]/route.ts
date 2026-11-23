import { NextResponse } from "next/server";
import { cancelSchedule } from "@/lib/engine";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try { cancelSchedule(params.id); return NextResponse.json({ ok: true }); } catch (e) { return fail(e); }
}

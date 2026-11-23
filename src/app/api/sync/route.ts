import { NextResponse } from "next/server";
import { getSyncStatus, runSync } from "@/lib/sync";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() { return NextResponse.json(getSyncStatus()); }
export async function POST() {
  try { return NextResponse.json(await runSync()); } catch (e) { return fail(e); }
}

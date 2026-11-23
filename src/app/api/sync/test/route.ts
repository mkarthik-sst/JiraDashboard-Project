import { NextResponse } from "next/server";
import { testDrive } from "@/lib/sync";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Opens the shared Google Drive folder and writes state/connection-test.txt to prove the sign-in + folder permissions work. */
export async function POST() {
  try { return NextResponse.json({ ok: true, ...(await testDrive()) }); } catch (e) { return fail(e); }
}

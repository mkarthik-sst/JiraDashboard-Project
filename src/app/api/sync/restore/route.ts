import { NextResponse } from "next/server";
import { restoreFromDrive } from "@/lib/sync";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Rebuild the dashboard from state/store.json in the Google Drive folder (replaces the local store). */
export async function POST() {
  try { return NextResponse.json(await restoreFromDrive()); } catch (e) { return fail(e); }
}

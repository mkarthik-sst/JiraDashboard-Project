import { NextRequest, NextResponse } from "next/server";
import { sendTestMail } from "@/lib/notify";
import { fail } from "@/lib/http";
import { EngineError } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { "to": "you@company.com" } -> sends a test e-mail with the configured SMTP settings. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { to?: string };
    try { const e = await sendTestMail(body.to ?? ""); return NextResponse.json({ ok: true, to: e.to }); }
    catch (e) { throw new EngineError((e as Error).message, 400); }
  } catch (e) { return fail(e); }
}

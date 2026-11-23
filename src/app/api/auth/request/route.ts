import { NextResponse } from "next/server";
import { authMode, authSecret, emailAllowed, linkMinutes, signToken } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { log } from "@/lib/logger";
import { sendLoginMail } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const last = new Map<string, number>();

/** POST { email } -> mails a one-time sign-in link. The answer is always the same so nobody can probe which addresses are allowed. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const generic = NextResponse.json({ ok: true, message: "If this address is allowed, a sign-in link was sent. It can take a minute." });
  if (authMode() !== "email") return NextResponse.json({ error: "Sign-in is not enabled (AUTH_MODE)" }, { status: 400 });
  if (!authSecret()) return NextResponse.json({ error: "AUTH_SECRET is not set" }, { status: 503 });
  if (!emailAllowed(email)) { log("WARNING", `Sign-in link refused for ${email.slice(0, 60) || "(empty)"} - address not allowed`); return generic; }
  const now = Date.now();
  if ((last.get(email) ?? 0) > now - 30000) return generic;       // one link per 30 s per address
  last.set(email, now);
  try {
    const token = await signToken({ t: "login", e: email, exp: now + linkMinutes() * 60000 });
    await sendLoginMail(email, `${getConfig().mail.appBaseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`, linkMinutes());
    log("INFO", `Sign-in link sent to ${email}`);
  } catch (e) { log("ERROR", `Sign-in link to ${email} failed: ${(e as Error).message}`); return NextResponse.json({ error: `Could not send the sign-in mail: ${(e as Error).message}` }, { status: 502 }); }
  return generic;
}

import { NextResponse } from "next/server";
import { COOKIE, emailAllowed, sessionHours, signToken, verifyToken } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET ?token=... (from the e-mail) -> sets the session cookie and opens the dashboard. */
export async function GET(req: Request) {
  const base = getConfig().mail.appBaseUrl;
  const t = await verifyToken(new URL(req.url).searchParams.get("token") ?? "", "login");
  if (!t || !emailAllowed(t.e)) return NextResponse.redirect(`${base}/login?error=expired`);
  const session = await signToken({ t: "session", e: t.e, exp: Date.now() + sessionHours() * 3600000 });
  const res = NextResponse.redirect(`${base}/`);
  res.cookies.set(COOKIE, session, { httpOnly: true, sameSite: "lax", secure: base.startsWith("https://"), path: "/", maxAge: sessionHours() * 3600 });
  log("INFO", `${t.e} signed in`);
  return res;
}

import { NextResponse } from "next/server";
import { authMode, canOpenDrive, sessionOf } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const s = await sessionOf(req);
  return NextResponse.json({ auth: authMode(), signedIn: !!s, email: s?.email ?? "", admin: !!s?.admin, repoLink: s ? canOpenDrive(s.email) || (authMode() === "none") : false });
}

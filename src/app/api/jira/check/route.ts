import { NextResponse } from "next/server";
import { diagnoseJira } from "@/lib/jira";

export const dynamic = "force-dynamic";

/** GET /api/jira/check?project=JAIT - shows which Jira account/site the Hub uses and what it may do. Never returns the token. */
export async function GET(req: Request) {
  const project = new URL(req.url).searchParams.get("project") ?? "";
  return NextResponse.json(await diagnoseJira(project), { status: 200 });
}

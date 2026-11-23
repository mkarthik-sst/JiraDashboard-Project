import { NextRequest } from "next/server";
import { buildMasterWorkbook } from "@/lib/excel";
import { getDb } from "@/lib/store";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status") ?? "all";
    const rows = getDb().records.filter((r) => status === "all" || r.AssignApprovalStatus === status);
    const buf = await buildMasterWorkbook(rows);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="CleanCore_Defects_${status === "all" ? "ALL" : status.replace(/\s+/g, "")}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (e) { return fail(e); }
}

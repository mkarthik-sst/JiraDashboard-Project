import { NextRequest } from "next/server";
import { buildTemplate } from "@/lib/excel";
import { buildSampleWorkbook } from "@/lib/sample";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sample = req.nextUrl.searchParams.get("sample") === "1";
    const buf = sample ? await buildSampleWorkbook(req.nextUrl.searchParams.get("dup") === "1") : await buildTemplate();
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${sample ? "CleanCore_Defects_SAMPLE.xlsx" : "CleanCore_Defects_Template.xlsx"}"`,
      },
    });
  } catch (e) { return fail(e); }
}

import { NextRequest, NextResponse } from "next/server";
import { recurrenceReport } from "@/lib/engineering";
import { buildRecurrenceWorkbook } from "@/lib/excel";
import { getDb } from "@/lib/store";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Recurrence report by Fix / Rule ID. JSON by default, ?format=xlsx downloads it as an Excel file. */
export async function GET(req: NextRequest) {
  try {
    const rep = recurrenceReport(getDb().records);
    if (req.nextUrl.searchParams.get("format") === "xlsx") {
      const buf = await buildRecurrenceWorkbook(rep);
      return new Response(new Uint8Array(buf), { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Recurrence_Report_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      } });
    }
    return NextResponse.json(rep);
  } catch (e) { return fail(e); }
}

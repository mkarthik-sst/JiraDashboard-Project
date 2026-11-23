import { NextRequest, NextResponse } from "next/server";
import { EngineError, submitUpload } from "@/lib/engine";
import { fail } from "@/lib/http";
import { actorOf } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    let form: FormData;
    try { form = await req.formData(); } catch { throw new EngineError("Expected multipart/form-data with a 'file' field.", 400); }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new EngineError("No file provided (or file is empty).", 400);
    const mode = form.get("mode") === "scheduled" ? "scheduled" : "immediate";
    const runAt = typeof form.get("runAt") === "string" ? (form.get("runAt") as string) : undefined;
    const files: { name: string; data: Buffer }[] = [];
    for (const f of form.getAll("attachments")) if (f instanceof File && f.size > 0) files.push({ name: f.name, data: Buffer.from(await f.arrayBuffer()) });
    const out = await submitUpload(Buffer.from(await file.arrayBuffer()), file.name, mode, runAt, files, await actorOf(req));
    return NextResponse.json(out);
  } catch (e) { return fail(e); }
}

import { NextResponse } from "next/server";
import { addDocuments, EngineError } from "@/lib/engine";
import { assertMay } from "@/lib/access";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** multipart/form-data, field "files" (one or more) -> added to this defect's AttachmentPaths. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    let form: FormData;
    try { form = await req.formData(); } catch { throw new EngineError("Expected multipart/form-data with 'files'.", 400); }
    const files: { name: string; data: Buffer }[] = [];
    for (const f of form.getAll("files")) if (f instanceof File && f.size > 0) files.push({ name: f.name, data: Buffer.from(await f.arrayBuffer()) });
    const by = await assertMay(req, params.id, "either");
    return NextResponse.json({ record: addDocuments(params.id, files, by) });
  } catch (e) { return fail(e); }
}

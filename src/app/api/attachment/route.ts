import { NextRequest } from "next/server";
import { inlineOk, isSetId, mimeFor, readStored, sanitizeName } from "@/lib/attachments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Serves a stored attachment for review. Only images/PDF open inline; everything else downloads. */
export async function GET(req: NextRequest) {
  const set = req.nextUrl.searchParams.get("set") ?? "";
  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!isSetId(set) || !name || name !== sanitizeName(name)) return new Response("Bad request", { status: 400 });
  const data = await readStored(set, name);
  if (!data) return new Response("Attachment not found", { status: 404 });
  const inline = inlineOk(name);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mimeFor(name),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=60",
    },
  });
}

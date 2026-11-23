import { NextResponse } from "next/server";
import { EngineError } from "./engine";
import { log } from "./logger";

export function fail(e: unknown) {
  if (e instanceof EngineError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  log("ERROR", `Unhandled API error: ${(e as Error).message}`, { err: e });
  return NextResponse.json({ error: "Internal server error", details: [(e as Error).message] }, { status: 500 });
}

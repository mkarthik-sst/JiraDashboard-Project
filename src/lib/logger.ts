/** In-memory ring buffer + file log. The UI drawer polls /api/state for entries after its last seq. */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import type { LogEntry, LogLevel } from "./types";

const MAX = 1000;
const g = globalThis as unknown as { __chLog?: { seq: number; buf: LogEntry[] } };
const state = (g.__chLog ??= { seq: 0, buf: [] });

export function log(level: LogLevel, message: string, extra: { err?: unknown; recordId?: string } = {}): LogEntry {
  const stack = extra.err instanceof Error ? extra.err.stack : extra.err ? String(extra.err) : undefined;
  const entry: LogEntry = { seq: ++state.seq, ts: new Date().toISOString(), level, message, stack, recordId: extra.recordId };
  state.buf.push(entry);
  if (state.buf.length > MAX) state.buf.splice(0, state.buf.length - MAX);
  try {
    const dir = path.join(getConfig().dataDir, "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "app.log"),
      `${entry.ts} [${level}] ${message}${stack ? "\n" + stack : ""}\n`);
  } catch { /* logging must never break the pipeline */ }
  return entry;
}
export const logsAfter = (seq: number, limit = 300) => state.buf.filter((e) => e.seq > seq).slice(-limit);
export const lastSeq = () => state.seq;
export const clearLogsForTests = () => { state.buf.length = 0; state.seq = 0; };

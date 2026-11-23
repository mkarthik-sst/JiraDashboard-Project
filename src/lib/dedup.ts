/**
 * Deduplication engine.
 * Strategy: (1) exact fingerprint on normalised Summary+Description (O(1) hash lookup),
 *           (2) fuzzy token-shingle Jaccard similarity above DEDUP_THRESHOLD.
 * Edit normalize()/similarity()/WEIGHTS to change matching behaviour.
 */
import { createHash } from "node:crypto";

export const WEIGHTS = { summary: 0.6, description: 0.4 };

/** Strips noise that differs between otherwise identical SAP defects (dates, hex, long numbers, doc numbers). */
export function normalize(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}([t ]\d{2}:\d{2}(:\d{2})?)?\b/g, " ")   // ISO dates
    .replace(/\b\d{2}[./]\d{2}[./]\d{4}\b/g, " ")                        // 27.10.2026
    .replace(/\b0x[0-9a-f]+\b/g, " ")                                    // hex
    .replace(/\b\d{5,}\b/g, " ")                                         // long ids / doc numbers
    .replace(/[^a-z0-9_/$<>\- ]+/g, " ")                                 // keep ABAP-ish tokens
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint(summary: string, description: string): string {
  return createHash("sha256").update(normalize(summary) + "\n" + normalize(description)).digest("hex");
}

function shingles(text: string, n = 2): Set<string> {
  const t = normalize(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (t.length <= n) { if (t.length) out.add(t.join(" ")); return out; }
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n).join(" "));
  return out;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function similarity(a: { Summary: string; Description: string }, b: { Summary: string; Description: string }): number {
  return WEIGHTS.summary * jaccard(shingles(a.Summary), shingles(b.Summary))
       + WEIGHTS.description * jaccard(shingles(a.Description), shingles(b.Description));
}

export interface Candidate { id: string; fingerprint: string; Summary: string; Description: string }
export interface Match { id: string; score: number; kind: "exact" | "fuzzy" }

export function findMatch(
  incoming: { Summary: string; Description: string }, history: Candidate[], threshold: number,
): Match | null {
  const fp = fingerprint(incoming.Summary, incoming.Description);
  const exact = history.find((h) => h.fingerprint === fp);
  if (exact) return { id: exact.id, score: 1, kind: "exact" };
  let best: Match | null = null;
  for (const h of history) {
    const score = similarity(incoming, h);
    if (score >= threshold && (!best || score > best.score)) best = { id: h.id, score, kind: "fuzzy" };
  }
  return best;
}

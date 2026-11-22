import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted at every level (Postgres jsonb reorders keys). */
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value as Record<string, unknown>).sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + stable((value as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

/**
 * Version of the EXACT saved evidence snapshot a private draft was written
 * from (PredictionReassessment.lastEvidence). Any monitoring refresh that
 * changes the snapshot (standings, season record, anything) changes this,
 * even when no new material signal (lastChangeHash) is raised, so the draft
 * becomes stale and cannot be applied.
 */
export function evidenceSnapshotHash(snapshot: unknown): string | null {
  if (snapshot == null) return null;
  return createHash("sha256").update(stable(snapshot)).digest("hex").slice(0, 32);
}

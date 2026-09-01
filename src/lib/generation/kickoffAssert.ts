/**
 * Catch a Prediction being written with a kickoff that disagrees with the
 * candidate it was generated from.
 *
 * This exists because of a defect the current code cannot reproduce. Twenty-
 * three settled rows were found storing kickoffs 60-120 minutes away from the
 * provider's time, while the GenerationAttempt written from the SAME Candidate
 * in the SAME run stored the correct time — and the attempt demonstrably owned
 * those predictions (attempt.predictionIds linked them). The round trip today
 * is `c.kickoff` -> `.toISOString()` -> `new Date(...)`, which is lossless, so
 * the mechanism was never identified and is presumed to belong to a generation
 * path since replaced.
 *
 * The point is not to fix that. It is to make sure that if it ever happens
 * again it is LOUD at the moment of writing, rather than surfacing weeks later
 * as an unsettleable row. A fully-green test suite hid the last one.
 */

/** Anything under a minute is clock noise, not a real divergence. */
export const KICKOFF_ASSERT_TOLERANCE_MS = 60_000;

export type KickoffMismatch = {
  predictionId: string;
  expected: string;
  actual: string | null;
  deltaMinutes: number | null;
};

/**
 * Compare what the candidate said against what was actually persisted.
 *
 * A null stored kickoff is reported too: generate.ts writes `undefined` when
 * the incoming string fails to parse, which silently leaves the column null
 * and is exactly as wrong as a shifted time.
 */
export function findKickoffMismatches(
  expected: Date,
  rows: { id: string; kickoff: Date | null }[],
): KickoffMismatch[] {
  const out: KickoffMismatch[] = [];
  for (const row of rows) {
    if (row.kickoff == null) {
      out.push({ predictionId: row.id, expected: expected.toISOString(), actual: null, deltaMinutes: null });
      continue;
    }
    const delta = row.kickoff.getTime() - expected.getTime();
    if (Math.abs(delta) <= KICKOFF_ASSERT_TOLERANCE_MS) continue;
    out.push({
      predictionId: row.id,
      expected: expected.toISOString(),
      actual: row.kickoff.toISOString(),
      deltaMinutes: Math.round(delta / 60_000),
    });
  }
  return out;
}

/** One-line-per-mismatch message for the run log. */
export function formatKickoffMismatches(match: string, mismatches: KickoffMismatch[]): string {
  return [
    `KICKOFF MISMATCH after generating ${match} — ${mismatches.length} row(s) disagree with the candidate:`,
    ...mismatches.map((m) =>
      `  prediction ${m.predictionId}: expected ${m.expected}, stored ${m.actual ?? "NULL"}` +
      (m.deltaMinutes == null ? " (unparseable kickoff)" : ` (${m.deltaMinutes >= 0 ? "+" : ""}${m.deltaMinutes}min)`),
    ),
  ].join("\n");
}

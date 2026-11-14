import { prisma } from "@/lib/prisma";
import { compactFixtureResult, mergeFixtureResult, readFixtureResult } from "@/lib/matchCentre";

/**
 * Store the result record (status, half-time and full-time score, and —
 * when the provider response carried them — events and match statistics)
 * for fixtures the app has ALREADY fetched for another reason.
 *
 * ZERO EXTRA API CALLS. Every caller passes rows it fetched anyway:
 *   - settlement's batched `?ids=` prefetch (src/lib/settleFinished.ts),
 *   - kickoff reconciliation's batched `?ids=` prefetch (src/lib/kickoffReconcile.ts),
 *   - the per-day `?date=` slate the fixture-detail refresh reads (src/lib/enrichment.ts).
 * The match page then reads this from FixtureDetailCache like everything else
 * and never calls the provider.
 *
 * Stored under detailJson.result for the FixtureDetailCache row whose
 * fixtureApiId matches — keyed by the provider's stable fixture id, so a
 * rescheduled fixture cannot inherit another game's result. Merged with what
 * is already stored (mergeFixtureResult): a later, slimmer response (the date
 * slate has no events) never erases a richer earlier capture.
 *
 * Never throws: a capture failure must not fail settlement or a refresh.
 * Returns how many rows were written.
 */
export async function captureFixtureResults(rows: Iterable<unknown>, now: Date = new Date()): Promise<number> {
  try {
    const compact = new Map<number, ReturnType<typeof compactFixtureResult> & {}>();
    for (const raw of rows) {
      const r = compactFixtureResult(raw, now);
      if (r) compact.set(r.fixtureApiId, r);
    }
    if (!compact.size) return 0;
    const cached = await prisma.fixtureDetailCache.findMany({
      where: { fixtureApiId: { in: [...compact.keys()] } },
      select: { matchKey: true, fixtureApiId: true, detailJson: true },
    });
    let written = 0;
    for (const row of cached) {
      const next = compact.get(row.fixtureApiId!);
      if (!next) continue;
      const prev = readFixtureResult((row.detailJson as { result?: unknown } | null)?.result, row.fixtureApiId);
      const merged = mergeFixtureResult(prev, next);
      // Only the `result` key is replaced; venue, round, lineups and the rest of detailJson are untouched.
      await prisma.$executeRaw`UPDATE "FixtureDetailCache" SET "detailJson" = COALESCE("detailJson", '{}'::jsonb) || jsonb_build_object('result', ${JSON.stringify(merged)}::jsonb) WHERE "matchKey" = ${row.matchKey}`;
      written++;
    }
    return written;
  } catch (err) {
    console.error("[fixture-result-capture] skipped:", err instanceof Error ? err.message : err);
    return 0;
  }
}

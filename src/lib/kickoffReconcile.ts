import { prisma } from "@/lib/prisma";
import { prefetchFixturesById } from "@/lib/settlement";

/**
 * Refresh the stored kickoff of UPCOMING predictions against the provider.
 *
 * Settlement already reconciles kickoff, but only when it resolves a finished
 * fixture — which is after the match has been and gone. A viewer looking at a
 * pick before kickoff would still see a stale time. This pass closes that
 * window by correcting rows while they are still ahead of us.
 *
 * Two independent causes make this necessary:
 *   - the provider genuinely reschedules a fixture after we generate (~42h of
 *     lead time, and six such moves were measured in one 400-fixture sample)
 *   - a historical, not-currently-reproducing defect wrote kickoffs 60-120min
 *     off the value discovery had recorded in the same run
 *
 * The second is unexplained, so this deliberately corrects the SYMPTOM from
 * provider truth rather than assuming a cause. See the kickoff assertion in
 * src/lib/generation/kickoffAssert.ts for catching the cause if it recurs.
 *
 * Cost is one batched ?ids= call per 20 distinct fixtures, not one per row.
 */

/** Anything under a minute is clock noise, not a reschedule. */
export const KICKOFF_DRIFT_TOLERANCE_MS = 60_000;

export type KickoffChange = {
  id: string;
  match: string;
  from: string;
  to: string;
  deltaMinutes: number;
};

export async function reconcileUpcomingKickoffs(opts: { now?: Date; limit?: number } = {}): Promise<{
  checked: number;
  fixturesFetched: number;
  updated: number;
  changes: KickoffChange[];
}> {
  const now = opts.now ?? new Date();
  const rows = await prisma.prediction.findMany({
    where: {
      kickoff: { gt: now },
      fixtureApiId: { not: null },
      // Both states are user-visible or about to be: a PUBLISHED row is on the
      // site now, a PENDING_REVIEW row is what the reviewer is reading.
      status: { in: ["PUBLISHED", "PENDING_REVIEW"] },
    },
    select: { id: true, homeTeam: true, awayTeam: true, kickoff: true, fixtureApiId: true },
    orderBy: { kickoff: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  if (rows.length === 0) return { checked: 0, fixturesFetched: 0, updated: 0, changes: [] };

  const prefetched = await prefetchFixturesById(
    rows.map((r) => r.fixtureApiId).filter((id): id is number => id != null),
  );

  const changes: KickoffChange[] = [];
  for (const r of rows) {
    const fixture: any = prefetched.get(r.fixtureApiId!);
    // No row for this id means the batch call failed or the fixture is gone.
    // Leaving the stored value alone is the safe reading of "we don't know".
    if (!fixture?.fixture?.date) continue;
    const actual = new Date(fixture.fixture.date);
    if (isNaN(actual.getTime())) continue;
    const delta = actual.getTime() - r.kickoff!.getTime();
    if (Math.abs(delta) <= KICKOFF_DRIFT_TOLERANCE_MS) continue;

    await prisma.prediction.update({ where: { id: r.id }, data: { kickoff: actual } });
    changes.push({
      id: r.id,
      match: `${r.homeTeam} vs ${r.awayTeam}`,
      from: r.kickoff!.toISOString(),
      to: actual.toISOString(),
      deltaMinutes: Math.round(delta / 60_000),
    });
  }

  return { checked: rows.length, fixturesFetched: prefetched.size, updated: changes.length, changes };
}

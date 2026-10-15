import { prisma } from "@/lib/prisma";
import { matchKey } from "@/lib/slug";
import type { FixtureRow } from "@/lib/football/api-football";

/**
 * What a manual bulk run (admin picks competitions, /api/admin/ai/bulk) must
 * not generate again: fixtures that already have a prediction that is live
 * (PUBLISHED) or on its way there (DRAFT, PENDING_REVIEW, APPROVED).
 *
 * The scheduled generator already skips covered fixtures (selector.ts); the
 * manual route did not, so picking a competition the scheduler had covered
 * made a second set of tips for the same matches.
 *
 * ARCHIVED rows do not count: an admin who rejected a fixture's tips and
 * selects the competition again is asking for a fresh attempt.
 *
 * Same two identities as the selector: fixtureApiId first (it survives a
 * reschedule), matchKey as the fallback for rows saved without the id.
 */

export type CoveredFixture = { fixtureApiId: number; home: string; away: string; status: string; predictionId: string };

type ExistingRow = {
  id: string;
  status: string;
  fixtureApiId: number | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date | null;
};

const STATUS_RANK: Record<string, number> = { PUBLISHED: 0, APPROVED: 1, PENDING_REVIEW: 2, DRAFT: 3 };

/** Split a slate into fixtures still open for generation and those already covered. Pure. */
export function splitByCoverage(
  fixtures: readonly FixtureRow[],
  existing: readonly ExistingRow[],
): { open: FixtureRow[]; covered: CoveredFixture[] } {
  const best = <K>(map: Map<K, ExistingRow>, k: K, row: ExistingRow) => {
    const cur = map.get(k);
    if (!cur || (STATUS_RANK[row.status] ?? 9) < (STATUS_RANK[cur.status] ?? 9)) map.set(k, row);
  };
  const byId = new Map<number, ExistingRow>();
  const byKey = new Map<string, ExistingRow>();
  for (const row of existing) {
    if (row.status === "ARCHIVED") continue;
    if (row.fixtureApiId != null) best(byId, row.fixtureApiId, row);
    const key = matchKey(row);
    if (key) best(byKey, key, row);
  }

  const open: FixtureRow[] = [];
  const covered: CoveredFixture[] = [];
  for (const f of fixtures) {
    const key = matchKey({ homeTeamApiId: f.teams.home.id, awayTeamApiId: f.teams.away.id, kickoff: f.fixture.date });
    const hit = byId.get(f.fixture.id) ?? (key ? byKey.get(key) : undefined);
    if (hit) {
      covered.push({ fixtureApiId: f.fixture.id, home: f.teams.home.name, away: f.teams.away.name, status: hit.status, predictionId: hit.id });
    } else {
      open.push(f);
    }
  }
  return { open, covered };
}

/** Reads the existing predictions for a slate (one query) and splits it. */
export async function excludeCoveredFixtures(fixtures: readonly FixtureRow[]): Promise<{ open: FixtureRow[]; covered: CoveredFixture[] }> {
  if (fixtures.length === 0) return { open: [], covered: [] };
  const ids = fixtures.map((f) => f.fixture.id);
  const homeIds = fixtures.map((f) => f.teams.home.id);
  const times = fixtures.map((f) => new Date(f.fixture.date).getTime()).filter((t) => !Number.isNaN(t));
  // The matchKey fallback compares UTC days, so read a day either side of the slate.
  const from = new Date(Math.min(...times) - 86_400_000);
  const to = new Date(Math.max(...times) + 86_400_000);
  const existing = await prisma.prediction.findMany({
    where: {
      status: { not: "ARCHIVED" },
      OR: [{ fixtureApiId: { in: ids } }, { homeTeamApiId: { in: homeIds }, kickoff: { gte: from, lte: to } }],
    },
    select: { id: true, status: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });
  return splitByCoverage(fixtures, existing);
}

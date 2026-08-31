/**
 * Populate Prediction.fixtureApiId on rows generated before it was captured.
 *
 * Matching is by PROVIDER TEAM IDS, never by name: homeTeamApiId+awayTeamApiId
 * against the fixture slate for the row's kickoff date. That is exact, so a
 * spelling difference cannot produce a wrong link, and it is also what lets the
 * scan detect the two defects that motivated this work:
 *
 *   - a rescheduled fixture, found on an adjacent day (--days widens the scan)
 *   - a REVERSED pairing, where our home team is the provider's away team;
 *     those are reported and deliberately NOT linked, because settling one
 *     would invert every home/away selection (see settlement.ts's orientation
 *     guard).
 *
 * Costs one /fixtures?date call per distinct date scanned, not one per row.
 *
 * Run: npx tsx scripts/backfill-fixture-api-id.ts [--apply] [--days 1]
 */
import { prisma } from "@/lib/prisma";
import { getFixturesByDate } from "@/lib/football/api-football";

const APPLY = process.argv.includes("--apply");
const DAYS = Number(process.argv[process.argv.indexOf("--days") + 1]) || 1;

(async () => {
  const rows = await prisma.prediction.findMany({
    where: { fixtureApiId: null, homeTeamApiId: { not: null }, awayTeamApiId: { not: null }, kickoff: { not: null } },
    select: { id: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
    orderBy: { kickoff: "asc" },
  });
  console.log(`rows missing fixtureApiId: ${rows.length}`);

  const cache = new Map<string, any[]>();
  const get = async (d: string) => {
    if (!cache.has(d)) cache.set(d, (await getFixturesByDate(d)) ?? []);
    return cache.get(d)!;
  };

  let linked = 0, moved = 0, reversed = 0, missing = 0;
  const reversedRows: string[] = [];

  for (const r of rows) {
    let hit: { f: any; off: number; rev: boolean } | null = null;
    for (let off = 0; Math.abs(off) <= DAYS && !hit; off = off > 0 ? -off : -off + 1) {
      const d = new Date(r.kickoff!.getTime() + off * 86_400_000).toISOString().slice(0, 10);
      const slate = await get(d);
      const exact = slate.find((f: any) => f.teams.home.id === r.homeTeamApiId && f.teams.away.id === r.awayTeamApiId);
      if (exact) { hit = { f: exact, off, rev: false }; break; }
      const rev = slate.find((f: any) => f.teams.home.id === r.awayTeamApiId && f.teams.away.id === r.homeTeamApiId);
      if (rev) { hit = { f: rev, off, rev: true }; break; }
    }
    if (!hit) { missing++; continue; }
    if (hit.rev) {
      reversed++;
      reversedRows.push(`  REVERSED  ${r.homeTeam} vs ${r.awayTeam} @ ${r.kickoff!.toISOString()} -> provider "${hit.f.teams.home.name}" vs "${hit.f.teams.away.name}" (id ${hit.f.fixture.id})`);
      continue;
    }
    if (hit.off !== 0) moved++;
    linked++;
    if (APPLY) await prisma.prediction.update({ where: { id: r.id }, data: { fixtureApiId: hit.f.fixture.id } });
  }

  console.log(`\nlinked   : ${linked}${APPLY ? " (written)" : " (dry run)"}`);
  console.log(`  of which found on an adjacent day (rescheduled): ${moved}`);
  console.log(`reversed : ${reversed}  — NOT linked, needs an editorial decision`);
  console.log(`unmatched: ${missing}`);
  if (reversedRows.length) { console.log("\nreversed pairings:"); reversedRows.forEach((l) => console.log(l)); }
  if (!APPLY) console.log("\nDry run. Re-run with --apply to write.");
  await prisma.$disconnect();
})();

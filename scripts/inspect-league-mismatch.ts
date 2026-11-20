/**
 * Why do predictions for one competition appear on another competition's page?
 *
 * League pages list rows by leagueSlugKey (name + provider league id). This
 * prints, for the Premier League (39) page, every upcoming or recent row whose
 * teams or discovery record say it is not that competition, and how widely a
 * stored league id disagrees with what discovery recorded for the same fixture.
 *
 * READ-ONLY. No provider calls, no writes.
 * Run: npx tsx scripts/inspect-league-mismatch.ts [leagueApiId=39]
 */
export {};
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("session verified read-only");
  }
  const leagueId = Number(process.argv[2]) || 39;
  const since = new Date(Date.now() - 10 * 24 * 3_600_000);

  const rows = await prisma.prediction.findMany({
    where: { leagueApiId: leagueId, kickoff: { gte: since } },
    orderBy: { kickoff: "desc" },
    select: { id: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, leagueName: true, leagueApiId: true, fixtureApiId: true },
  });
  console.log(`\nPredictions stored under league ${leagueId} with kickoff in the last 10 days or later: ${rows.length}`);

  // The set of teams that actually play in this league: every team in its recent discovery rows.
  const att = await prisma.generationAttempt.findMany({ where: { leagueApiId: leagueId, createdAt: { gte: new Date(Date.now() - 60 * 24 * 3_600_000) } }, select: { homeTeam: true, awayTeam: true } });
  const teams = new Set(att.flatMap((a) => [a.homeTeam, a.awayTeam]));
  console.log(`discovery rows for league ${leagueId} in the last 60 days: ${att.length}, distinct teams: ${teams.size}`);

  let suspicious = 0;
  for (const r of rows) {
    const ga = r.fixtureApiId != null ? await prisma.generationAttempt.findFirst({ where: { fixtureApiId: r.fixtureApiId }, select: { leagueApiId: true, leagueName: true, homeTeam: true, awayTeam: true, createdAt: true, status: true } }) : null;
    const teamsKnown = teams.has(r.homeTeam ?? "") || teams.has(r.awayTeam ?? "");
    const discoveryDisagrees = !!ga && ga.leagueApiId !== r.leagueApiId;
    if (teamsKnown && !discoveryDisagrees) continue;
    suspicious++;
    // The repository's Actions logs may be public. Do not disclose unpublished picks, tiers, author identities or AI job details.\n    console.log(`\n* ${r.homeTeam} v ${r.awayTeam}  kickoff ${r.kickoff?.toISOString()}`);
    console.log(`  stored league: ${r.leagueName} (${r.leagueApiId})  fixtureApiId ${r.fixtureApiId}  teamApiIds ${r.homeTeamApiId}/${r.awayTeamApiId}`);


    console.log(`  discovery record: ${ga ? `${ga.leagueName} (${ga.leagueApiId}) ${ga.homeTeam} v ${ga.awayTeam} status ${ga.status} discovered ${ga.createdAt.toISOString()}` : "none"}`);
  }
  console.log(`\nrows that do not belong: ${suspicious} of ${rows.length}`);

  // How widespread: predictions whose stored league differs from discovery's for the same fixture.
  const pairs = await prisma.$queryRawUnsafe<{ pred_league: number | null; disc_league: number | null; pred_name: string | null; disc_name: string | null; n: bigint }[]>(`
    SELECT p."leagueApiId" AS pred_league, g."leagueApiId" AS disc_league, p."leagueName" AS pred_name, g."leagueName" AS disc_name, COUNT(*) AS n
    FROM "Prediction" p JOIN "GenerationAttempt" g ON g."fixtureApiId" = p."fixtureApiId"
    WHERE p."fixtureApiId" IS NOT NULL AND p."createdAt" > now() - interval '60 days'
      AND p."leagueApiId" IS DISTINCT FROM g."leagueApiId"
    GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 25`);
  console.log(`\nStored league differs from the discovery record for the same fixture (last 60 days):`);
  if (!pairs.length) console.log("  none");
  for (const p of pairs) console.log(`  stored ${p.pred_name} (${p.pred_league})  vs discovery ${p.disc_name} (${p.disc_league})  rows ${p.n}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

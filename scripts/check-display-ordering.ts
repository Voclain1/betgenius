/**
 * Verifies the site-wide display ordering against real published data.
 *
 * Two properties matter, and they fail in different ways:
 *   CORRECT — every adjacent pair in a rendered feed obeys the ranking
 *             (pending before settled; then confidence descending; then
 *             competition priority as a tiebreak).
 *   TOP ROW — the single highest-confidence pending pick leads every category.
 *             Checked separately from pairwise ordering: a comparator bug that
 *             only misplaces the first row would otherwise be reported as a
 *             generic ordering failure rather than as the thing users see.
 *   STABLE  — the same rows always produce the same sequence, so a page does
 *             not reshuffle between reloads. Checked by re-sorting shuffled
 *             copies of the same batch and demanding an identical id sequence,
 *             which is what a total comparator guarantees and a partial one
 *             (ties left in database order) does not.
 *
 * Run: npx tsx --env-file=.env scripts/check-display-ordering.ts
 */
export {};

// categoryPredictions/predictionScope wrap their queries in React's cache(),
// which only exists inside a render. Outside one it's an identity wrapper —
// memoisation is the only thing lost, and a script that runs each query once
// has nothing to memoise. Patched before those modules load, which is why the
// imports below are dynamic.
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { orderForDisplay, comparePredictionsForDisplay } from "../src/lib/predictionOrdering";
import { leaguePriorityRank, LEAGUE_PRIORITY_ORDER } from "../src/lib/leagues";
import { PREDICTION_CATEGORIES } from "../src/lib/enums";

type Row = { id: string; leagueApiId: number | null; confidence: number | null; outcome: string | null; kickoff: Date | null; leagueName: string | null; homeTeam: string | null; awayTeam: string | null };

const label = (r: Row) => `${r.homeTeam ?? "?"} v ${r.awayTeam ?? "?"}`;
const rank = (r: Row) => leaguePriorityRank(r.leagueApiId);

/** Every adjacent pair must be in non-decreasing comparator order. */
function checkOrdered(name: string, rows: Row[]): string[] {
  const problems: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (comparePredictionsForDisplay(rows[i - 1], rows[i]) > 0) {
      problems.push(`${name}: row ${i - 1} (${label(rows[i - 1])}) sorts after row ${i} (${label(rows[i])})`);
    }
  }
  return problems;
}

function shuffle<T>(rows: readonly T[], seed: number): T[] {
  // Deterministic shuffle so a failure is reproducible.
  const out = [...rows];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The same rows in five different input orders must produce one output order. */
function checkStable(name: string, rows: Row[]): string[] {
  const baseline = orderForDisplay(rows).map((r) => r.id).join(",");
  for (let seed = 1; seed <= 5; seed++) {
    const again = orderForDisplay(shuffle(rows, seed)).map((r) => r.id).join(",");
    if (again !== baseline) return [`${name}: reordering input order #${seed} changed the output sequence — ordering is not stable`];
  }
  return [];
}

async function main() {
  const { getCategoryPredictions } = await import("../src/lib/categoryPredictions");
  const { getPublishedByLeagueSlug, getPublishedByTeamSlug } = await import("../src/lib/predictionScope");

  const problems: string[] = [];
  const summary: any[] = [];

  // --- The real corpus, as one mixed batch ---
  const all = (await prisma.prediction.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, leagueApiId: true, confidence: true, outcome: true, kickoff: true, leagueName: true, homeTeam: true, awayTeam: true },
  })) as Row[];

  const leaguesPresent = new Set(all.map((r) => r.leagueApiId));
  const confidences = new Set(all.map((r) => r.confidence));
  const pending = all.filter((r) => r.outcome === "PENDING").length;

  // A batch that is all one league, or all one confidence, would pass the
  // ordering checks without ever exercising them. Say so rather than reporting
  // a green run on a sample that cannot fail.
  const mixed = {
    rows: all.length,
    distinctLeagues: leaguesPresent.size,
    leaguesInPriorityOrder: [...leaguesPresent].filter((id) => (LEAGUE_PRIORITY_ORDER as readonly number[]).includes(id as number)).length,
    distinctConfidences: confidences.size,
    pending,
    settled: all.length - pending,
    exercisesRanking: leaguesPresent.size > 1 && confidences.size > 1,
  };

  problems.push(...checkOrdered("whole corpus", orderForDisplay(all)));
  problems.push(...checkStable("whole corpus", all));

  // --- Each surface, as the page itself would receive it ---
  for (const cat of PREDICTION_CATEGORIES) {
    const rows = (await getCategoryPredictions(cat)) as unknown as Row[];
    problems.push(...checkOrdered(`/predictions/${cat.toLowerCase()}`, rows));
    problems.push(...checkStable(`/predictions/${cat.toLowerCase()}`, rows));

    // The headline guarantee: highest confidence on top, in every category.
    const pending = rows.filter((r) => !r.outcome || r.outcome === "PENDING");
    if (pending.length > 1) {
      const best = Math.max(...pending.map((r) => r.confidence ?? 50));
      const leadConfidence = pending[0].confidence ?? 50;
      if (leadConfidence !== best) {
        problems.push(
          `/predictions/${cat.toLowerCase()}: top row is ${leadConfidence}% but the feed contains a ${best}% pick — highest confidence must lead`,
        );
      }
    }
    summary.push({
      surface: `/predictions/${cat.toLowerCase()}`,
      rows: rows.length,
      order: rows.slice(0, 6).map((r) => `${r.leagueName ?? "?"}#${rank(r)} ${r.confidence ?? "-"}% ${label(r)}`),
    });
  }

  // A league page (single league — exercises the pending/settled split) and a
  // team page (spans leagues — exercises the league priority tier).
  const busiestLeague = await prisma.prediction.findFirst({ where: { status: "PUBLISHED", leagueName: { not: null } }, select: { leagueName: true, leagueApiId: true } });
  if (busiestLeague?.leagueName) {
    const { leagueSlug } = await import("../src/lib/slug");
    const slug = leagueSlug(busiestLeague.leagueName, busiestLeague.leagueApiId);
    const { rows } = await getPublishedByLeagueSlug(slug);
    problems.push(...checkOrdered(`/predictions/league/${slug}`, rows as unknown as Row[]));
    summary.push({
      surface: `/predictions/league/${slug}`,
      rows: rows.length,
      order: rows.slice(0, 6).map((r) => `${r.outcome} ${r.confidence}% ${r.homeTeam} v ${r.awayTeam}`),
    });
  }

  const anyTeam = await prisma.prediction.findFirst({ where: { status: "PUBLISHED", homeTeam: { not: null } }, select: { homeTeam: true } });
  if (anyTeam?.homeTeam) {
    const { teamSlug } = await import("../src/lib/slug");
    const slug = teamSlug(anyTeam.homeTeam);
    const { rows } = await getPublishedByTeamSlug(slug);
    problems.push(...checkOrdered(`/predictions/team/${slug}`, rows as unknown as Row[]));
    summary.push({
      surface: `/predictions/team/${slug}`,
      rows: rows.length,
      order: rows.slice(0, 6).map((r) => `${r.outcome} ${r.leagueName}#${rank(r as unknown as Row)} ${r.confidence}% ${r.homeTeam} v ${r.awayTeam}`),
    });
  }

  console.log(JSON.stringify({ mixedBatch: mixed, surfaces: summary, problems, verdict: problems.length === 0 ? "PASS" : "FAIL" }, null, 2));
  await prisma.$disconnect();
  if (problems.length > 0) process.exitCode = 1;
}

main();

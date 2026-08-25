/**
 * Measures whether asking for several markets per fixture actually yields
 * ASSEMBLABLE same-game pairs — not merely more rows.
 *
 * This is the gate on the same-game-double feature. Raw multi-market yield on
 * its own would be a misleading number: two picks on one fixture are frequently
 * NESTED (one implies the other, so the "combo" is really the stricter pick
 * under a longer name) rather than genuinely compound. Historical data makes
 * that concrete — 2 of the 3 real multi-market fixtures ever generated paired
 * MATCH_WINNER Home with DOUBLE_CHANCE Home-or-Draw, which it already implies.
 * So every returned pair is run through checkLegCompatibility (src/lib/
 * sameGameDouble.ts) and only the survivors are counted.
 *
 * Replays the digest stored on AIJob.context rather than re-fetching evidence,
 * exactly as scripts/compare-market-calibration.ts does: the model sees the
 * byte-identical prompt the original job saw, so a difference in output is
 * attributable to the prompt change and nothing else. No API-Football calls,
 * and nothing is written to the database.
 *
 * Pass "single" as the second argument to run the CONTROL: the same fixtures,
 * the same evidence, production's single-market prompt. That control exists
 * because the multi-market instruction bans MATCH_WINNER+DOUBLE_CHANCE pairs,
 * and a model can satisfy that ban by quietly dropping MATCH_WINNER altogether
 * — which would silently undo the margin calibration shipped in c37c16a. The
 * market mix has to be compared on identical fixtures to see that.
 *
 * Run: npx tsx scripts/measure-market-breadth.ts [count] [multi|single]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { checkLegCompatibility, type Leg } from "../src/lib/sameGameDouble";

/* ------------------------------------------------------------------------ */

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { generatePredictionForFixture } = await import("../src/lib/ai/analysis");
  const { parseStoredContext } = await import("../src/lib/ai/context");
  const { resolveGenerationRisk } = await import("../src/lib/ai/generationRisk");
  const { deriveMarketAndPick, isValidSelection } = await import("../src/lib/markets");

  const count = Number(process.argv[2] ?? 12);
  const breadth: "single" | "multi" = process.argv[3] === "single" ? "single" : "multi";

  const rows = await prisma.prediction.findMany({
    where: { aiJobId: { not: null }, homeTeam: { not: null }, awayTeam: { not: null } },
    select: {
      id: true, homeTeam: true, awayTeam: true, leagueName: true, leagueApiId: true,
      marketType: true, pick: true, confidence: true,
      aiJob: { select: { context: true, prompt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 400,
  });

  // One fixture per job: several rows can share an AIJob, and re-prompting the
  // same evidence twice would inflate the sample without adding information.
  const seen = new Set<string>();
  const pool = rows.filter((r) => {
    if (!parseStoredContext(r.aiJob?.context)) return false;
    const k = `${r.homeTeam}|${r.awayTeam}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, count);

  console.log(`Replaying ${pool.length} fixtures with stored evidence, marketBreadth="${breadth}".\n`);

  let returnedTotal = 0;
  let fixturesWithTwoPlus = 0;
  let fixturesWithAssemblablePair = 0;
  let invalidSelections = 0;
  const rejections = new Map<string, number>();
  const assembledPairs: string[] = [];
  const perFixtureCounts: number[] = [];
  const marketMix = new Map<string, number>();

  for (const row of pool) {
    const digest = parseStoredContext(row.aiJob!.context)!;
    let categories: string[] = [];
    try { categories = JSON.parse(row.aiJob!.prompt)?.categories ?? []; } catch {}
    const route = resolveGenerationRisk(categories, row.leagueApiId);

    try {
      const result = await generatePredictionForFixture({
        digest,
        tiers: route.promptTiers,
        riskCalibration: "margin",
        marketBreadth: breadth,
      });

      const preds = result.output.predictions ?? [];
      for (const p of preds) marketMix.set(p.marketType, (marketMix.get(p.marketType) ?? 0) + 1);
      perFixtureCounts.push(preds.length);
      returnedTotal += preds.length;
      if (preds.length >= 2) fixturesWithTwoPlus++;

      const legs: Leg[] = [];
      for (const p of preds) {
        if (!isValidSelection(p.marketType, p.selection)) { invalidSelections++; continue; }
        legs.push({ marketType: p.marketType, selection: p.selection });
      }

      const label = (l: Leg) =>
        `${l.marketType} ${deriveMarketAndPick(l.marketType, l.selection, row.homeTeam!, row.awayTeam!, { market: l.marketType, pick: "" }).pick}`;

      console.log(`\n  ${row.homeTeam} v ${row.awayTeam}  [${row.leagueName}]  tier=${route.promptTiers.join("+")}`);
      preds.forEach((p: any, i: number) => {
        const ok = isValidSelection(p.marketType, p.selection);
        console.log(`    ${i + 1}. ${String(p.marketType).padEnd(15)} ${ok ? label({ marketType: p.marketType, selection: p.selection }).replace(`${p.marketType} `, "") : "(invalid selection)"} @ ${Math.round(p.confidence)}%`);
      });

      let anyOk = false;
      for (let i = 0; i < legs.length; i++) {
        for (let j = i + 1; j < legs.length; j++) {
          const v = checkLegCompatibility(legs[i], legs[j]);
          const desc = `${label(legs[i])}  +  ${label(legs[j])}`;
          if (v.ok) {
            anyOk = true;
            assembledPairs.push(`${row.homeTeam} v ${row.awayTeam}: ${desc}`);
            console.log(`       OK        ${desc}`);
          } else {
            rejections.set(v.reason, (rejections.get(v.reason) ?? 0) + 1);
            console.log(`       ${v.reason.padEnd(9)} ${desc}  — ${v.detail}`);
          }
        }
      }
      if (anyOk) fixturesWithAssemblablePair++;
    } catch (err: any) {
      console.log(`\n  ${row.homeTeam} v ${row.awayTeam} — generation failed: ${err?.message ?? err}`);
    }
  }

  const n = perFixtureCounts.length;
  console.log(`\n\n===== YIELD =====`);
  console.log(`fixtures replayed:                  ${n}`);
  console.log(`total market calls returned:        ${returnedTotal}  (mean ${n ? (returnedTotal / n).toFixed(2) : "-"} per fixture)`);
  const dist = new Map<number, number>();
  for (const c of perFixtureCounts) dist.set(c, (dist.get(c) ?? 0) + 1);
  for (const [k, v] of [...dist].sort((x, y) => x[0] - y[0])) console.log(`   ${k} call(s): ${v} fixture(s)`);
  console.log(`fixtures returning >=2 calls:       ${fixturesWithTwoPlus}${n ? ` (${(fixturesWithTwoPlus / n * 100).toFixed(1)}%)` : ""}`);
  console.log(`fixtures with an ASSEMBLABLE pair:  ${fixturesWithAssemblablePair}${n ? ` (${(fixturesWithAssemblablePair / n * 100).toFixed(1)}%)` : ""}`);
  console.log(`invalid selections emitted:         ${invalidSelections}`);
  console.log(`
market mix returned:`);
  for (const [m, c] of [...marketMix].sort((x, y) => y[1] - x[1])) {
    console.log(`   ${m.padEnd(16)} ${String(c).padStart(3)}  (${(c / returnedTotal * 100).toFixed(1)}%)`);
  }
  console.log(`\nrejected pairs by reason:`);
  if (rejections.size === 0) console.log(`   (none)`);
  for (const [r, c] of rejections) console.log(`   ${r.padEnd(14)} ${c}`);
  console.log(`\nassemblable pairs (${assembledPairs.length}):`);
  for (const p of assembledPairs) console.log(`   ${p}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

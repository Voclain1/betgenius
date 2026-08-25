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
 * So every returned pair is run through a compatibility check and only the
 * survivors are counted.
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

import type { MarketType, Selection } from "../src/lib/markets";

/* ------------------------------------------------------------------------ *
 * Compatibility check — RESEARCH PROTOTYPE.
 *
 * Lives here rather than in src/lib because the production table is a separate,
 * not-yet-approved build step. It is kept deliberately literal so the verdicts
 * can be read against the proposal rather than inferred from clever code.
 * ------------------------------------------------------------------------ */

export type Verdict = { ok: true } | { ok: false; reason: "CONTRADICTORY" | "REDUNDANT"; detail: string };

export type Leg = { marketType: MarketType; selection: Selection };

/** The side a pick backs, where it backs one — used to spot opposed picks. */
function backedSide(leg: Leg): "HOME" | "AWAY" | null {
  const sel = leg.selection as any;
  if (leg.marketType === "MATCH_WINNER" || leg.marketType === "WIN_EITHER_HALF") {
    return sel?.value === "HOME" ? "HOME" : sel?.value === "AWAY" ? "AWAY" : null;
  }
  if (leg.marketType === "DOUBLE_CHANCE") {
    return sel?.value === "HOME_OR_DRAW" ? "HOME" : sel?.value === "AWAY_OR_DRAW" ? "AWAY" : null;
  }
  return null;
}

export function compatible(a: Leg, b: Leg): Verdict {
  const pair = (x: MarketType, y: MarketType) =>
    (a.marketType === x && b.marketType === y) || (a.marketType === y && b.marketType === x);

  if (a.marketType === b.marketType) {
    return { ok: false, reason: "REDUNDANT", detail: `same marketType (${a.marketType}) twice` };
  }

  // An exact score already fixes result, total and both-teams-scored, so every
  // partner is implied by it or impossible with it.
  if (a.marketType === "CORRECT_SCORE" || b.marketType === "CORRECT_SCORE") {
    return { ok: false, reason: "REDUNDANT", detail: "CORRECT_SCORE determines every other market" };
  }

  // Backing a side to win covers "that side or draw" and "either side", and
  // contradicts "the other side or draw". No combination survives.
  if (pair("MATCH_WINNER", "DOUBLE_CHANCE")) {
    const mw = a.marketType === "MATCH_WINNER" ? a : b;
    const dc = a.marketType === "DOUBLE_CHANCE" ? a : b;
    const mwSide = (mw.selection as any)?.value;
    const dcVal = (dc.selection as any)?.value;
    const covers: Record<string, string[]> = {
      HOME_OR_DRAW: ["HOME", "DRAW"],
      AWAY_OR_DRAW: ["AWAY", "DRAW"],
      HOME_OR_AWAY: ["HOME", "AWAY"],
    };
    const implied = covers[dcVal]?.includes(mwSide);
    return implied
      ? { ok: false, reason: "REDUNDANT", detail: `${mwSide} already implies ${dcVal}` }
      : { ok: false, reason: "CONTRADICTORY", detail: `${mwSide} cannot occur within ${dcVal}` };
  }

  // Winning on aggregate means (h1-a1)+(h2-a2) > 0, so at least one term is
  // positive: MATCH_WINNER strictly implies WIN_EITHER_HALF on the same side.
  if (pair("MATCH_WINNER", "WIN_EITHER_HALF")) {
    const sideA = backedSide(a);
    const sideB = backedSide(b);
    if (sideA && sideA === sideB) {
      return { ok: false, reason: "REDUNDANT", detail: "winning the match implies winning a half" };
    }
    // Technically possible (away wins H1, home wins the tie) but reads as
    // self-contradictory on a card, so it is excluded on presentation grounds.
    return { ok: false, reason: "CONTRADICTORY", detail: "opposed sides across result and half markets" };
  }

  // BTTS YES means at least two goals, which settles low O/U lines outright.
  if (pair("BTTS", "OVER_UNDER")) {
    const btts = (a.marketType === "BTTS" ? a : b).selection as any;
    const ou = (a.marketType === "OVER_UNDER" ? a : b).selection as any;
    const line = Number(ou?.line);
    if (btts?.value === "YES" && Number.isFinite(line) && line <= 1.5) {
      return ou?.direction === "UNDER"
        ? { ok: false, reason: "CONTRADICTORY", detail: `BTTS Yes cannot coexist with Under ${line}` }
        : { ok: false, reason: "REDUNDANT", detail: `BTTS Yes already implies Over ${line}` };
    }
  }

  // Two picks that back opposite sides across any remaining market pair.
  const sideA = backedSide(a);
  const sideB = backedSide(b);
  if (sideA && sideB && sideA !== sideB) {
    return { ok: false, reason: "CONTRADICTORY", detail: `backs ${sideA} and ${sideB}` };
  }

  return { ok: true };
}

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
          const v = compatible(legs[i], legs[j]);
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

// Only runs when invoked directly, so the compatibility predicate above can be
// imported and asserted against real historical pairs by check-leg-compatibility.ts.
if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

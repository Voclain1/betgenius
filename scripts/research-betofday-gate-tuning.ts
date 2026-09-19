/**
 * How many Bet of the Day candidates survive under variations of the gate.
 *
 * WHY THIS RUNS BEFORE ANY CONSTANT MOVES. The live funnel's dominant rejection
 * is "no cached bookmaker price for this exact selection" (173 of 286), which is
 * an ODDS COVERAGE fault, not a gate fault. Tuning the gate against that number
 * would loosen quality controls to compensate for missing data — and then
 * silently over-admit once coverage is fixed.
 *
 * So the simulation runs on the PRICED SUBSET only: published picks whose
 * fixture actually carries odds. That isolates what the gate does from what
 * coverage does. A projection to full coverage is printed too, with its bias
 * stated rather than hidden.
 *
 * READ-ONLY. No fetches, no writes, no generation.
 *
 * Run: npx tsx --env-file=.env scripts/research-betofday-gate-tuning.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey } from "../src/lib/slug";
import { toBookmakerSelection, MIN_BOOKMAKERS, type FixtureOdds } from "../src/lib/odds";
import type { Selection } from "../src/lib/markets";

const H72 = 72 * 60 * 60 * 1000;

/** The gate, re-implemented with every threshold injectable. Mirrors qualifiesForBetOfDay. */
function evaluate(
  input: { odds: FixtureOdds | null; marketType: string; selection: unknown; confidence: number },
  cfg: { minOdds: number; maxOdds: number; minBooks: number; minEdgePP: number },
): { ok: boolean; why: string; price?: number; edge?: number } {
  const mapped = toBookmakerSelection(input.marketType as never, input.selection as Selection);
  if (!mapped) return { ok: false, why: `market ${input.marketType} unmapped` };
  const market = input.odds?.markets?.find((m) => m.market === mapped.market);
  const found = market?.selections?.find((s) => s.value === mapped.value);
  if (!found) return { ok: false, why: "no price for this selection" };
  const implied = 100 / found.best;
  const edge = input.confidence - implied;
  if (found.best < cfg.minOdds) return { ok: false, why: `below ${cfg.minOdds}`, price: found.best, edge };
  if (found.best > cfg.maxOdds) return { ok: false, why: `above ${cfg.maxOdds}`, price: found.best, edge };
  if ((found.bookmakers ?? 0) < cfg.minBooks) return { ok: false, why: "thin book", price: found.best, edge };
  if (edge < cfg.minEdgePP) return { ok: false, why: `edge ${edge.toFixed(1)}pp`, price: found.best, edge };
  return { ok: true, why: "ok", price: found.best, edge };
}

async function main() {
  const now = new Date();
  const preds = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: now, lt: new Date(now.getTime() + H72) }, homeTeamApiId: { not: null }, awayTeamApiId: { not: null } },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true, marketType: true, selection: true, confidence: true, homeTeam: true, awayTeam: true, pick: true },
  });
  const keys = [...new Set(preds.map((p) => matchKey(p as never)).filter((k): k is string => !!k))];
  const cache = await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys }, fetchedAt: { not: null } }, select: { matchKey: true, oddsJson: true } });
  const byKey = new Map(cache.map((c) => [c.matchKey, (c.oddsJson as unknown as FixtureOdds | null) ?? null]));

  const pricedPicks = preds.filter((p) => { const k = matchKey(p as never); return k && byKey.has(k); });
  const pricedFixtures = new Set(pricedPicks.map((p) => matchKey(p as never)));
  const allFixtures = new Set(keys);

  console.log("=== Bet of the Day gate tuning simulation ===\n");
  console.log(`published picks in next 72h:        ${preds.length}   across ${allFixtures.size} fixtures`);
  console.log(`...on fixtures that HAVE odds:      ${pricedPicks.length}   across ${pricedFixtures.size} fixtures`);
  console.log(`coverage: ${((pricedFixtures.size / allFixtures.size) * 100).toFixed(0)}% of fixtures priced\n`);
  console.log("All counts below are on the PRICED SUBSET — the gate's own behaviour,");
  console.log("with coverage held constant. The projection scales by 1/coverage and is");
  console.log("OPTIMISTIC: priced fixtures skew to top leagues and near kickoff.\n");

  const base = { minOdds: 2.2, maxOdds: 4.5, minBooks: MIN_BOOKMAKERS, minEdgePP: 10 };
  const scale = allFixtures.size / Math.max(1, pricedFixtures.size);

  const variants: Array<{ label: string; cfg: typeof base }> = [
    { label: "BASELINE (2.20 floor, edge 10pp)", cfg: base },
    { label: "floor 2.00", cfg: { ...base, minOdds: 2.0 } },
    { label: "floor 1.85", cfg: { ...base, minOdds: 1.85 } },
    { label: "floor 1.70", cfg: { ...base, minOdds: 1.7 } },
    { label: "floor 2.00 + edge 8pp", cfg: { ...base, minOdds: 2.0, minEdgePP: 8 } },
    { label: "floor 1.85 + edge 8pp", cfg: { ...base, minOdds: 1.85, minEdgePP: 8 } },
    { label: "floor 2.00 + edge 5pp", cfg: { ...base, minOdds: 2.0, minEdgePP: 5 } },
    { label: "floor 1.70 + edge 5pp", cfg: { ...base, minOdds: 1.7, minEdgePP: 5 } },
    { label: "floor 2.20 + edge 0pp (no edge rule)", cfg: { ...base, minEdgePP: -999 } },
  ];

  console.log("variant                                  eligible  distinct fixtures  projected@100%cov");
  for (const v of variants) {
    const hits = pricedPicks.filter((p) => { const k = matchKey(p as never); return evaluate({ odds: byKey.get(k!) ?? null, marketType: p.marketType, selection: p.selection, confidence: p.confidence }, v.cfg).ok; });
    const fx = new Set(hits.map((p) => matchKey(p as never)));
    console.log(`  ${v.label.padEnd(38)} ${String(hits.length).padStart(6)} ${String(fx.size).padStart(16)} ${(fx.size * scale).toFixed(1).padStart(16)}`);
  }

  // Where the baseline losses actually are, on the priced subset only.
  const tally: Record<string, number> = {};
  for (const p of pricedPicks) {
    const k = matchKey(p as never);
    const r = evaluate({ odds: byKey.get(k!) ?? null, marketType: p.marketType, selection: p.selection, confidence: p.confidence }, base);
    if (!r.ok) tally[r.why.replace(/-?\d+(\.\d+)?/g, "N")] = (tally[r.why.replace(/-?\d+(\.\d+)?/g, "N")] ?? 0) + 1;
  }
  console.log("\n=== baseline rejections on the PRICED subset ===");
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

  // Price distribution of picks that fail ONLY on the floor — is there a cluster
  // just under 2.20, or is the model simply picking heavy favourites?
  const belowFloor = pricedPicks
    .map((p) => { const k = matchKey(p as never); return evaluate({ odds: byKey.get(k!) ?? null, marketType: p.marketType, selection: p.selection, confidence: p.confidence }, { ...base, minOdds: 0 }); })
    .filter((r) => r.ok && r.price != null && r.price < 2.2)
    .map((r) => r.price!)
    .sort((a, b) => a - b);
  console.log(`\n=== picks that pass everything EXCEPT the 2.20 floor: ${belowFloor.length} ===`);
  if (belowFloor.length) {
    const band = (lo: number, hi: number) => belowFloor.filter((p) => p >= lo && p < hi).length;
    console.log(`  1.00-1.50: ${band(1, 1.5)}   1.50-1.70: ${band(1.5, 1.7)}   1.70-1.85: ${band(1.7, 1.85)}   1.85-2.00: ${band(1.85, 2)}   2.00-2.20: ${band(2, 2.2)}`);
    console.log(`  min=${belowFloor[0].toFixed(2)} median=${belowFloor[Math.floor(belowFloor.length / 2)].toFixed(2)} max=${belowFloor[belowFloor.length - 1].toFixed(2)}`);
  }

  // Unmapped market types, with volumes — the TEAM_TOTAL / DRAW_NO_BET question.
  const unmapped: Record<string, number> = {};
  for (const p of preds) if (!toBookmakerSelection(p.marketType as never, p.selection as Selection)) unmapped[p.marketType] = (unmapped[p.marketType] ?? 0) + 1;
  console.log("\n=== market types the gate cannot price at all ===");
  for (const [m, n] of Object.entries(unmapped).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${m}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : e); process.exit(1); });

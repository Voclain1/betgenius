/**
 * Before/after comparison for the market-risk calibration change, on real
 * fixtures, using the SAME stored evidence for both prompts.
 *
 * Same method as the original calibration approval harness
 * (scripts/sample-risk-calibration.ts): re-prompt from each prediction's stored
 * MatchDigest, so the only variable between the two drafts is the prompt text.
 * No api-football quota is spent — the evidence is already on the AIJob.
 *
 * Fixtures are chosen by MARKET LOPSIDEDNESS, read from FixtureOddsCache rather
 * than from the model's own confidence. That independence is the point: the
 * question is whether the prompt responds to how one-sided a fixture really is,
 * and grading it against the model's own opinion would beg that question.
 *
 * Run: npx tsx --env-file=.env scripts/compare-market-calibration.ts [perBand] [band] [stored]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { parseStoredContext } from "../src/lib/ai/context";
import { generatePredictionForFixture } from "../src/lib/ai/analysis";
import { deriveMarketAndPick, type MarketType } from "../src/lib/markets";
import { resolveGenerationRisk } from "../src/lib/ai/generationRisk";
import { matchKey } from "../src/lib/slug";
import { impliedProbability, findSelection, type FixtureOdds } from "../src/lib/odds";

function favouriteProbability(odds: FixtureOdds | null): number | null {
  if (!odds) return null;
  const prices = ["Home", "Draw", "Away"].map((v) => findSelection(odds, "Match Winner", v)?.best).filter((p): p is number => p != null);
  if (prices.length < 3) return null;
  const raw = prices.map(impliedProbability);
  return Math.max(...raw) / (raw.reduce((a, b) => a + b, 0) / 100);
}

const BANDS = [
  { key: "EXTREME", label: "extreme mismatch (fav 75%+)", lo: 75, hi: 101, want: "MATCH_WINNER" },
  { key: "STRONG", label: "strong favourite (65-75%)", lo: 65, hi: 75, want: "either" },
  { key: "MODERATE", label: "moderate favourite (48-60%)", lo: 48, hi: 60, want: "hedge" },
  { key: "CLOSE", label: "close fixture (fav < 45%)", lo: 0, hi: 45, want: "hedge or lower confidence" },
] as const;

async function main() {
  const perBand = Number(process.argv[2]) || 2;
  // Optional band filter: the EXTREME band is the one where behaviour is
  // supposed to change, so it is worth sampling on its own and harder.
  const onlyBand = process.argv[3]?.toUpperCase();
  const useStoredBaseline = process.argv[4]?.toLowerCase() === "stored";

  const rows = await prisma.prediction.findMany({
    where: { aiJob: { isNot: null } },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: {
      id: true, homeTeam: true, awayTeam: true, leagueName: true, leagueApiId: true,
      marketType: true, selection: true, reasoning: true, confidence: true,
      homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
      aiJob: { select: { context: true, prompt: true } },
    },
  });

  const keys = [...new Set(rows.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const cached = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: keys }, fetchedAt: { not: null } },
    select: { matchKey: true, oddsJson: true },
  });
  const oddsByKey = new Map(cached.map((c) => [c.matchKey, (c.oddsJson as unknown as FixtureOdds | null) ?? null]));

  const priced = rows
    .map((r) => {
      const key = matchKey(r);
      const fav = favouriteProbability(key ? (oddsByKey.get(key) ?? null) : null);
      return fav == null || !parseStoredContext(r.aiJob?.context) ? null : { ...r, fav };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  console.log(`${priced.length} predictions have both stored evidence and a cached market price.\n`);

  const summary: any[] = [];

  for (const band of BANDS) {
    if (onlyBand && band.key !== onlyBand) continue;
    const pool = priced.filter((r) => r.fav >= band.lo && r.fav < band.hi);
    // One prediction per fixture — several markets share a fixture and would
    // otherwise re-prompt the same evidence and inflate the sample.
    const seen = new Set<string>();
    const picked = pool.filter((r) => {
      const k = matchKey(r)!;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, perBand);

    console.log(`===== ${band.label} — expected: ${band.want} (pool ${pool.length}, sampling ${picked.length}) =====`);

    for (const row of picked) {
      const digest = parseStoredContext(row.aiJob!.context)!;
      let categories: string[] = [];
      try { categories = JSON.parse(row.aiJob!.prompt)?.categories ?? []; } catch {}
      const route = resolveGenerationRisk(categories, row.leagueApiId);

      // generatePredictionForFixture returns { output, usage, model } — the
      // predictions live under .output, as sample-risk-calibration.ts also does.
      const render = (result: any) => {
        const p = result.output.predictions[0];
        const d = deriveMarketAndPick(p.marketType, p.selection, row.homeTeam ?? "Home", row.awayTeam ?? "Away", { market: p.marketType, pick: "" });
        return { marketType: p.marketType, pick: d.pick, confidence: Math.round(p.confidence), reasoning: String(p.reasoning ?? "").slice(0, 150) };
      };

      try {
        const before = useStoredBaseline
          ? (() => {
              const marketType = row.marketType as MarketType;
              const d = deriveMarketAndPick(marketType, row.selection as any, row.homeTeam ?? "Home", row.awayTeam ?? "Away", { market: row.marketType, pick: "" });
              return { marketType: row.marketType, pick: d.pick, confidence: Math.round(row.confidence), reasoning: String(row.reasoning ?? "").slice(0, 150) };
            })()
          : render(await generatePredictionForFixture({ digest, tiers: route.promptTiers, riskCalibration: "tiered" }));
        const after = render(await generatePredictionForFixture({ digest, tiers: route.promptTiers, riskCalibration: "margin" }));

        console.log(`\n  ${row.homeTeam} v ${row.awayTeam}  [${row.leagueName}]  tier=${route.promptTiers.join("+")}  market fav=${row.fav.toFixed(1)}%`);
        console.log(`    BEFORE (${useStoredBaseline ? "stored" : "tiered"}): ${before.marketType.padEnd(14)} ${before.pick} @ ${before.confidence}%`);
        console.log(`    AFTER  (margin): ${after.marketType.padEnd(14)} ${after.pick} @ ${after.confidence}%`);
        console.log(`    changed: ${before.marketType !== after.marketType ? `YES  ${before.marketType} -> ${after.marketType}` : "no"}`);
        console.log(`    after reasoning: ${after.reasoning}...`);

        summary.push({ band: band.key, fav: row.fav, tier: route.promptTiers.join("+"), before: before.marketType, after: after.marketType, beforeConf: before.confidence, afterConf: after.confidence });
      } catch (err: any) {
        console.log(`\n  ${row.homeTeam} v ${row.awayTeam}: generation failed — ${err?.message ?? err}`);
      }
    }
    console.log("");
  }

  console.log("===== SUMMARY =====");
  for (const band of BANDS) {
    const sub = summary.filter((s) => s.band === band.key);
    if (!sub.length) continue;
    const mwBefore = sub.filter((s) => s.before === "MATCH_WINNER").length;
    const mwAfter = sub.filter((s) => s.after === "MATCH_WINNER").length;
    const changed = sub.filter((s) => s.before !== s.after).length;
    console.log(`  ${band.label.padEnd(30)} n=${sub.length}  MATCH_WINNER ${mwBefore} -> ${mwAfter}  (${changed} changed market)`);
  }
  console.log("\nNote: this is a SAMPLE at model temperature, not a settled-outcome measurement.");
  console.log("It shows how the prompt responds to margin. Whether the picks are RIGHT is what");
  console.log("the standing calibration panel on /admin/generation answers, once they settle.");

  await prisma.$disconnect();
}

main();

/**
 * VIP/Premium Sprint 10: settle the recorded alternative-market observations.
 *
 * Every observation was recorded BEFORE kickoff (evaluatedAt < kickoff is
 * checked here; anything else is excluded). Outcomes come from the final
 * score stored on settled production rows for the same fixture
 * (finalHomeScore/finalAwayScore), resolved with resolveMarket. Fixtures with
 * no settled sibling, or with conflicting stored scores, stay PENDING. Returns
 * use the entry price recorded at evaluation (the median pre-kickoff quote for
 * the exact selection). READ-ONLY.
 *
 * Run: REQUIRE_READ_ONLY=1 npx tsx scripts/settle-alt-market-experiment.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { resolveMarket, type MarketType, type Selection } from "../src/lib/markets";
import { wilson95 } from "../src/lib/paidMarketQuality";
import { CAPS, DECISION, researchDecision } from "../src/lib/altMarketResearch";

const OBS_DIR = join(__dirname, "../research/alt-market/observations");

async function main() {
  if (process.env.REQUIRE_READ_ONLY !== "1") throw new Error("refusing: REQUIRE_READ_ONLY=1 is required");
  const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
  if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  const obs = existsSync(OBS_DIR) ? readdirSync(OBS_DIR).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(join(OBS_DIR, f), "utf8")).observations as any[]) : [];
  console.log(`observations ${obs.length} (caps: ${CAPS.MAX_EVALUATIONS} evaluations, ${CAPS.MAX_MODEL_REQUESTS} requests, ${CAPS.MAX_COST_USD} USD); spent ${obs.reduce((s, o) => s + (o.modelRequests ?? 0), 0)} requests, ${obs.reduce((s, o) => s + (o.costUsd ?? 0), 0).toFixed(4)} USD`);

  const preKickoff = obs.filter((o) => Date.parse(o.evaluatedAt) < Date.parse(o.kickoff));
  if (preKickoff.length !== obs.length) console.log(`excluded ${obs.length - preKickoff.length} observations not recorded before kickoff`);
  const evaluated = preKickoff.filter((o) => o.outcome !== "ERROR");
  const qualifying = evaluated.filter((o) => o.outcome === "VIP" || o.outcome === "PREMIUM");
  const incremental = qualifying.filter((o) => o.incremental);

  const rows: Array<{ o: any; result: "WON" | "LOST" | "VOID" | "PENDING" }> = [];
  for (const o of qualifying) {
    const [h, a] = String(o.matchKey).split("-").map(Number);
    const k = new Date(o.kickoff);
    const sib = await prisma.prediction.findMany({
      where: { homeTeamApiId: h, awayTeamApiId: a, kickoff: { gte: new Date(k.getTime() - 36 * 3_600_000), lte: new Date(k.getTime() + 36 * 3_600_000) }, outcome: { in: ["WON", "LOST"] }, finalHomeScore: { not: null }, finalAwayScore: { not: null } },
      select: { finalHomeScore: true, finalAwayScore: true },
    });
    const scores = new Set(sib.map((s) => `${s.finalHomeScore}-${s.finalAwayScore}`));
    if (scores.size !== 1) { rows.push({ o, result: "PENDING" }); continue; }
    const [fh, fa] = [...scores][0].split("-").map(Number);
    const r = resolveMarket(o.best.marketType as MarketType, o.best.selection as Selection, fh, fa);
    rows.push({ o, result: r ?? "PENDING" });
  }

  const wilson = wilson95(qualifying.length, evaluated.length);
  console.log(`\nevaluated ${evaluated.length} (errors ${preKickoff.length - evaluated.length})`);
  for (const g of ["CORE", "SECONDARY"]) {
    const e = evaluated.filter((o) => o.group === g), q = e.filter((o) => o.outcome === "VIP" || o.outcome === "PREMIUM");
    console.log(`  ${g}: evaluated ${e.length}, VIP-or-better ${q.length}, PREMIUM ${q.filter((o) => o.outcome === "PREMIUM").length}, incremental ${q.filter((o) => o.incremental).length}`);
  }
  console.log(`qualification ${qualifying.length}/${evaluated.length}${wilson ? ` (Wilson 95% ${(100 * wilson[0]).toFixed(0)}-${(100 * wilson[1]).toFixed(0)}%)` : ""}; incremental ${incremental.length}; on dry days ${incremental.filter((o) => o.dryDay).length}`);
  console.log(`research decision (pre-registered: GO >= ${DECISION.GO_MIN_INCREMENTAL} incremental and Wilson lower >= ${100 * DECISION.GO_MIN_WILSON_LOWER}%; NO-GO <= ${DECISION.NOGO_MAX_INCREMENTAL}): ${researchDecision(evaluated.length, incremental.length, wilson?.[0] ?? null)}`);

  const decided = rows.filter((r) => r.result === "WON" || r.result === "LOST");
  const won = decided.filter((r) => r.result === "WON").length;
  const priced = decided.filter((r) => typeof r.o.best?.entryPrice === "number" && r.o.best.entryPrice > 1);
  const ret = priced.reduce((s, r) => s + (r.result === "WON" ? r.o.best.entryPrice - 1 : -1), 0);
  const sci = wilson95(won, decided.length);
  console.log(`\nsettlement: qualifying ${rows.length}, decided ${decided.length}, pending ${rows.filter((r) => r.result === "PENDING").length}`);
  if (decided.length) {
    console.log(`  strike ${won}/${decided.length}${sci ? ` (Wilson 95% ${(100 * sci[0]).toFixed(0)}-${(100 * sci[1]).toFixed(0)}%)` : ""}; mean stated confidence ${(decided.reduce((s, r) => s + r.o.best.confidence, 0) / decided.length).toFixed(1)}; mean market ${(decided.reduce((s, r) => s + (r.o.best.marketProbability ?? 0), 0) / decided.length).toFixed(1)}%`);
    console.log(`  entry-price ROI ${priced.length ? `${((100 * ret) / priced.length).toFixed(1)}% on ${priced.length}` : "n/a"} (exploratory; far too few picks to read as profitability)`);
  }
  for (const r of rows) console.log(`  ${r.o.lagosDay} ${r.o.group} ${r.o.fixture}: ${r.o.best.pick} @ ${r.o.best.confidence}/${r.o.best.marketProbability?.toFixed?.(1)} price ${r.o.best.entryPrice ?? "—"} -> ${r.result}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

/**
 * VIP/Premium Sprint 08: bounded qualification-loosening research.
 *
 *   1. Build the universe (read-only): settled published singles at
 *      confidence >= 70, plus dedicated-pass drafts the gate archived for
 *      MODEL_BELOW_FLOOR (confidence < 75, the only rejection reason that can
 *      be reconstructed exactly), resolved from a settled sibling row's final
 *      score on the same fixture.
 *   2. Split chronologically into dev-train / dev-validate / final holdout
 *      (50 / 20 / 30 %, kickoff-grouped).
 *   3. For every pre-registered candidate (src/lib/qualificationResearch.ts),
 *      compare baseline, additions and combined selection on dev-train and
 *      dev-validate and apply the fixed promotion rule.
 *   4. Score only promoted candidates on the holdout, once.
 *
 * Returns are at the recorded entry price where one exists, otherwise the last
 * PRE-KICKOFF quote (a closing reference). Never realized returns. A quote
 * taken after kickoff is never used.
 *
 * READ-ONLY. Run: npx tsx --env-file=.env scripts/research-qualification-loosening.ts [days=150]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { matchKey } from "../src/lib/slug";
import type { FixtureOdds } from "../src/lib/odds";
import { pickPrice } from "../src/lib/paidSelection";
import { verifiedEntryPrice } from "../src/lib/paidEntryEvidence";
import { PAID_ANY_LEAGUE_IDS, VIP_PREMIUM_INTENT } from "../src/lib/vipPremiumOverlay";
import { VIP_ROUTE_PROVENANCE } from "../src/lib/geniusCuration";
import { providerOf } from "../src/lib/calibration";
import { resolveMarket, type MarketType } from "../src/lib/markets";
import { isEligibleMarketType } from "../src/lib/marketConfirmed";
import { threeWaySplit } from "../src/lib/paidPolicyResearch";
import {
  CANDIDATES, LOOSENING_PROMOTION, activeDays, additions, baseline, holdoutDecision, policySelection, promotionDecision, stats,
  type ResearchRow, type Stats,
} from "../src/lib/qualificationResearch";

const pct = (x: number | null) => (x == null ? "—" : `${(100 * x).toFixed(1)}%`);
const fmt = (s: Stats) =>
  `n ${String(s.n).padStart(4)} W/L/V ${s.wins}/${s.losses}/${s.voids} win ${pct(s.winRate)} [${s.wilson95 ? s.wilson95.map(pct).join("–") : "—"}]`
  + ` priced ${s.priced} ROI ${s.roiPct == null ? "n<30" : `${s.roiPct.toFixed(1)}%`}${s.roi90 ? ` [90% ${s.roi90[0].toFixed(1)}, ${s.roi90[1].toFixed(1)}]` : ""}`
  + ` odds ${s.meanOdds?.toFixed(2) ?? "—"} Brier m/mkt ${s.brierModel?.toFixed(3) ?? "—"}/${s.brierMarket?.toFixed(3) ?? "—"} (n${s.brierN})`
  + ` perDay ${s.perDay?.toFixed(2) ?? "—"} zeroDays ${s.zeroDays}/${s.activeDays}`;
const dist = (s: Stats) => `odds ${JSON.stringify(s.oddsBands)} market ${JSON.stringify(s.marketBands)} leagues ${s.topLeagues.map(([k, v]) => `${k} ${v}`).join(", ")} | unpriced-as-loss ROI ${s.roiUnpricedAsLossPct?.toFixed(1) ?? "—"}%`;

async function loadUniverse(since: Date, now: Date) {
  const published = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED", outcome: { in: ["WON", "LOST", "VOID"] }, confidence: { gte: 70 },
      kickoff: { gte: since, lt: now }, marketType: { not: "SAME_GAME_DOUBLE" },
    },
    select: {
      id: true, kickoff: true, leagueApiId: true, leagueName: true, marketType: true, selection: true, confidence: true, outcome: true,
      homeTeamApiId: true, awayTeamApiId: true, marketConfirmation: true, provenance: true,
      categories: { select: { category: true } }, aiJob: { select: { model: true } },
    },
    take: 40_000,
  });
  // Dedicated drafts the gate archived. Only < 75 confidence: MODEL_BELOW_FLOOR
  // is deterministic from the row, every other rejection reason depended on a
  // quote that was not kept.
  const archived = await prisma.prediction.findMany({
    where: { status: "ARCHIVED", confidence: { gte: 70, lt: 75 }, kickoff: { gte: since, lt: now }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: {
      id: true, kickoff: true, leagueApiId: true, leagueName: true, marketType: true, selection: true, confidence: true,
      homeTeamApiId: true, awayTeamApiId: true, aiJob: { select: { model: true, prompt: true } },
    },
    take: 20_000,
  });
  const dedicatedRejected = archived.filter((a) => {
    try { return JSON.parse(a.aiJob?.prompt ?? "null")?.intent === VIP_PREMIUM_INTENT; } catch { return false; }
  });

  // Final scores from settled siblings on the same fixture (auto-settled rows carry regulation-time scores).
  const allKeys = new Set<string>();
  for (const r of [...published, ...dedicatedRejected]) { const k = matchKey(r); if (k) allKeys.add(k); }
  const scoreByKey = new Map<string, { h: number; a: number }>();
  const scored = await prisma.prediction.findMany({
    where: {
      kickoff: { gte: since, lt: now }, outcome: { in: ["WON", "LOST"] }, finalHomeScore: { not: null }, finalAwayScore: { not: null },
    },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true, finalHomeScore: true, finalAwayScore: true },
    take: 60_000,
  });
  const conflicting = new Set<string>();
  for (const s of scored) {
    const k = matchKey(s);
    if (!k) continue;
    const prev = scoreByKey.get(k);
    if (prev && (prev.h !== s.finalHomeScore || prev.a !== s.finalAwayScore)) conflicting.add(k);
    else scoreByKey.set(k, { h: s.finalHomeScore!, a: s.finalAwayScore! });
  }
  for (const k of conflicting) scoreByKey.delete(k);

  const quotes = new Map<string, { oddsJson: FixtureOdds | null; fetchedAt: Date | null }>();
  const keys = [...allKeys];
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) {
      quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
    }
  }
  const leagueNames = new Map<number, string>();
  let postKickoff = 0;
  const priceOf = (r: { kickoff: Date; marketType: string; selection: unknown; marketConfirmation?: unknown }, key: string) => {
    const q = quotes.get(key);
    const pre = !!q?.fetchedAt && q.fetchedAt < r.kickoff;
    if (q?.fetchedAt && !pre) postKickoff++;
    const price = pre ? pickPrice(q!.oddsJson, r.marketType, r.selection) : null;
    const entry = r.marketConfirmation ? verifiedEntryPrice(r.marketConfirmation, r.kickoff) : null;
    const mc = r.marketConfirmation as any;
    const executable = price && !price.derived ? price : null;
    return {
      odds: entry ?? executable?.median ?? null,
      marketProbability: entry && typeof mc?.marketProbability === "number" ? mc.marketProbability : executable?.fair ?? null,
      bookmakers: entry && typeof mc?.bookmakers === "number" ? mc.bookmakers : executable?.bookmakers ?? null,
      priceSource: (entry ? "entry" : executable ? "closing" : "missing") as ResearchRow["priceSource"],
    };
  };

  const rows: ResearchRow[] = [];
  let excludedCombos = 0;
  for (const r of published) {
    if (!r.kickoff) continue;
    const cats = r.categories.map((c) => c.category);
    if (cats.includes("SAME_GAME_DOUBLE")) { excludedCombos++; continue; }
    const key = matchKey(r) ?? `id:${r.id}`;
    if (r.leagueApiId != null && r.leagueName) leagueNames.set(r.leagueApiId, r.leagueName);
    rows.push({
      id: r.id, fixtureKey: key, leagueApiId: r.leagueApiId, marketType: r.marketType, kickoff: r.kickoff, day: lagosDateKey(r.kickoff),
      confidence: r.confidence, outcome: r.outcome as ResearchRow["outcome"], source: "PUBLISHED",
      paidTiers: cats.filter((c): c is "VIP" | "PREMIUM" => c === "VIP" || c === "PREMIUM"),
      vipRoute: r.provenance === VIP_ROUTE_PROVENANCE, inPaidScope: PAID_ANY_LEAGUE_IDS.includes(r.leagueApiId ?? -1),
      provider: providerOf(r.aiJob?.model), ...priceOf({ ...r, kickoff: r.kickoff }, key),
    });
  }
  let unresolved = 0;
  for (const d of dedicatedRejected) {
    if (!d.kickoff) continue;
    const key = matchKey(d);
    const score = key ? scoreByKey.get(key) : undefined;
    if (!key || !score || !isEligibleMarketType(d.marketType)) { unresolved++; continue; }
    const outcome = resolveMarket(d.marketType as MarketType, d.selection as any, score.h, score.a);
    if (!outcome) { unresolved++; continue; }
    if (d.leagueApiId != null && d.leagueName) leagueNames.set(d.leagueApiId, d.leagueName);
    rows.push({
      id: d.id, fixtureKey: key, leagueApiId: d.leagueApiId, marketType: d.marketType, kickoff: d.kickoff, day: lagosDateKey(d.kickoff),
      confidence: d.confidence, outcome, source: "DEDICATED_REJECTED", paidTiers: [], vipRoute: false,
      inPaidScope: PAID_ANY_LEAGUE_IDS.includes(d.leagueApiId ?? -1), provider: providerOf(d.aiJob?.model), ...priceOf({ ...d, kickoff: d.kickoff }, key),
    });
  }
  return { rows, postKickoff, excludedCombos, dedicatedRejected: dedicatedRejected.length, unresolved, conflictingScores: conflicting.size, leagueNames };
}

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.min(365, Math.max(30, Number(process.argv[2]) || 150));
  const now = new Date();
  const u = await loadUniverse(new Date(now.getTime() - days * 86_400_000), now);
  const name = (id: number | null) => (id == null ? "unknown" : u.leagueNames.get(id) ?? String(id));
  const split = threeWaySplit(u.rows);
  console.log(`universe ${u.rows.length} rows (${days}d): published ${u.rows.filter((r) => r.source === "PUBLISHED").length}, dedicated MODEL_BELOW_FLOOR drafts resolved ${u.rows.filter((r) => r.source === "DEDICATED_REJECTED").length} of ${u.dedicatedRejected} (unresolved ${u.unresolved}); combos excluded ${u.excludedCombos}; post-kickoff quotes discarded ${u.postKickoff}; fixtures with conflicting stored scores dropped ${u.conflictingScores}`);
  console.log(`periods: dev-train ${split.devTrain.length} | dev-validate ${split.devValidate.length} (from ${split.boundaries[0]?.slice(0, 16)}) | FINAL HOLDOUT ${split.holdout.length} (from ${split.boundaries[1]?.slice(0, 16)})`);
  console.log(`providers by period: ${(["devTrain", "devValidate", "holdout"] as const).map((p) => `${p} ${JSON.stringify(split[p].reduce<Record<string, number>>((a, r) => { a[r.provider ?? "unknown"] = (a[r.provider ?? "unknown"] ?? 0) + 1; return a; }, {}))}`).join(" | ")}`);
  console.log(`promotion rule (pre-registered): ${JSON.stringify(LOOSENING_PROMOTION)}`);
  console.log("returns: entry price where recorded, else last pre-kickoff quote (closing reference), flat 1 unit; NOT realized returns");

  const periodStats = (rows: ResearchRow[], c: (typeof CANDIDATES)[number]) => {
    const d = activeDays(rows);
    return { base: stats(baseline(rows, c.tier), d, name), added: stats(additions(rows, c), d, name), combined: stats(policySelection(rows, c), d, name) };
  };

  // Baselines and the confidence-band calibration on development data only.
  const dev = [...split.devTrain, ...split.devValidate];
  for (const tier of ["VIP", "PREMIUM"] as const) {
    console.log(`\n==== ${tier} baseline (fixture-deduplicated) ====`);
    console.log(`  dev-train    ${fmt(stats(baseline(split.devTrain, tier), activeDays(split.devTrain), name))}`);
    console.log(`  dev-validate ${fmt(stats(baseline(split.devValidate, tier), activeDays(split.devValidate), name))}`);
    console.log(`  dev          ${dist(stats(baseline(dev, tier), activeDays(dev), name))}`);
  }
  console.log("\n==== development calibration, paid-scope singles by confidence band (all sources) ====");
  for (const [lo, hi] of [[70, 73], [73, 75], [75, 78], [78, 80], [80, 101]] as const) {
    const band = dev.filter((r) => r.inPaidScope && r.confidence >= lo && r.confidence < hi);
    const s = stats(band, activeDays(dev), name);
    console.log(`  conf ${lo}-${hi - 1}: ${fmt(s)}`);
    for (const prov of ["claude", "gemini"]) {
      const b = band.filter((r) => r.provider === prov);
      if (b.length) console.log(`      ${prov.padEnd(7)} ${fmt(stats(b, activeDays(dev), name))}`);
    }
  }

  const promoted: typeof CANDIDATES[number][] = [];
  for (const c of CANDIDATES) {
    console.log(`\n==== ${c.name} (${c.tier}; ${c.changesPublishedFloor ? "LOWERS A PUBLISHED CONFIDENCE FLOOR" : "no published-floor change"}) ====`);
    console.log(`  ${c.rationale}`);
    const t = periodStats(split.devTrain, c), v = periodStats(split.devValidate, c);
    for (const [label, s] of [["dev-train", t], ["dev-validate", v]] as const) {
      console.log(`  ${label.padEnd(12)} baseline ${fmt(s.base)}`);
      console.log(`  ${"".padEnd(12)} added    ${fmt(s.added)}`);
      console.log(`  ${"".padEnd(12)} combined ${fmt(s.combined)}`);
    }
    const addedDev = additions(dev, c);
    console.log(`  added (dev) by source ${JSON.stringify(addedDev.reduce<Record<string, number>>((a, r) => { a[r.source] = (a[r.source] ?? 0) + 1; return a; }, {}))}; ${dist(stats(addedDev, activeDays(dev), name))}`);
    const decision = promotionDecision(t, v);
    console.log(`  ${decision.pass ? "PROMOTED to final holdout" : "not promoted"}: ${decision.reasons.join("; ")}`);
    if (decision.pass) promoted.push(c);
  }

  console.log(`\n==== FINAL HOLDOUT (evaluated once; ${promoted.length} promoted) ====`);
  for (const tier of ["VIP", "PREMIUM"] as const) console.log(`  ${tier} baseline ${fmt(stats(baseline(split.holdout, tier), activeDays(split.holdout), name))}`);
  if (!promoted.length) console.log("  No candidate met the promotion rule on development data: none is scored on the holdout. Result: retain the existing qualification rules.");
  for (const c of promoted) {
    const h = periodStats(split.holdout, c);
    console.log(`  ${c.name}: added ${fmt(h.added)}`);
    console.log(`      combined ${fmt(h.combined)}`);
    console.log(`      ${dist(h.added)}`);
    const verdict = holdoutDecision(h);
    console.log(`      VERDICT ${verdict.pass ? "CREDIBLE_IMPROVEMENT" : "NO_CREDIBLE_IMPROVEMENT"}: ${verdict.reasons.join("; ")}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

/**
 * League-coverage funnel audit: where fixtures leave the pipeline, per
 * competition, with Wales in detail.
 *
 *   A. Discovery decisions: how often the adaptive scope stayed HEALTHY (CORE +
 *      SECONDARY only), widened to FALLBACK, or widened to DEEP_FALLBACK, from
 *      the generation-discovery JobRuns. Sweep skips and gate rejections.
 *   B. Funnel by competition over the window: ledger rows (discovered), their
 *      status, priced before kickoff, predictions created / published, and
 *      VIP / PREMIUM picks. One row per league; tier and paid scope shown.
 *   C. Starvation: ledger rows that reached kickoff never attempted, by tier.
 *   D. Wales: every ledger row and prediction for the Welsh competitions in
 *      the catalogue, plus any row whose name says Wales/Welsh/Cymru under an
 *      id the catalogue does not know.
 *   E. Catalogue leagues with zero ledger rows in the window.
 *
 * READ-ONLY. No provider calls, no writes. With REQUIRE_READ_ONLY=1 it refuses
 * to start unless the session reports transaction_read_only = on.
 *
 * Run: npx tsx --env-file=.env scripts/measure-league-coverage.ts [days=30]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { GENERATION_TIER_ORDER, LEAGUE_CATALOGUE, generationTierOf, type GenerationTier } from "../src/lib/leagues";
import { MIN_BOOKMAKERS } from "../src/lib/odds";
import { PAID_ANY_LEAGUE_IDS } from "../src/lib/vipPremiumOverlay";
import { JOB_GENERATION_DISCOVERY } from "../src/lib/jobRuns";
import { lagosDateKey } from "../src/lib/lagosDate";
import { auditCoverageFunnel, WELSH_NAME } from "../src/lib/generation/coverageFunnel";

const DAY = 86_400_000;

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error(`refusing: session is not read-only (transaction_read_only = ${ro?.transaction_read_only})`);
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.min(120, Math.max(1, Number(process.argv[2]) || 30));
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY);
  const to = new Date(now.getTime() + 2 * DAY);
  console.log(`window: kickoffs ${from.toISOString().slice(0, 10)} .. ${to.toISOString().slice(0, 10)} (${days} days back, 2 ahead)`);

  // A. Discovery decisions --------------------------------------------------
  const runs = await prisma.jobRun.findMany({
    where: { job: JOB_GENERATION_DISCOVERY, ranAt: { gte: from } },
    select: { ranAt: true, ok: true, detail: true },
    orderBy: { ranAt: "asc" },
    take: 20_000,
  });
  const modes: Record<string, number> = {};
  const modeByDay = new Map<string, Record<string, number>>();
  const skips: Record<string, number> = {};
  const rejected: Record<string, number> = {};
  const selectedByTier: Record<string, number> = {};
  let sweeps = 0;
  for (const r of runs) {
    const c = (r.detail as any)?.coverage;
    if (!c) continue;
    modes[c.mode] = (modes[c.mode] ?? 0) + 1;
    const day = lagosDateKey(r.ranAt);
    const m = modeByDay.get(day) ?? {};
    m[c.mode] = (m[c.mode] ?? 0) + 1;
    modeByDay.set(day, m);
    if (c.sweep?.ran) sweeps++;
    else if (c.widened && c.sweep?.skippedReason) {
      const k = String(c.sweep.skippedReason).replace(/\d+/g, "N");
      skips[k] = (skips[k] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(c.sweep?.gateRejected ?? {})) rejected[k] = (rejected[k] ?? 0) + Number(v);
    for (const [k, v] of Object.entries(c.fallbackSelectedByTier ?? {})) selectedByTier[k] = (selectedByTier[k] ?? 0) + Number(v);
  }
  console.log(`\n== A. Discovery decisions (${runs.length} runs) ==`);
  console.log("mode counts:", JSON.stringify(modes));
  console.log(`sweeps run: ${sweeps}`);
  console.log("sweep skipped (widened, not run):", JSON.stringify(skips));
  console.log("fallback gate rejections (summed over sweeps):", JSON.stringify(rejected));
  console.log("fallback fixtures queued by tier:", JSON.stringify(selectedByTier));
  console.log("days with any DEEP_FALLBACK decision:", [...modeByDay.entries()].filter(([, m]) => m.DEEP_FALLBACK).map(([d, m]) => `${d}(${m.DEEP_FALLBACK}/${Object.values(m).reduce((a, b) => a + b, 0)})`).join(" ") || "none");

  // B. Funnel by competition -----------------------------------------------
  const [ledger, preds] = await Promise.all([
    prisma.generationAttempt.findMany({
      where: { kickoff: { gte: from, lt: to } },
      select: { matchKey: true, leagueApiId: true, leagueName: true, homeTeam: true, awayTeam: true, kickoff: true, status: true, attempts: true, lastError: true },
      take: 50_000,
    }),
    prisma.prediction.findMany({
      where: { kickoff: { gte: from, lt: to } },
      select: { leagueApiId: true, leagueName: true, homeTeam: true, awayTeam: true, kickoff: true, status: true, homeTeamApiId: true, awayTeamApiId: true, categories: { select: { category: true } } },
      take: 50_000,
    }),
  ]);
  const keys = [...new Set(ledger.map((l) => l.matchKey))];
  const odds: Array<{ matchKey: string; bookmakerCount: number | null; fetchedAt: Date | null }> = [];
  for (let i = 0; i < keys.length; i += 2000) {
    odds.push(...(await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 2000) } }, select: { matchKey: true, bookmakerCount: true, fetchedAt: true } })));
  }
  const funnel = auditCoverageFunnel({
    ledger,
    predictions: preds.map((p) => ({ ...p, categories: p.categories.map((c) => c.category) })),
    odds,
    now,
    minBookmakers: MIN_BOOKMAKERS,
  });
  console.log(`\n== B. Funnel by competition (${ledger.length} ledger rows, ${preds.length} predictions) ==`);
  console.log("tier          league                                  id    discovered succeeded failed abandoned pending priced predicted published vip premium paidScope");
  for (const row of funnel.leagues) {
    console.log([
      (row.tier ?? "UNCATALOGUED").padEnd(13), (row.name ?? "?").slice(0, 38).padEnd(39), String(row.leagueApiId ?? "-").padStart(5),
      String(row.discovered).padStart(11), String(row.succeeded).padStart(9), String(row.failed).padStart(6), String(row.abandoned).padStart(9),
      String(row.pending).padStart(7), String(row.priced).padStart(6), String(row.predicted).padStart(9), String(row.published).padStart(9),
      String(row.vip).padStart(3), String(row.premium).padStart(7), PAID_ANY_LEAGUE_IDS.includes(row.leagueApiId ?? -1) ? "  yes" : "   no",
    ].join(" "));
  }
  console.log("\nby tier:");
  for (const t of [...GENERATION_TIER_ORDER, "UNCATALOGUED"] as const) {
    const s = funnel.byTier[t];
    if (s) console.log(`  ${t.padEnd(13)} leagues ${s.leagues}, discovered ${s.discovered}, succeeded ${s.succeeded}, published ${s.published}, vip ${s.vip}, premium ${s.premium}`);
  }

  // C. Starvation -----------------------------------------------------------
  console.log("\n== C. Reached kickoff never attempted (PENDING, attempts 0, kickoff passed) ==");
  console.log(JSON.stringify(funnel.starvedByTier));
  console.log("top leagues:", funnel.starvedTop.map((s) => `${s.name}(${s.leagueApiId}) ${s.count}`).join(", ") || "none");

  // D. Wales ----------------------------------------------------------------
  const welshIds = new Set<number>(LEAGUE_CATALOGUE.filter((l) => l.country === "Wales").map((l) => l.id));
  console.log(`\n== D. Wales (catalogue ids ${[...welshIds].join(", ")}; tiers ${[...welshIds].map((id) => `${id}:${generationTierOf(id)}`).join(", ")}) ==`);
  const welshLedger = ledger.filter((l) => welshIds.has(l.leagueApiId ?? -1) || WELSH_NAME.test(l.leagueName ?? ""));
  const welshPreds = preds.filter((p) => welshIds.has(p.leagueApiId ?? -1) || WELSH_NAME.test(p.leagueName ?? ""));
  console.log(`ledger rows: ${welshLedger.length}; predictions: ${welshPreds.length}`);
  for (const l of welshLedger.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime())) {
    console.log(`  ledger ${l.kickoff.toISOString().slice(0, 16)} ${l.leagueApiId} ${l.homeTeam} v ${l.awayTeam}: ${l.status} attempts ${l.attempts}${l.lastError ? ` (${l.lastError.slice(0, 90)})` : ""}`);
  }
  for (const p of welshPreds.sort((a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0))) {
    console.log(`  prediction ${p.kickoff?.toISOString().slice(0, 16)} ${p.leagueApiId} ${p.homeTeam} v ${p.awayTeam}: ${p.status} [${p.categories.map((c) => c.category).join(",")}]`);
  }

  // E. Silent catalogue leagues --------------------------------------------
  const seen = new Set(ledger.map((l) => l.leagueApiId));
  const silent = LEAGUE_CATALOGUE.filter((l) => !seen.has(l.id));
  const silentByTier: Partial<Record<GenerationTier | "UNTIERED", string[]>> = {};
  for (const l of silent) (silentByTier[generationTierOf(l.id) ?? "UNTIERED"] ??= []).push(`${l.name} (${l.country}, ${l.id})`);
  console.log(`\n== E. Catalogue leagues with no ledger row in the window: ${silent.length} of ${LEAGUE_CATALOGUE.length} ==`);
  for (const [t, names] of Object.entries(silentByTier)) console.log(`  ${t} (${names!.length}): ${names!.slice(0, 40).join("; ")}${names!.length > 40 ? " …" : ""}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

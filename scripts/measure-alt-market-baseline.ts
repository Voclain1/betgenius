/**
 * VIP/Premium Sprint 10, Phase 2: read-only historical baseline for
 * alternative (goals) markets, plus the double-chance label check behind
 * favourite targeting.
 *
 *   A. Double Chance labels actually stored in FixtureOddsCache.
 *   B. Dedicated-pass targets by market/selection, as each run recorded them.
 *   C. Favourite signal as targeting computes it vs with the away double
 *      chance read under the feed's own label ("Draw/Away"): fixtures missed.
 *   D. Goals baseline, core vs secondary (settled, kicked off in window):
 *      fixtures, valid pre-kickoff goals prices, in band, not favourite-
 *      targeted, existing predictions and their goals-market confidence,
 *      books, existing paid picks, settled outcomes of the goals picks that
 *      WERE generated before kickoff.
 *   E. Dry days: goals-band fixtures available on days with <= 2 VIP picks.
 *
 * Prices are the last PRE-KICKOFF quote (a closing reference). They are not
 * claimed to have been available when any decision was made. Hypothetical
 * selections are never scored; only predictions that exist are.
 *
 * READ-ONLY. Run: npx tsx --env-file=.env scripts/measure-alt-market-baseline.ts [days=30]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { matchKey } from "../src/lib/slug";
import type { FixtureOdds } from "../src/lib/odds";
import { devigProbability, lopsidednessSignal } from "../src/lib/marketConfirmed";
import { PAID_CORE_LEAGUE_IDS, PAID_WIDENED_LEAGUE_IDS, VIP_PREMIUM_INTENT } from "../src/lib/vipPremiumOverlay";
import { DEDICATED_PAID_PROVENANCES } from "../src/lib/geniusCuration";
import { JOB_GENERATE_VIP_PREMIUM } from "../src/lib/jobRuns";
import { wilson95 } from "../src/lib/paidMarketQuality";
import { BAND, COMPARISON_SELECTIONS, TARGET_SELECTIONS, correctedFavouriteSignal, goalsBandSignal, pricedSelections } from "../src/lib/altMarketResearch";

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "—");

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.min(60, Math.max(7, Number(process.argv[2]) || 30));
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  console.log(`window: kickoffs ${from.toISOString().slice(0, 10)} .. ${now.toISOString().slice(0, 16)}`);

  // ── A. Labels ────────────────────────────────────────────────────────────
  const quotes = await prisma.fixtureOddsCache.findMany({ where: { fetchedAt: { gte: from } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } });
  const labels: Record<string, number> = {};
  for (const q of quotes) {
    const odds = q.oddsJson as unknown as FixtureOdds | null;
    for (const s of odds?.markets?.find((m) => m.market === "Double Chance")?.selections ?? []) labels[s.value] = (labels[s.value] ?? 0) + 1;
  }
  console.log(`\n== A. Double Chance selection labels in ${quotes.length} cached quotes fetched in the window ==\n  ${JSON.stringify(labels)}`);

  // ── B. Targets as recorded ───────────────────────────────────────────────
  const runs = await prisma.jobRun.findMany({ where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: from } }, select: { detail: true } });
  const targets: Record<string, number> = {};
  for (const r of runs) for (const t of ((r.detail as any)?.vipPremium?.targets ?? []) as Array<{ market: string; selection: string }>) targets[`${t.market} / ${t.selection}`] = (targets[`${t.market} / ${t.selection}`] ?? 0) + 1;
  console.log(`\n== B. Dedicated targets by the selection that qualified them (${runs.length} runs) ==\n  ${JSON.stringify(targets)}`);

  // ── Fixtures ─────────────────────────────────────────────────────────────
  const ledger = await prisma.generationAttempt.findMany({ where: { kickoff: { gte: from, lt: now }, status: "SUCCEEDED" }, select: { matchKey: true, leagueApiId: true, kickoff: true } });
  const preds = await prisma.prediction.findMany({
    where: { kickoff: { gte: from, lt: now }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: { status: true, kickoff: true, homeTeamApiId: true, awayTeamApiId: true, marketType: true, selection: true, confidence: true, outcome: true, provenance: true, createdAt: true, categories: { select: { category: true } }, aiJob: { select: { prompt: true } } },
    take: 60_000,
  });
  const qByKey = new Map<string, { odds: FixtureOdds | null; fetchedAt: Date | null }>();
  const keys = ledger.map((l) => l.matchKey);
  for (let i = 0; i < keys.length; i += 500) for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) qByKey.set(q.matchKey, { odds: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
  const predsByKey = new Map<string, typeof preds>();
  for (const p of preds) { const k = matchKey(p); if (k) predsByKey.set(k, [...(predsByKey.get(k) ?? []), p]); }

  type Row = { key: string; group: "CORE" | "SECONDARY"; day: string; asIs: number | null; corrected: number | null; goals: ReturnType<typeof goalsBandSignal>; priced: boolean; attempted: boolean; vip: boolean; premium: boolean; preds: typeof preds };
  const rows: Row[] = [];
  for (const l of ledger) {
    const group = PAID_CORE_LEAGUE_IDS.includes(l.leagueApiId ?? -1) ? "CORE" : PAID_WIDENED_LEAGUE_IDS.includes(l.leagueApiId ?? -1) ? "SECONDARY" : null;
    if (!group) continue;
    const q = qByKey.get(l.matchKey);
    const pre = q?.fetchedAt && q.fetchedAt < l.kickoff ? q.odds : null;
    const ps = predsByKey.get(l.matchKey) ?? [];
    const intentOf = (p: (typeof ps)[number]) => { try { return JSON.parse(p.aiJob?.prompt ?? "null")?.intent ?? null; } catch { return null; } };
    const pub = ps.filter((p) => p.status === "PUBLISHED");
    rows.push({
      key: l.matchKey, group, day: lagosDateKey(l.kickoff),
      asIs: lopsidednessSignal(pre)?.probability ?? null, corrected: correctedFavouriteSignal(pre)?.probability ?? null,
      goals: goalsBandSignal(pre), priced: pricedSelections(pre, TARGET_SELECTIONS).some((s) => s.bookmakers >= 5),
      attempted: ps.some((p) => intentOf(p) === VIP_PREMIUM_INTENT),
      vip: pub.some((p) => p.categories.some((c) => c.category === "VIP")), premium: pub.some((p) => p.categories.some((c) => c.category === "PREMIUM")),
      preds: ps,
    });
  }

  // ── C. Missed away favourites ────────────────────────────────────────────
  console.log("\n== C. Favourite signal as targeting computes it vs with the away double chance read under its feed label ==");
  for (const g of ["CORE", "SECONDARY"] as const) {
    const xs = rows.filter((r) => r.group === g);
    const missed = xs.filter((r) => (r.asIs ?? 0) < 75 && (r.corrected ?? 0) >= 75);
    console.log(`  ${g.padEnd(9)} fixtures ${xs.length}; signal >= 75 as computed ${xs.filter((r) => (r.asIs ?? 0) >= 75).length}; corrected ${xs.filter((r) => (r.corrected ?? 0) >= 75).length}; missed (corrected >= 75, as computed < 75) ${missed.length}, of which attempted ${missed.filter((r) => r.attempted).length}, VIP ${missed.filter((r) => r.vip).length}`);
  }

  // ── D. Goals baseline ────────────────────────────────────────────────────
  console.log("\n== D. Goals baseline (closing-reference prices; scored picks are only ones generated before kickoff) ==");
  for (const g of ["CORE", "SECONDARY"] as const) {
    const xs = rows.filter((r) => r.group === g);
    const notFav = xs.filter((r) => (r.corrected ?? 0) < 75);
    const inBand = notFav.filter((r) => r.goals);
    console.log(`  ${g}: covered ${xs.length}; with a 5+ book Over 1.5/2.5 price ${xs.filter((r) => r.priced).length}; not favourite-targeted (corrected) ${notFav.length}; of those Over 1.5/2.5 in band ${inBand.length} (${pct(inBand.length, notFav.length)})`);
    const sel: Record<string, number> = {};
    for (const r of inBand) sel[r.goals!.value] = (sel[r.goals!.value] ?? 0) + 1;
    const books = inBand.map((r) => r.goals!.bookmakers).sort((a, b) => a - b);
    console.log(`    in-band target selection ${JSON.stringify(sel)}; books median ${books[Math.floor(books.length / 2)] ?? "—"} (min ${books[0] ?? "—"})`);
    const cmp: Record<string, number> = {};
    for (const r of notFav) {
      const q = qByKey.get(r.key)!;
      for (const s of pricedSelections(q?.odds ?? null, COMPARISON_SELECTIONS)) if (s.bookmakers >= 5 && s.probability >= BAND.MIN && s.probability <= BAND.MAX) cmp[`${s.market} ${s.value}`] = (cmp[`${s.market} ${s.value}`] ?? 0) + 1;
    }
    console.log(`    comparison selections in band on the same not-targeted fixtures: ${JSON.stringify(cmp)}`);
    console.log(`    existing paid picks on in-band fixtures: VIP ${inBand.filter((r) => r.vip).length}, PREMIUM ${inBand.filter((r) => r.premium).length}; dedicated attempts ${inBand.filter((r) => r.attempted).length}`);
    // Existing goals predictions on those fixtures, generated before kickoff.
    const goalsPicks = inBand.flatMap((r) => r.preds.filter((p) => p.status === "PUBLISHED" && (p.marketType === "OVER_UNDER" || p.marketType === "BTTS") && p.kickoff && p.createdAt < p.kickoff && !(DEDICATED_PAID_PROVENANCES as readonly string[]).includes(p.provenance ?? "")));
    const band = (c: number) => (c < 65 ? "<65" : c < 70 ? "65-69" : c < 75 ? "70-74" : c < 80 ? "75-79" : "80+");
    const dist: Record<string, number> = {};
    for (const p of goalsPicks) dist[band(p.confidence)] = (dist[band(p.confidence)] ?? 0) + 1;
    const at75 = goalsPicks.filter((p) => p.confidence >= 75 && (p.outcome === "WON" || p.outcome === "LOST"));
    const w = at75.filter((p) => p.outcome === "WON").length;
    const ci = wilson95(w, at75.length);
    console.log(`    published ordinary goals picks on them: ${goalsPicks.length}; confidence ${JSON.stringify(dist)}; settled at >= 75: ${w}/${at75.length} (${pct(w, at75.length)}${ci ? `, 95% ${ci.map((v) => (100 * v).toFixed(0)).join("-")}%` : ""})`);
  }

  // ── E. Dry days ──────────────────────────────────────────────────────────
  console.log("\n== E. Days with <= 2 VIP fixtures: goals-band fixtures not favourite-targeted (corrected) ==");
  for (const day of [...new Set(rows.map((r) => r.day))].sort()) {
    const xs = rows.filter((r) => r.day === day);
    const vip = xs.filter((r) => r.vip).length;
    if (vip > 2) continue;
    const pool = xs.filter((r) => (r.corrected ?? 0) < 75 && r.goals);
    console.log(`  ${day} VIP ${vip} | goals-band, not targeted: core ${pool.filter((r) => r.group === "CORE").length}, secondary ${pool.filter((r) => r.group === "SECONDARY").length}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

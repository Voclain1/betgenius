/**
 * Chronological backtest: the current paid-feed curation rule against the
 * proposed one, replayed day by day over settled history. READ-ONLY.
 *
 * WHAT IS REPLAYED. Ordinary curation into VIP and PREMIUM — the part of the
 * paid feeds that can be re-decided from rows already in the database. Each
 * Lagos kickoff day, both rules see the same published singles:
 *
 *   CURRENT   VIP-route provenance, confidence >= the tier floor, one pick per
 *             fixture, at most CURATION_MAX, editorial rank (planCuration).
 *   PROPOSED  the same, through assessPaidCuration: a VIP-route pick the market
 *             prices more than 10pp from the model is dropped, and on a thin day
 *             (fewer than PAID_THIN_CORE_MIN core fixtures) a widened-scope pick
 *             the market confirms may stand in.
 *
 * Dedicated VIP_GENERATED / PREMIUM_GENERATED picks that were actually published
 * are carried by BOTH arms unchanged and take their fixture first, exactly as
 * curation protects them. The dedicated pass itself cannot be replayed: its
 * picks come from model calls that were never made for the alternative.
 *
 * LEAKAGE. Nothing post-match is read except the outcome being scored. The
 * market check reads the fixture's LAST pre-kickoff quote (FixtureOddsCache
 * keeps one), not the quote curation would have seen hours earlier; that is a
 * closer-to-close price than production would have had, so the PROPOSED arm's
 * filter is, if anything, slightly better informed here than it will be live.
 * Reported, not hidden. Quotes taken after kickoff are never used.
 *
 * SPLIT. The rule's constants (10pp gap, 75/80 floors, 5 books, the 87% cap)
 * are the existing gate's, not fitted to this data, so there is nothing to
 * train. The window is still split chronologically — the first two thirds
 * (in-sample: the period the 13 Nov audit that motivated the rule looked at most)
 * and the last third (out-of-sample) — and the verdict is read off the last third.
 *
 * Also reported: how the dedicated pass's attempts were spread across kickoff
 * days (the quota misallocation fixed by per-kickoff-day quotas).
 *
 * Run: npx tsx --env-file=.env scripts/backtest-paid-selection.ts [days=90]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import type { FixtureOdds } from "../src/lib/odds";
import { matchKey } from "../src/lib/slug";
import { isPaidOnlyProvenance } from "../src/lib/paidOnly";
import { compareByEditorialRank } from "../src/lib/predictionOrdering";
import { CURATION_MAX, DEDICATED_PAID_PROVENANCES, PREMIUM_CONFIDENCE_FLOOR, VIP_CONFIDENCE_FLOOR, VIP_ROUTE_PROVENANCE } from "../src/lib/geniusCuration";
import { PAID_MAX_MARKET_PROBABILITY, PREMIUM_MARKET_FLOOR, VIP_MARKET_FLOOR, paidCurationWidened, PAID_WIDENED_LEAGUE_IDS } from "../src/lib/vipPremiumOverlay";
import { assessPaidCuration, pickPrice, type PricedPick } from "../src/lib/paidSelection";

const DAY = 86_400_000;

type Row = {
  id: string; kickoff: Date; leagueApiId: number | null; confidence: number; outcome: string; provenance: string | null;
  marketType: string; categories: string[]; createdAt: Date;
  fixtureApiId: number | null; homeTeamApiId: number | null; awayTeamApiId: number | null; price: PricedPick | null;
};

const isDedicated = (r: Row) => (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "");
const key = (r: Row) => matchKey(r) ?? `row:${r.id}`;

function pick(dayRows: Row[], tier: "VIP" | "PREMIUM", proposed: boolean): { ids: Row[]; reasons: Record<string, number> } {
  const floor = tier === "PREMIUM" ? PREMIUM_CONFIDENCE_FLOOR : VIP_CONFIDENCE_FLOOR;
  const dedicated = dayRows.filter((r) => isDedicated(r) && r.categories.includes(tier));
  const taken = new Set(dedicated.map(key));
  const widened = paidCurationWidened(dayRows);
  const reasons: Record<string, number> = {};
  const open = dayRows
    .filter((r) => !isDedicated(r) && !isPaidOnlyProvenance(r.provenance) && r.confidence >= floor)
    .filter((r) => {
      if (!proposed) return r.provenance === VIP_ROUTE_PROVENANCE;
      const v = assessPaidCuration({
        confidence: r.confidence,
        vipRoute: r.provenance === VIP_ROUTE_PROVENANCE,
        widenedScope: widened && PAID_WIDENED_LEAGUE_IDS.includes(r.leagueApiId ?? -1),
        price: r.price,
        marketFloor: tier === "PREMIUM" ? PREMIUM_MARKET_FLOOR : VIP_MARKET_FLOOR,
        maxMarketProbability: PAID_MAX_MARKET_PROBABILITY,
      });
      const tag = v.eligible ? v.basis : v.reason;
      reasons[tag] = (reasons[tag] ?? 0) + 1;
      return v.eligible;
    })
    .sort(compareByEditorialRank);
  const chosen = [...dedicated];
  for (const r of open) {
    if (chosen.length >= CURATION_MAX) break;
    if (taken.has(key(r))) continue;
    taken.add(key(r));
    chosen.push(r);
  }
  return { ids: chosen, reasons };
}

function score(rows: Row[]) {
  const won = rows.filter((r) => r.outcome === "WON").length;
  const lost = rows.filter((r) => r.outcome === "LOST").length;
  const priced = rows.filter((r) => r.price && ["WON", "LOST", "VOID"].includes(r.outcome));
  const profit = priced.reduce((s, r) => s + (r.outcome === "WON" ? r.price!.median - 1 : r.outcome === "LOST" ? -1 : 0), 0);
  const dec = rows.filter((r) => r.outcome === "WON" || r.outcome === "LOST");
  const brier = dec.length ? dec.reduce((s, r) => s + (r.confidence / 100 - (r.outcome === "WON" ? 1 : 0)) ** 2, 0) / dec.length : null;
  const odds = priced.map((r) => r.price!.median).sort((a, b) => a - b);
  // Bootstrap 90% interval on ROI (resampling picks), so a difference can be read against noise.
  let lo = null as number | null, hi = null as number | null;
  if (priced.length >= 20) {
    const pnl = priced.map((r) => (r.outcome === "WON" ? r.price!.median - 1 : r.outcome === "LOST" ? -1 : 0));
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const sims: number[] = [];
    for (let b = 0; b < 2000; b++) {
      let s = 0;
      for (let i = 0; i < pnl.length; i++) s += pnl[Math.floor(rnd() * pnl.length)];
      sims.push(s / pnl.length);
    }
    sims.sort((a, b) => a - b);
    lo = sims[100]; hi = sims[1899];
  }
  return {
    n: rows.length, won, lost, strike: won + lost ? won / (won + lost) : null, staked: priced.length,
    roi: priced.length ? profit / priced.length : null, lo, hi, profit, brier,
    medianOdds: odds.length ? odds[Math.floor(odds.length / 2)] : null,
  };
}

const fmt = (s: ReturnType<typeof score>) =>
  `n=${String(s.n).padStart(4)} W/L ${s.won}/${s.lost} strike ${s.strike == null ? "—" : (100 * s.strike).toFixed(1) + "%"}  priced ${s.staked} ` +
  `ROI ${s.roi == null ? "—" : (100 * s.roi).toFixed(1) + "%"}${s.lo != null ? ` [90% ${(100 * s.lo).toFixed(1)}, ${(100 * s.hi!).toFixed(1)}]` : ""} ` +
  `P/L ${s.profit.toFixed(2)}  medOdds ${s.medianOdds?.toFixed(2) ?? "—"}  brier ${s.brier?.toFixed(3) ?? "—"}`;

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error(`refusing: session is not read-only (transaction_read_only = ${ro?.transaction_read_only})`);
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.max(14, Number(process.argv[2]) || 90);
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);
  const settledBefore = new Date(now.getTime() - 3 * 3_600_000);

  const raw = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: since, lt: settledBefore }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: {
      id: true, kickoff: true, leagueApiId: true, confidence: true, outcome: true, provenance: true, marketType: true, selection: true,
      createdAt: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, categories: { select: { category: true } },
    },
  });
  const visible = raw.filter((r) => r.kickoff && !r.categories.some((c) => c.category === "SAME_GAME_DOUBLE"));
  const keys = [...new Set(visible.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const quotes = new Map<string, { oddsJson: FixtureOdds | null; fetchedAt: Date | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) {
      quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
    }
  }
  const rows: Row[] = visible.map((r) => {
    const q = quotes.get(matchKey(r) ?? "");
    const pre = !!q?.fetchedAt && q.fetchedAt.getTime() < r.kickoff!.getTime();
    return { ...r, kickoff: r.kickoff!, categories: r.categories.map((c) => c.category), price: pre ? pickPrice(q!.oddsJson, r.marketType, r.selection) : null };
  });

  const byDay = new Map<string, Row[]>();
  for (const r of rows) (byDay.get(lagosDateKey(r.kickoff)) ?? byDay.set(lagosDateKey(r.kickoff), []).get(lagosDateKey(r.kickoff))!).push(r);
  const dayKeys = [...byDay.keys()].sort();
  const cut = dayKeys[Math.floor((dayKeys.length * 2) / 3)];
  console.log(`\nDays ${dayKeys[0]} .. ${dayKeys[dayKeys.length - 1]} (${dayKeys.length}). In-sample < ${cut} <= out-of-sample.`);

  for (const tier of ["VIP", "PREMIUM"] as const) {
    const arms = { actual: [] as Row[], current: [] as Row[], proposed: [] as Row[] };
    const perDay: Array<{ day: string; singles: number; actual: number; current: number; proposed: number; widened: boolean }> = [];
    const reasons: Record<string, number> = {};
    const split = { in: { current: [] as Row[], proposed: [] as Row[], dropped: [] as Row[], added: [] as Row[] }, out: { current: [] as Row[], proposed: [] as Row[], dropped: [] as Row[], added: [] as Row[] } };
    for (const day of dayKeys) {
      const dr = byDay.get(day)!;
      const actual = dr.filter((r) => r.categories.includes(tier));
      const cur = pick(dr, tier, false).ids;
      const p = pick(dr, tier, true);
      for (const [k, v] of Object.entries(p.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
      arms.actual.push(...actual); arms.current.push(...cur); arms.proposed.push(...p.ids);
      const bucket = day < cut ? split.in : split.out;
      bucket.current.push(...cur); bucket.proposed.push(...p.ids);
      const curIds = new Set(cur.map((r) => r.id)), propIds = new Set(p.ids.map((r) => r.id));
      bucket.dropped.push(...cur.filter((r) => !propIds.has(r.id)));
      bucket.added.push(...p.ids.filter((r) => !curIds.has(r.id)));
      perDay.push({ day, singles: dr.length, actual: actual.length, current: cur.length, proposed: p.ids.length, widened: paidCurationWidened(dr) });
    }
    console.log(`\n══ ${tier} ══`);
    console.log(`  Actual feed (what readers saw):   ${fmt(score(arms.actual))}`);
    console.log(`  Current rule, replayed:           ${fmt(score(arms.current))}`);
    console.log(`  Proposed rule, replayed:          ${fmt(score(arms.proposed))}`);
    console.log(`  Proposed-rule verdicts on candidates at the floor: ${JSON.stringify(reasons)}`);
    for (const [label, b] of [["IN-SAMPLE", split.in], ["OUT-OF-SAMPLE", split.out]] as const) {
      console.log(`  ${label}`);
      console.log(`    current   ${fmt(score(b.current))}`);
      console.log(`    proposed  ${fmt(score(b.proposed))}`);
      console.log(`    dropped by the market check  ${fmt(score(b.dropped))}`);
      console.log(`    added on thin days           ${fmt(score(b.added))}`);
    }
    const active = perDay.filter((d) => d.singles >= 20);
    const dry = (k: "actual" | "current" | "proposed", n: number) => active.filter((d) => d[k] < n).length;
    console.log(`  Active days (>=20 published singles): ${active.length}. Days under 2 picks — actual ${dry("actual", 2)}, current ${dry("current", 2)}, proposed ${dry("proposed", 2)}; under 4 — actual ${dry("actual", 4)}, current ${dry("current", 4)}, proposed ${dry("proposed", 4)}`);
    const avg = (k: "actual" | "current" | "proposed") => (perDay.reduce((s, d) => s + d[k], 0) / perDay.length).toFixed(2);
    console.log(`  Mean picks/day — actual ${avg("actual")}, current ${avg("current")}, proposed ${avg("proposed")}`);
    console.log("  Last 21 days: day singles actual/current/proposed (W = widened)");
    for (const d of perDay.slice(-21)) console.log(`    ${d.day} ${String(d.singles).padStart(4)}  ${d.actual}/${d.current}/${d.proposed}${d.widened ? " W" : ""}`);
  }

  // ── Dedicated pass: which kickoff day each day's attempts went to ─────────
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - 30 * DAY) }, prompt: { contains: '"intent":"VIP_PREMIUM"' } },
    select: { createdAt: true, prompt: true },
  });
  const alloc = new Map<string, Record<string, number>>();
  for (const j of jobs) {
    let ko: string | null = null;
    try { ko = JSON.parse(j.prompt)?.kickoff ?? null; } catch { /* unreadable prompt */ }
    if (!ko) continue;
    const created = lagosDateKey(j.createdAt);
    const offset = Math.round((new Date(`${lagosDateKey(new Date(ko))}T12:00:00Z`).getTime() - new Date(`${created}T12:00:00Z`).getTime()) / DAY);
    const m = alloc.get(created) ?? alloc.set(created, {}).get(created)!;
    m[`+${offset}`] = (m[`+${offset}`] ?? 0) + 1;
  }
  let same = 0, later = 0;
  console.log("\nDedicated attempts per Lagos creation day, by kickoff-day offset (+0 same day, +1 next day, +2 ...), last 30 days:");
  for (const [d, m] of [...alloc.entries()].sort()) {
    same += m["+0"] ?? 0;
    later += Object.entries(m).filter(([k]) => k !== "+0").reduce((s, [, v]) => s + v, 0);
    console.log(`  ${d} ${JSON.stringify(m)}`);
  }
  console.log(`  Total: ${same} on same-day fixtures, ${later} on later days' fixtures.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

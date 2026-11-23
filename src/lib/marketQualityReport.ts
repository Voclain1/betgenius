/**
 * Market-quality monitoring (prediction quality remediation, Nov 2026).
 *
 * Low-overhead, read-only: database queries over published rows and the
 * cached odds, no provider or model calls. Powers /admin/market-quality.
 * Alerts are operational controls for administrators, never public claims.
 *
 * Alert thresholds are anchored to the measured 30-day production baseline to
 * 23 Nov 2026 (docs/PREDICTION_MARKET_QUALITY_2026-11-23.md), each set a few
 * standard errors beyond it for a typical week (~700 published singles), so a
 * normal week does not alert and a real deterioration does.
 */
import { prisma } from "@/lib/prisma";
import { matchKey } from "@/lib/slug";
import { type FixtureOdds } from "@/lib/odds";
import { evaluateCandidate, SELECTION_POLICY } from "@/lib/marketSelection";
import { VIP_CONFIDENCE_FLOOR, PREMIUM_CONFIDENCE_FLOOR } from "@/lib/geniusCuration";

const D = 86_400_000;

/** Measured baseline (30 days to 23 Nov 2026) and the alert line for each monitored rate. */
export const MARKET_QUALITY_BASELINE = {
  /** Published singles with a verified price (median quoted by 3+ books): 81.3%. */
  verifiedPricePct: { baseline: 81.3, alertBelow: 75 },
  /** Published singles with no executable price (Draw No Bet, Team Total, Win Either Half): 8.8%. */
  unpricedPct: { baseline: 8.8, alertAbove: 15 },
  /** FEATURED fixtures with more than one published single: 21.6% (fixed by one-row-per-fixture). */
  duplicateFixturePct: { baseline: 21.6, alertAbove: 5 },
  /** Double Chance share of published FEATURED singles: 57.2%. A concentration monitor, not a quota. */
  doubleChanceFeaturedPct: { baseline: 57.2, alertAbove: 65 },
  /** Automatic (non-admin-requested) published singles priced below the 1.12 floor. Should be zero. */
  belowFloorAutomatic: { baseline: null, alertAbove: 0 },
  /** |strike - mean stated confidence| per market, pp, with n >= 100 settled (worst at baseline: BTTS 7.3). */
  calibrationGapPP: { baseline: 7.3, alertAbove: 10 },
  /** Market-selection HOLD share of recorded generations. */
  holdPct: { baseline: null, alertAbove: 30 },
  /** API-Football requests per UTC day (non-paid ceiling 7,100). */
  apiPerDay: { baseline: 6_800, alertAbove: 7_150 },
} as const;

export type MarketQualityAlert = { key: string; level: "warn" | "info"; message: string };

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function intentOf(prompt: string | null | undefined): string {
  try { const p = JSON.parse(prompt ?? "{}"); return typeof p.intent === "string" ? p.intent : p.manual ? "ADMIN" : "ORDINARY"; } catch { return "UNKNOWN"; }
}

export async function loadMarketQualityReport(opts: { days?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const days = Math.max(1, Math.min(60, Math.trunc(opts.days ?? 7)));
  const from = new Date(now.getTime() - days * D);
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: new Date(now.getTime() - 30 * D) }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: { id: true, marketType: true, selection: true, confidence: true, outcome: true, kickoff: true, provenance: true, analysisJson: true,
      homeTeamApiId: true, awayTeamApiId: true, categories: { select: { category: true } }, aiJob: { select: { prompt: true } } },
  });
  const keys = [...new Set(rows.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const odds = new Map<string, FixtureOdds | null>();
  for (let i = 0; i < keys.length; i += 500)
    for (const c of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true } }))
      odds.set(c.matchKey, (c.oddsJson as FixtureOdds | null) ?? null);
  const enriched = rows.map((r) => {
    // Judged as of kickoff (or now, if earlier): a quote that was current before the match is not "stale" afterwards.
    const at = r.kickoff && r.kickoff < now ? r.kickoff : now;
    const ev = evaluateCandidate({ marketType: r.marketType, selection: r.selection, confidence: r.confidence, source: "primary" }, odds.get(matchKey(r) ?? "") ?? null, SELECTION_POLICY, at);
    const sq = (r.analysisJson as { selectionQuality?: { decision?: string; holdReason?: string | null; tier?: string } } | null)?.selectionQuality ?? null;
    return { ...r, ev, intent: intentOf(r.aiJob?.prompt), sq, cats: r.categories.map((c) => c.category) };
  });
  const recent = enriched.filter((r) => r.kickoff && r.kickoff >= from);

  const mix = (xs: typeof recent) => xs.reduce<Record<string, number>>((o, r) => { o[r.marketType] = (o[r.marketType] ?? 0) + 1; return o; }, {});
  const byCategory: Record<string, Record<string, number>> = {};
  for (const c of ["FEATURED", "GENIUS", "BANKER", "VIP", "PREMIUM", "GOALS"]) byCategory[c] = mix(recent.filter((r) => r.cats.includes(c)));
  const byRoute: Record<string, Record<string, number>> = {};
  for (const r of recent) { const k = r.provenance === "STANDARD_CURATED" ? (r.intent === "EARLY_FREE" ? "EARLY" : r.intent === "ADMIN" ? "ADMIN" : "ORDINARY") : r.provenance; (byRoute[k] ??= {})[r.marketType] = (byRoute[k][r.marketType] ?? 0) + 1; }

  const verified = recent.filter((r) => r.ev.median != null && (r.ev.books ?? 0) >= SELECTION_POLICY.MIN_BOOKS);
  const unpriced = recent.filter((r) => r.ev.median == null);
  const belowFloorAuto = recent.filter((r) => r.ev.median != null && r.ev.median < SELECTION_POLICY.HARD_MIN_ODDS && r.intent !== "ADMIN");
  const featured = recent.filter((r) => r.cats.includes("FEATURED"));
  const perFixture = new Map<string, number>(); for (const r of featured) { const k = matchKey(r); if (k) perFixture.set(k, (perFixture.get(k) ?? 0) + 1); }
  const dupFixtures = [...perFixture.values()].filter((n) => n > 1).length;
  const tiers = recent.reduce<Record<string, number>>((o, r) => { o[r.ev.tier] = (o[r.ev.tier] ?? 0) + 1; return o; }, {});

  const recorded = recent.filter((r) => r.sq);
  const decisions = recorded.reduce<Record<string, number>>((o, r) => { const k = r.sq!.decision ?? "?"; o[k] = (o[k] ?? 0) + 1; return o; }, {});
  const holdReasons = recorded.filter((r) => r.sq!.decision === "HOLD").reduce<Record<string, number>>((o, r) => { const k = r.sq!.holdReason ?? "?"; o[k] = (o[k] ?? 0) + 1; return o; }, {});

  // Calibration over the full 30 days (needs settled volume).
  const settled = enriched.filter((r) => r.outcome === "WON" || r.outcome === "LOST");
  const calibration = Object.fromEntries([...new Set(settled.map((r) => r.marketType))].map((m) => {
    const s = settled.filter((r) => r.marketType === m);
    const strike = (100 * s.filter((r) => r.outcome === "WON").length) / s.length;
    const meanConf = s.reduce((a, r) => a + r.confidence, 0) / s.length;
    return [m, { n: s.length, strike: Math.round(strike * 10) / 10, meanConfidence: Math.round(meanConf * 10) / 10, gapPP: Math.round((strike - meanConf) * 10) / 10 }];
  }));

  const usageRows = await prisma.apiUsage.findMany({ where: { day: { gte: new Date(now.getTime() - days * D).toISOString().slice(0, 10), lt: "a" } }, select: { day: true, count: true } });
  const apiPerDay: Record<string, number> = {};
  for (const u of usageRows) if (/^\d{4}-\d{2}-\d{2}$/.test(u.day)) apiPerDay[u.day] = (apiPerDay[u.day] ?? 0) + u.count;

  const paidNow = recent.filter((r) => r.cats.includes("VIP") || r.cats.includes("PREMIUM")).length;
  const paid30 = enriched.filter((r) => r.cats.includes("VIP") || r.cats.includes("PREMIUM")).length;
  const paidExpected = (paid30 * days) / 30;

  const B = MARKET_QUALITY_BASELINE;
  const metrics = {
    days, publishedSingles: recent.length,
    verifiedPricePct: pct(verified.length, recent.length), unpricedPct: pct(unpriced.length, recent.length),
    medianPrice: median(verified.map((r) => r.ev.median!)), shortPricePct: pct(recent.filter((r) => r.ev.tier === "SHORT").length, recent.length),
    belowFloorAutomatic: belowFloorAuto.length, tiers,
    duplicateFixturePct: pct(dupFixtures, perFixture.size),
    doubleChanceFeaturedPct: pct(featured.filter((r) => r.marketType === "DOUBLE_CHANCE").length, featured.length),
    marketsByCategory: byCategory, marketsByRoute: byRoute,
    selection: { recordedRows: recorded.length, decisions, holdReasons, holdPct: pct(decisions.HOLD ?? 0, recorded.length) },
    calibration30d: calibration, apiPerDay,
    paid: { vipPremiumPublished: paidNow, expectedFrom30d: Math.round(paidExpected * 10) / 10, floors: { VIP: VIP_CONFIDENCE_FLOOR, PREMIUM: PREMIUM_CONFIDENCE_FLOOR } },
  };

  const alerts: MarketQualityAlert[] = [];
  const minN = 50; // below this a week is too thin to alert on rates
  if (recent.length >= minN && metrics.verifiedPricePct != null && metrics.verifiedPricePct < B.verifiedPricePct.alertBelow)
    alerts.push({ key: "verified-price", level: "warn", message: `Only ${metrics.verifiedPricePct}% of published picks have a verified price (baseline ${B.verifiedPricePct.baseline}%).` });
  if (recent.length >= minN && metrics.unpricedPct != null && metrics.unpricedPct > B.unpricedPct.alertAbove)
    alerts.push({ key: "unpriced", level: "warn", message: `${metrics.unpricedPct}% of published picks have no executable price (baseline ${B.unpricedPct.baseline}%).` });
  if (metrics.belowFloorAutomatic > B.belowFloorAutomatic.alertAbove)
    alerts.push({ key: "below-floor", level: "warn", message: `${metrics.belowFloorAutomatic} automatically generated published pick(s) priced below ${SELECTION_POLICY.HARD_MIN_ODDS.toFixed(2)}.` });
  if (perFixture.size >= minN && metrics.duplicateFixturePct != null && metrics.duplicateFixturePct > B.duplicateFixturePct.alertAbove)
    alerts.push({ key: "duplicates", level: "warn", message: `${metrics.duplicateFixturePct}% of FEATURED fixtures carry more than one published pick.` });
  if (featured.length >= minN && metrics.doubleChanceFeaturedPct != null && metrics.doubleChanceFeaturedPct > B.doubleChanceFeaturedPct.alertAbove)
    alerts.push({ key: "dc-concentration", level: "info", message: `Double Chance is ${metrics.doubleChanceFeaturedPct}% of FEATURED (baseline ${B.doubleChanceFeaturedPct.baseline}%). Check the generation route mix before acting.` });
  for (const [m, c] of Object.entries(calibration) as Array<[string, { n: number; gapPP: number }]>)
    if (c.n >= 100 && Math.abs(c.gapPP) > B.calibrationGapPP.alertAbove)
      alerts.push({ key: `calibration-${m}`, level: "warn", message: `${m}: settled strike differs from stated confidence by ${c.gapPP}pp (n=${c.n}).` });
  if (recorded.length >= 20 && metrics.selection.holdPct != null && metrics.selection.holdPct > B.holdPct.alertAbove)
    alerts.push({ key: "holds", level: "warn", message: `${metrics.selection.holdPct}% of recorded selections were held for review.` });
  for (const [day, n] of Object.entries(apiPerDay)) if (n > B.apiPerDay.alertAbove)
    alerts.push({ key: `api-${day}`, level: "info", message: `API-Football ${n} requests on ${day} (ceiling for non-paid work is 7,100).` });
  if (paid30 >= 20 && paidNow < paidExpected * 0.6)
    alerts.push({ key: "paid-availability", level: "warn", message: `VIP/Premium published ${paidNow} in ${days}d, below 60% of the 30-day rate (${metrics.paid.expectedFrom30d}).` });
  return { generatedAt: now.toISOString(), metrics, alerts, baseline: B };
}
export type MarketQualityReport = Awaited<ReturnType<typeof loadMarketQualityReport>>;

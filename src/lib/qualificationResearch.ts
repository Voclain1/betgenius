/**
 * VIP/Premium Sprint 08: can VIP / PREMIUM qualification be loosened without
 * making the paid feeds worse? Pure; scripts/research-qualification-loosening.ts
 * supplies the rows. RESEARCH ONLY: no production code path imports this file
 * (a check pins that), so nothing here can change what is published.
 *
 * PRE-REGISTRATION. The candidate policies, the split fractions and the
 * promotion rule below were committed before the first production run, the
 * same discipline Sprint 05 used (paidPolicyResearch.ts). They are not tuned
 * on results. A candidate that fails is reported as failing.
 *
 * WHAT IS DIFFERENT FROM SPRINT 05. Sprint 05 tested SUBSETS of the existing
 * selection (filters that can only remove picks). This sprint tests
 * SUPERSETS: each candidate keeps every existing paid pick and ADDS picks the
 * current rules turned away. So the question is whether the ADDED picks are
 * as good as the ones already sold, and whether they add supply at all.
 *
 * Universe (built by the script, read-only):
 *   PUBLISHED            settled published singles, any feed
 *   DEDICATED_REJECTED   dedicated VIP/PREMIUM-pass drafts the gate archived,
 *                        resolved from a settled sibling row's final score on
 *                        the same fixture (never published, never re-published)
 *
 * Discipline:
 *   - Fixture-level deduplication: one pick per fixture per policy (highest
 *     confidence, then market probability, then id). A fixture that already
 *     carries a paid pick can never get a second one from a candidate.
 *   - Three chronological periods (dev-train / dev-validate / final holdout),
 *     kickoff-grouped so a kickoff never straddles a boundary.
 *   - Promotion is decided on dev-validate with dev-train as a sign check.
 *     Only promoted candidates are scored on the holdout, once.
 *   - Returns are at the last PRE-KICKOFF quote (closing reference) unless an
 *     entry price was recorded at publication. Never called realized returns.
 */
import { wilson95 } from "@/lib/paidMarketQuality";

export type ResearchSource = "PUBLISHED" | "DEDICATED_REJECTED";

export type ResearchRow = {
  id: string;
  fixtureKey: string;
  leagueApiId: number | null;
  marketType: string;
  kickoff: Date;
  /** Lagos kickoff day. */
  day: string;
  confidence: number;
  /** Median decimal price; null when no usable pre-kickoff quote for the exact selection. */
  odds: number | null;
  /** De-vigged market probability 0-100. */
  marketProbability: number | null;
  bookmakers: number | null;
  outcome: "WON" | "LOST" | "VOID";
  source: ResearchSource;
  /** Paid categories the row actually carried (published rows only). */
  paidTiers: Array<"VIP" | "PREMIUM">;
  /** Ordinary pick generated on the VIP calibration route (core competitions). */
  vipRoute: boolean;
  /** League is in PAID_ANY_LEAGUE_IDS (core or widened paid scope). */
  inPaidScope: boolean;
  /** Model family that produced the row ("claude", "gemini", ...), null when unknown. */
  provider: string | null;
  priceSource: "entry" | "closing" | "missing";
};

/** Fair-odds floor of the paid tiers: 1.15, i.e. market <= 86.96%. Restated from vipPremiumOverlay (PAID_MAX_MARKET_PROBABILITY); a check pins them equal. */
export const RESEARCH_MAX_MARKET = 100 / 1.15;
export const RESEARCH_MIN_BOOKS = 5;

/** The dedicated gate's market confirmation, read from the row's quote. */
export function marketConfirmed(r: ResearchRow, opts: { minMarket: number; maxGapPP: number }): boolean {
  if (r.marketProbability == null || r.odds == null || (r.bookmakers ?? 0) < RESEARCH_MIN_BOOKS) return false;
  if (r.marketProbability < opts.minMarket || r.marketProbability > RESEARCH_MAX_MARKET) return false;
  return Math.abs(r.confidence - r.marketProbability) <= opts.maxGapPP;
}

export type Tier = "VIP" | "PREMIUM";

export type CandidateName =
  | "V1_CONF73_MARKET_CONFIRMED"
  | "V2_CONF70_MARKET_CONFIRMED"
  | "V3_CONF70_MARKET80"
  | "V4_SCOPE_MARKET_CONFIRMED"
  | "V5_SCOPE_GAP15"
  | "P1_CONF78_MARKET80"
  | "P2_VIP_MARKET83"
  | "P3_SCOPE_CONF80_MARKET80";

export type Candidate = {
  name: CandidateName;
  tier: Tier;
  /** Lowers a published confidence floor ("every VIP pick clears 75%", "each Premium tip rated 80%"). */
  changesPublishedFloor: boolean;
  rationale: string;
  /** May this non-baseline row be ADDED? `vipBaseline` = fixture keys already in the VIP baseline. */
  admits: (r: ResearchRow, ctx: { vipBaseline: ReadonlySet<string> }) => boolean;
};

const notAlreadyPaid = (r: ResearchRow) => r.paidTiers.length === 0;

/** Pre-registered. Do not edit after the first production run without recording why in the evidence doc. */
export const CANDIDATES: readonly Candidate[] = [
  {
    name: "V1_CONF73_MARKET_CONFIRMED", tier: "VIP", changesPublishedFloor: true,
    rationale: "Modest model-floor cut: 73-74 confidence admitted when the market confirms it on the dedicated gate's own terms (>=5 books, market 75-87%, gap <=10pp), paid-scope leagues only.",
    admits: (r) => notAlreadyPaid(r) && r.inPaidScope && r.confidence >= 73 && r.confidence < 75 && marketConfirmed(r, { minMarket: 75, maxGapPP: 10 }),
  },
  {
    name: "V2_CONF70_MARKET_CONFIRMED", tier: "VIP", changesPublishedFloor: true,
    rationale: "Larger model-floor cut: 70-74 with the same market confirmation.",
    admits: (r) => notAlreadyPaid(r) && r.inPaidScope && r.confidence >= 70 && r.confidence < 75 && marketConfirmed(r, { minMarket: 75, maxGapPP: 10 }),
  },
  {
    name: "V3_CONF70_MARKET80", tier: "VIP", changesPublishedFloor: true,
    rationale: "Trade model floor for market strength: 70-74 only when the market is at 80-87% (PREMIUM's market bar), gap <=10pp.",
    admits: (r) => notAlreadyPaid(r) && r.inPaidScope && r.confidence >= 70 && r.confidence < 75 && marketConfirmed(r, { minMarket: 80, maxGapPP: 10 }),
  },
  {
    name: "V4_SCOPE_MARKET_CONFIRMED", tier: "VIP", changesPublishedFloor: false,
    rationale: "No floor change. Better use of existing market evidence: a paid-scope pick at >=75 that the market confirms is admitted on any day, not only thin days and not only on the VIP calibration route.",
    admits: (r) => notAlreadyPaid(r) && r.inPaidScope && r.confidence >= 75 && marketConfirmed(r, { minMarket: 75, maxGapPP: 10 }),
  },
  {
    name: "V5_SCOPE_GAP15", tier: "VIP", changesPublishedFloor: false,
    rationale: "V4 with a looser model-market agreement requirement (gap <=15pp instead of 10pp).",
    admits: (r) => notAlreadyPaid(r) && r.inPaidScope && r.confidence >= 75 && marketConfirmed(r, { minMarket: 75, maxGapPP: 15 }),
  },
  {
    name: "P1_CONF78_MARKET80", tier: "PREMIUM", changesPublishedFloor: true,
    rationale: "PREMIUM model-floor cut to 78 for VIP picks the market prices at 80-87% (gap <=10pp).",
    admits: (r, { vipBaseline }) => vipBaseline.has(r.fixtureKey) && !r.paidTiers.includes("PREMIUM") && r.confidence >= 78 && r.confidence < 80 && marketConfirmed(r, { minMarket: 80, maxGapPP: 10 }),
  },
  {
    name: "P2_VIP_MARKET83", tier: "PREMIUM", changesPublishedFloor: true,
    rationale: "Market-led PREMIUM: any VIP pick (>=75) the market prices at 83-87% (gap <=10pp), whatever its confidence above the VIP floor.",
    admits: (r, { vipBaseline }) => vipBaseline.has(r.fixtureKey) && !r.paidTiers.includes("PREMIUM") && r.confidence >= 75 && marketConfirmed(r, { minMarket: 83, maxGapPP: 10 }),
  },
  {
    name: "P3_SCOPE_CONF80_MARKET80", tier: "PREMIUM", changesPublishedFloor: false,
    rationale: "No floor change: a paid-scope pick at >=80 the market prices at 80-87% is admitted on any day (scope, not floor).",
    admits: (r) => notAlreadyPaid(r) && r.inPaidScope && r.confidence >= 80 && marketConfirmed(r, { minMarket: 80, maxGapPP: 10 }),
  },
];

/** Higher confidence first, then stronger market, then id: the order curation itself ranks by. */
export function comparePick(a: ResearchRow, b: ResearchRow): number {
  return b.confidence - a.confidence || (b.marketProbability ?? -1) - (a.marketProbability ?? -1) || a.id.localeCompare(b.id);
}

/** One row per fixture, the best by comparePick. */
export function onePerFixture(rows: readonly ResearchRow[]): ResearchRow[] {
  const best = new Map<string, ResearchRow>();
  for (const r of rows) {
    const cur = best.get(r.fixtureKey);
    if (!cur || comparePick(r, cur) < 0) best.set(r.fixtureKey, r);
  }
  return [...best.values()].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.id.localeCompare(b.id));
}

/** The existing selection for a tier, fixture-deduplicated. */
export function baseline(rows: readonly ResearchRow[], tier: Tier): ResearchRow[] {
  return onePerFixture(rows.filter((r) => r.source === "PUBLISHED" && r.paidTiers.includes(tier)));
}

/** Rows a candidate adds: on fixtures with no baseline pick for its tier, one per fixture. */
export function additions(rows: readonly ResearchRow[], c: Candidate): ResearchRow[] {
  const base = new Set(baseline(rows, c.tier).map((r) => r.fixtureKey));
  const vipBaseline = new Set(baseline(rows, "VIP").map((r) => r.fixtureKey));
  // A PREMIUM candidate upgrades a VIP fixture, so its own fixture may be in the VIP baseline.
  return onePerFixture(rows.filter((r) => !base.has(r.fixtureKey) && c.admits(r, { vipBaseline })));
}

export function policySelection(rows: readonly ResearchRow[], c: Candidate): ResearchRow[] {
  return onePerFixture([...baseline(rows, c.tier), ...additions(rows, c)]);
}

// ── Statistics ───────────────────────────────────────────────────────────────

export type Stats = {
  n: number; wins: number; losses: number; voids: number;
  winRate: number | null; wilson95: [number, number] | null;
  priced: number; roiPct: number | null; roi90: [number, number] | null; meanOdds: number | null;
  brierModel: number | null; brierMarket: number | null; brierN: number;
  activeDays: number; perDay: number | null; zeroDays: number;
  oddsBands: Record<string, number>; marketBands: Record<string, number>;
  topLeagues: Array<[string, number]>;
  /** ROI if every unpriced decided pick had lost. */
  roiUnpricedAsLossPct: number | null;
};

const oddsBand = (o: number | null) => (o == null ? "unpriced" : o < 1.15 ? "<1.15" : o < 1.3 ? "1.15-1.29" : o < 1.5 ? "1.30-1.49" : o < 1.7 ? "1.50-1.69" : ">=1.70");
const marketBand = (m: number | null) => (m == null ? "unpriced" : m < 70 ? "<70" : m < 75 ? "70-74" : m < 80 ? "75-79" : m < 87 ? "80-86" : ">=87");

/** Deterministic PRNG so the bootstrap interval is reproducible run to run. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 90% percentile bootstrap of flat-stake ROI over priced picks. Null below 30 priced picks. */
export function roiInterval(returns: readonly number[], iterations = 2000, seed = 8): [number, number] | null {
  if (returns.length < 30) return null;
  const rnd = mulberry32(seed);
  const sims: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < returns.length; j++) s += returns[Math.floor(rnd() * returns.length)];
    sims.push((100 * s) / returns.length);
  }
  sims.sort((a, b) => a - b);
  return [sims[Math.floor(0.05 * iterations)], sims[Math.floor(0.95 * iterations)]];
}

/**
 * `days` is every Lagos day of the period on which the universe had at least
 * one settled row (an "active day"), so zero-pick days are counted against
 * days the product was actually running, not calendar days.
 */
export function stats(rows: readonly ResearchRow[], days: readonly string[], leagueName: (id: number | null) => string = (id) => String(id)): Stats {
  const decided = rows.filter((r) => r.outcome !== "VOID");
  const wins = decided.filter((r) => r.outcome === "WON").length;
  const priced = rows.filter((r) => r.odds != null && r.odds > 1);
  const returns = priced.map((r) => (r.outcome === "WON" ? r.odds! - 1 : r.outcome === "LOST" ? -1 : 0));
  const ret = returns.reduce((a, b) => a + b, 0);
  const both = decided.filter((r) => r.marketProbability != null);
  const brier = (p: (r: ResearchRow) => number) => (both.length ? both.reduce((a, r) => a + (p(r) - (r.outcome === "WON" ? 1 : 0)) ** 2, 0) / both.length : null);
  const perDayCount = new Map<string, number>();
  for (const r of rows) perDayCount.set(r.day, (perDayCount.get(r.day) ?? 0) + 1);
  const tally = (f: (r: ResearchRow) => string) => rows.reduce<Record<string, number>>((acc, r) => { acc[f(r)] = (acc[f(r)] ?? 0) + 1; return acc; }, {});
  const leagues = Object.entries(tally((r) => leagueName(r.leagueApiId))).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const unpricedLosses = decided.filter((r) => !(r.odds != null && r.odds > 1)).length;
  return {
    n: rows.length, wins, losses: decided.length - wins, voids: rows.length - decided.length,
    winRate: decided.length ? wins / decided.length : null,
    wilson95: wilson95(wins, decided.length),
    priced: priced.length,
    roiPct: priced.length >= 30 ? (100 * ret) / priced.length : null,
    roi90: roiInterval(returns),
    meanOdds: priced.length ? priced.reduce((s, r) => s + r.odds!, 0) / priced.length : null,
    brierModel: brier((r) => r.confidence / 100), brierMarket: brier((r) => r.marketProbability! / 100), brierN: both.length,
    activeDays: days.length,
    perDay: days.length ? rows.length / days.length : null,
    zeroDays: days.filter((d) => !perDayCount.has(d)).length,
    oddsBands: tally((r) => oddsBand(r.odds)),
    marketBands: tally((r) => marketBand(r.marketProbability)),
    topLeagues: leagues,
    roiUnpricedAsLossPct: rows.length ? (100 * (ret - unpricedLosses)) / Math.max(1, priced.length + unpricedLosses) : null,
  };
}

// ── Promotion rule (pre-registered) ─────────────────────────────────────────

export const LOOSENING_PROMOTION = {
  /** Added picks needed on dev-validate (and on dev-train for the sign check). */
  MIN_ADDED_N: 30,
  /** Added picks may strike at most this far below the baseline (fraction). */
  MAX_WIN_RATE_SHORTFALL: 0.03,
  /** Added picks' closing-reference ROI may be at most this far below the baseline's (pp). */
  MAX_ROI_SHORTFALL_PP: 1.0,
  /** On the additions, the model's Brier may exceed the market's by at most this. */
  MAX_BRIER_EXCESS: 0.02,
  /** The combined selection must add at least this many unique picks per active day. */
  MIN_SUPPLY_GAIN_PER_DAY: 0.25,
  HOLDOUT_MIN_ADDED_N: 30,
} as const;

export type Gate = { pass: boolean; reasons: string[] };

/** The same comparison on any one period. */
export function judgeAdditions(base: Stats, added: Stats, combined: Stats, minN: number): Gate {
  const P = LOOSENING_PROMOTION;
  const reasons: string[] = [];
  if (added.n < minN) reasons.push(`added n ${added.n} < ${minN}`);
  if (added.winRate == null || base.winRate == null || added.winRate < base.winRate - P.MAX_WIN_RATE_SHORTFALL) {
    reasons.push(`added strike ${pctOrDash(added.winRate)} more than ${100 * P.MAX_WIN_RATE_SHORTFALL}pp below baseline ${pctOrDash(base.winRate)}`);
  }
  if (added.roiPct == null || base.roiPct == null || added.roiPct < base.roiPct - P.MAX_ROI_SHORTFALL_PP) {
    reasons.push(`added closing-ref ROI ${added.roiPct == null ? "n/a (<30 priced)" : `${added.roiPct.toFixed(1)}%`} vs baseline ${base.roiPct == null ? "n/a" : `${base.roiPct.toFixed(1)}%`} (max shortfall ${P.MAX_ROI_SHORTFALL_PP}pp)`);
  }
  if (added.brierModel == null || added.brierMarket == null || added.brierModel > added.brierMarket + P.MAX_BRIER_EXCESS) {
    reasons.push(`added Brier model ${added.brierModel?.toFixed(3) ?? "n/a"} vs market ${added.brierMarket?.toFixed(3) ?? "n/a"} (max excess ${P.MAX_BRIER_EXCESS})`);
  }
  if (combined.perDay == null || base.perDay == null || combined.perDay - base.perDay < P.MIN_SUPPLY_GAIN_PER_DAY) {
    reasons.push(`supply gain ${combined.perDay == null || base.perDay == null ? "n/a" : (combined.perDay - base.perDay).toFixed(2)} picks/day < ${P.MIN_SUPPLY_GAIN_PER_DAY}`);
  }
  return { pass: reasons.length === 0, reasons };
}

export function promotionDecision(devTrain: { base: Stats; added: Stats; combined: Stats }, devValidate: { base: Stats; added: Stats; combined: Stats }): Gate {
  const v = judgeAdditions(devValidate.base, devValidate.added, devValidate.combined, LOOSENING_PROMOTION.MIN_ADDED_N);
  const t = judgeAdditions(devTrain.base, devTrain.added, devTrain.combined, LOOSENING_PROMOTION.MIN_ADDED_N);
  const reasons = [...v.reasons.map((r) => `dev-validate: ${r}`), ...t.reasons.map((r) => `dev-train sign check: ${r}`)];
  return { pass: reasons.length === 0, reasons: reasons.length ? reasons : ["all promotion criteria met on development data"] };
}

/** Called only for promoted candidates. One evaluation on the untouched holdout. */
export function holdoutDecision(h: { base: Stats; added: Stats; combined: Stats }): Gate {
  const g = judgeAdditions(h.base, h.added, h.combined, LOOSENING_PROMOTION.HOLDOUT_MIN_ADDED_N);
  return { pass: g.pass, reasons: g.pass ? ["all holdout criteria met"] : g.reasons };
}

function pctOrDash(x: number | null) { return x == null ? "—" : `${(100 * x).toFixed(1)}%`; }

/** Lagos days in [from, to) on which at least one row kicked off. */
export function activeDays(rows: readonly ResearchRow[]): string[] {
  return [...new Set(rows.map((r) => r.day))].sort();
}

// ── Funnel attribution (Phase 2) ────────────────────────────────────────────

export type FunnelFixture = {
  fixtureKey: string;
  inPaidScope: boolean;
  /** Published singles on the fixture (ordinary and dedicated). */
  picks: ReadonlyArray<{ confidence: number; vipRoute: boolean; marketProbability: number | null; bookmakers: number | null; odds: number | null }>;
  carriedVip: boolean;
  /** The day's paid scope was widened (fewer than PAID_THIN_CORE_MIN core fixtures). */
  widenedDay: boolean;
};

export type FunnelLoss =
  | "PAID"
  | "NO_PUBLISHED_SINGLE"
  | "OUT_OF_PAID_SCOPE"
  | "CONFIDENCE"
  | "NOT_VIP_ROUTE_ON_HEALTHY_DAY"
  | "NO_USABLE_PRICE"
  | "MARKET_OUTSIDE_BAND"
  | "MODEL_MARKET_DISAGREE"
  | "OTHER";

/**
 * The FIRST rule that keeps a fixture out of VIP, in the order the rules are
 * applied. Pure. Uses the fixture's last pre-kickoff quote, so it says what
 * the market finally thought, not necessarily what curation read at the time.
 */
export function firstLoss(f: FunnelFixture): FunnelLoss {
  if (f.carriedVip) return "PAID";
  if (f.picks.length === 0) return "NO_PUBLISHED_SINGLE";
  if (!f.inPaidScope) return "OUT_OF_PAID_SCOPE";
  const atFloor = f.picks.filter((p) => p.confidence >= 75);
  if (atFloor.length === 0) return "CONFIDENCE";
  const route = atFloor.filter((p) => p.vipRoute);
  if (route.length === 0 && !f.widenedDay) return "NOT_VIP_ROUTE_ON_HEALTHY_DAY";
  const pool = route.length ? route : atFloor;
  const priced = pool.filter((p) => p.marketProbability != null && (p.bookmakers ?? 0) >= RESEARCH_MIN_BOOKS);
  if (route.length === 0 && priced.length === 0) return "NO_USABLE_PRICE";
  if (route.length === 0 && priced.every((p) => p.marketProbability! < 75 || p.marketProbability! > RESEARCH_MAX_MARKET)) return "MARKET_OUTSIDE_BAND";
  if (priced.length && priced.every((p) => Math.abs(p.confidence - p.marketProbability!) > 10)) return "MODEL_MARKET_DISAGREE";
  return "OTHER";
}

/**
 * "Blocked by confidence alone": a paid-scope fixture with no pick at 75+, whose
 * best 70-74 pick the market confirms on the dedicated gate's terms. These are
 * the fixtures a floor cut could reach.
 */
export function blockedByConfidenceAlone(f: FunnelFixture): boolean {
  if (f.carriedVip || !f.inPaidScope || f.picks.some((p) => p.confidence >= 75)) return false;
  return f.picks.some((p) => p.confidence >= 70 && p.marketProbability != null && p.odds != null && (p.bookmakers ?? 0) >= RESEARCH_MIN_BOOKS
    && p.marketProbability >= 75 && p.marketProbability <= RESEARCH_MAX_MARKET && Math.abs(p.confidence - p.marketProbability) <= 10);
}

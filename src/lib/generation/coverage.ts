/**
 * Adaptive competition coverage — how wide the generation scope is today.
 *
 * THE PROBLEM. The scope used to be one fixed list. That list was either too
 * wide (a quarter of a normal day's published picks came from leagues like
 * Kazakhstan's, scanned every day whether or not the site needed them) or too
 * narrow (21 September 2026: 160 fixtures on API-Football, 4 in scope, so the
 * site carried 4 predictions on an international-break day while generation
 * reported itself perfectly healthy).
 *
 * THE POLICY. CORE + SECONDARY is the normal slate and is always in scope. The
 * fallback tiers are added only when that slate is thin, and only enough to
 * bring the usable total back to a target:
 *
 *   CORE+SECONDARY >= HEALTHY_MIN (25)   no fallback scan, no fallback generation
 *   THIN_MIN (12) .. HEALTHY_MIN - 1     widen into FALLBACK toward FALLBACK_TARGET (28)
 *   < THIN_MIN                           widen into FALLBACK, then DEEP_FALLBACK, toward DEEP_TARGET (25)
 *
 * The decision is re-made from the ledger on every cycle, so there is no
 * "international break mode" to switch on or off: once the strong leagues are
 * back and CORE+SECONDARY clears the healthy mark, the fallback tiers stop
 * being scanned AND stop being generated, with no one touching anything.
 *
 * A target is a CEILING on widening, never a quota to fill. Every fallback
 * fixture must pass fallbackQualityGate below AND the same candidate rules as
 * every other fixture (candidatesFromFixtures), and after that it goes through
 * the one generation path with the one set of confidence and market gates.
 * Nothing here lowers a threshold, and there is no separate rulebook for
 * fallback leagues.
 *
 * PURE. No database and no provider calls in this module. The I/O lives in
 * generation/queue.ts, so every policy decision here can be checked
 * deterministically (scripts/check-adaptive-coverage.ts).
 */

import type { FixtureRow } from "@/lib/football/api-football";
import {
  GENERATION_TIER_ORDER,
  generationTierOf,
  leaguePriorityRank,
  leaguesInTiers,
  type GenerationTier,
  isSeniorWomensCompetition,
} from "@/lib/leagues";
import { cupSupports, isCupCompetition } from "@/lib/cupConfig";
import { GENERATE_UNTIL_HOURS, SAME_DAY_GENERATE_FROM_HOURS } from "@/lib/generation/window";

/**
 * The tunables. One object so they are changed together and in one place.
 * None of them touch prediction confidence, market confirmation or paid-tier
 * quotas; they only decide which fixtures are LOOKED AT.
 */
export const COVERAGE_POLICY = {
  /** CORE+SECONDARY at or above this is a healthy slate: fallback tiers are off. */
  HEALTHY_MIN: 25,
  /** Below this, DEEP_FALLBACK may be used after FALLBACK. */
  THIN_MIN: 12,
  /** Usable-slate target when widening into FALLBACK only ("roughly 25–30"). */
  FALLBACK_TARGET: 28,
  /** Usable-slate target when the slate is very thin ("roughly 20–30"). Lower than FALLBACK_TARGET on purpose: reaching further down is worth less per fixture. */
  DEEP_TARGET: 25,
  /** Widening never selects past this usable total, whatever the target says. */
  SLATE_CAP: 30,
  /** The by-date fallback sweep runs at most once per this many minutes (an AppLock lease), not on every discovery tick. */
  SWEEP_INTERVAL_MINUTES: 60,
  /** After a sweep whose provider calls all failed, retry this much sooner than the full interval. */
  SWEEP_RETRY_MINUTES: 15,
  /** One /fixtures?date= call per UTC day overlapping the horizon: never more than this. */
  SWEEP_MAX_DATES: 3,
  /** The sweep stands down when the day's remaining api-football budget is below this. */
  SWEEP_MIN_QUOTA_REMAINING: 1_000,
} as const;

export type CoverageMode = GenerationTier;
export type TierCounts = Record<GenerationTier, number>;

export const emptyTierCounts = (): TierCounts => ({ CORE: 0, SECONDARY: 0, FALLBACK: 0, DEEP_FALLBACK: 0 });

/**
 * The horizon a slate is counted over: the generation window, from the
 * earliest a same-day fixture may still be generated to the latest any fixture
 * may be. A fixture already kicking off does not make the slate healthy.
 */
export function coverageHorizon(now: Date): { from: Date; until: Date } {
  return {
    from: new Date(now.getTime() + SAME_DAY_GENERATE_FROM_HOURS * 3_600_000),
    until: new Date(now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000),
  };
}

/**
 * Count distinct viable fixtures per tier from rows already in the database
 * (ledger rows that are not ABANDONED, predictions that are not ARCHIVED).
 * Identity is the provider fixture id where known, else the matchKey, so a
 * fixture that has both a ledger row and predictions counts once.
 * Competitions in no tier are not counted: they do not affect the scope.
 */
export function tallySlate(entries: Array<{ fixtureApiId: number | null; matchKey: string | null; leagueApiId: number | null }>): TierCounts {
  const counts = emptyTierCounts();
  const seen = new Set<string>();
  for (const e of entries) {
    const tier = generationTierOf(e.leagueApiId);
    if (!tier) continue;
    const id = e.fixtureApiId != null ? `f${e.fixtureApiId}` : e.matchKey ? `k${e.matchKey}` : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    counts[tier]++;
  }
  return counts;
}

export type CoverageDecision = {
  /** The deepest tier the slate needs. CORE = CORE alone is healthy; SECONDARY is always in scope regardless. */
  mode: CoverageMode;
  counts: TierCounts;
  higherTierCount: number;
  /** Tiers whose fixtures may be discovered and generated right now. */
  allowedTiers: GenerationTier[];
  widened: boolean;
  /** Usable-slate target while widened; null when healthy. */
  target: number | null;
  /** Fallback fixtures already in the ledger for the allowed fallback tiers. They count toward the target. */
  fallbackAlreadySelected: number;
  /** How many more fallback fixtures this cycle may add. 0 when healthy or already at target. */
  need: number;
  reason: string;
};

export function decideCoverage(counts: TierCounts, policy = COVERAGE_POLICY): CoverageDecision {
  const higher = counts.CORE + counts.SECONDARY;
  if (higher >= policy.HEALTHY_MIN) {
    const coreAlone = counts.CORE >= policy.HEALTHY_MIN;
    return {
      mode: coreAlone ? "CORE" : "SECONDARY",
      counts,
      higherTierCount: higher,
      allowedTiers: ["CORE", "SECONDARY"],
      widened: false,
      target: null,
      fallbackAlreadySelected: 0,
      need: 0,
      reason: `healthy: ${higher} CORE+SECONDARY fixtures in the next ${GENERATE_UNTIL_HOURS}h (>= ${policy.HEALTHY_MIN})${coreAlone ? `, ${counts.CORE} from CORE alone` : ""}; fallback tiers not scanned or generated`,
    };
  }

  const deep = higher < policy.THIN_MIN;
  const target = Math.min(deep ? policy.DEEP_TARGET : policy.FALLBACK_TARGET, policy.SLATE_CAP);
  const already = counts.FALLBACK + (deep ? counts.DEEP_FALLBACK : 0);
  const need = Math.max(0, target - higher - already);
  return {
    mode: deep ? "DEEP_FALLBACK" : "FALLBACK",
    counts,
    higherTierCount: higher,
    allowedTiers: deep ? [...GENERATION_TIER_ORDER] : ["CORE", "SECONDARY", "FALLBACK"],
    widened: true,
    target,
    fallbackAlreadySelected: already,
    need,
    reason: deep
      ? `very thin: ${higher} CORE+SECONDARY fixtures (< ${policy.THIN_MIN}); widening into FALLBACK then DEEP_FALLBACK toward ~${target}`
      : `thin: ${higher} CORE+SECONDARY fixtures (< ${policy.HEALTHY_MIN}); widening into FALLBACK toward ~${target}`,
  };
}

/** League ids ordinary generation must NOT take right now: every tier outside the decision's scope. */
export function excludedLeagueIds(decision: Pick<CoverageDecision, "allowedTiers">): number[] {
  return leaguesInTiers(GENERATION_TIER_ORDER.filter((t) => !decision.allowedTiers.includes(t)));
}

/**
 * The UTC dates a by-date sweep must fetch to cover the horizon — one
 * /fixtures?date= call each. Two or three depending on the hour, never more
 * than SWEEP_MAX_DATES. This is the whole provider cost of discovering EVERY
 * fallback league at once; the per-league alternative is one call per league.
 */
export function sweepDates(now: Date, policy = COVERAGE_POLICY): string[] {
  const { from, until } = coverageHorizon(now);
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (cursor <= until && dates.length < policy.SWEEP_MAX_DATES) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// The fallback quality gate
// ---------------------------------------------------------------------------

/**
 * Reserve, youth, women's and B sides. The provider files these under the
 * senior competition in several fallback leagues — the EFL Trophy's Premier
 * League academy sides are the worked example, 23 fixtures on 22 September
 * with half of them against an "… U21" team — and the model has no history
 * for them that means anything.
 */
const NON_SENIOR_SIDE = /(?:^|[\s(])(?:U-?\d{2}|II|III|B|C|Reserves?|Res\.?|Youth|Academy|Women|Ladies|W|Fem\.?|Femenil|Feminino|Femenino)(?:$|[\s)])/i;
/**
 * The same rule with the women's markers taken out, for a competition that is
 * EXPLICITLY a senior women's competition (SENIOR_WOMENS_COMPETITION_IDS). In
 * the WSL "Arsenal W" is the senior side; "Arsenal W U21", a B team or a
 * reserve side still fails here exactly as it does in men's football.
 */
const NON_SENIOR_WOMENS_SIDE = /(?:^|[\s(])(?:U-?\d{2}|II|III|B|C|Reserves?|Res\.?|Youth|Academy)(?:$|[\s)])/i;
const JONG_PREFIX = /^Jong\s/i;

/**
 * Whether a team name is a reserve, youth, B or (outside a supported senior
 * women's competition) women's side.
 *
 * Pass the fixture's league: the women's-name allowance is decided by the
 * competition, never by the team name. A "… W" side in an unrelated
 * competition is still refused, and the full regex is the default.
 */
export function isNonSeniorSide(name: string, leagueApiId?: number | null): boolean {
  const trimmed = name.trim();
  const rule = isSeniorWomensCompetition(leagueApiId) ? NON_SENIOR_WOMENS_SIDE : NON_SENIOR_SIDE;
  return rule.test(trimmed) || JONG_PREFIX.test(trimmed);
}

export type GateRejection =
  | "invalid_ids"
  | "unrecognised_competition"
  | "not_scheduled"
  | "bad_kickoff"
  | "missing_team_names"
  | "non_senior_side"
  | "unpriced_cup"
  | "no_bookmakers";

export type OddsKnowledge = { bookmakerCount: number | null; fetchedAt: Date | null };

/**
 * Cheap pre-generation checks for a FALLBACK/DEEP_FALLBACK fixture, using only
 * what is already known: the provider row itself, our cup configuration, and
 * FixtureOddsCache where a row happens to exist. No provider calls.
 *
 * Deliberately strict in one direction only: it can REFUSE a fixture, never
 * vouch for one. A pass here means "worth generating"; whether anything is
 * published is still decided by the ordinary generation gates, unchanged.
 */
export function fallbackQualityGate(
  row: FixtureRow,
  ctx: { odds?: OddsKnowledge | null } = {},
): { ok: true; tier: GenerationTier } | { ok: false; reason: GateRejection } {
  const isPositiveInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
  const home = row.teams?.home;
  const away = row.teams?.away;
  if (!isPositiveInt(row.fixture?.id) || !isPositiveInt(home?.id) || !isPositiveInt(away?.id) || home.id === away.id) {
    return { ok: false, reason: "invalid_ids" };
  }

  const tier = generationTierOf(row.league?.id);
  if (tier !== "FALLBACK" && tier !== "DEEP_FALLBACK") return { ok: false, reason: "unrecognised_competition" };

  if (row.fixture.status?.short !== "NS") return { ok: false, reason: "not_scheduled" };
  if (Number.isNaN(new Date(row.fixture.date).getTime())) return { ok: false, reason: "bad_kickoff" };

  if (!home.name?.trim() || !away.name?.trim()) return { ok: false, reason: "missing_team_names" };
  if (isNonSeniorSide(home.name, row.league.id) || isNonSeniorSide(away.name, row.league.id)) return { ok: false, reason: "non_senior_side" };

  // A configured cup we have recorded as unpriced. Unconfigured competitions
  // are leagues, which cupSupports treats as supported.
  if (isCupCompetition(row.league.id) && !cupSupports(row.league.id, "odds")) return { ok: false, reason: "unpriced_cup" };

  // Bookmakers already asked and answered "nothing". Absence of a cache row is
  // not evidence either way and is not held against the fixture.
  if (ctx.odds?.fetchedAt && ctx.odds.bookmakerCount === 0) return { ok: false, reason: "no_bookmakers" };

  return { ok: true, tier };
}

export type FallbackPlan = {
  /** Gated, deduplicated rows per fallback tier, in priority order (league priority, then kickoff). */
  eligible: { FALLBACK: FixtureRow[]; DEEP_FALLBACK: FixtureRow[] };
  /** Distinct competitions of each tier present in the sweep payload — "leagues scanned" for a by-date sweep. */
  leaguesSeenByTier: TierCounts;
  rejected: Partial<Record<GateRejection, number>>;
  /** Fallback-tier rows in the payload, before the gate. */
  considered: number;
};

/**
 * Sort a sweep payload into what may be generated. Rows outside the decision's
 * fallback tiers are ignored (not "rejected": they were never in scope), so a
 * FALLBACK-mode sweep cannot pick up DEEP_FALLBACK fixtures however many there
 * are, and a healthy decision yields nothing at all.
 */
export function planFallback(
  rows: FixtureRow[],
  decision: Pick<CoverageDecision, "allowedTiers" | "widened">,
  oddsByMatchKey: Map<string, OddsKnowledge> = new Map(),
  keyOf: (row: FixtureRow) => string | null = () => null,
): FallbackPlan {
  const plan: FallbackPlan = { eligible: { FALLBACK: [], DEEP_FALLBACK: [] }, leaguesSeenByTier: emptyTierCounts(), rejected: {}, considered: 0 };
  const leaguesSeen = new Set<number>();
  for (const row of rows) {
    const tier = generationTierOf(row.league?.id);
    if (tier && !leaguesSeen.has(row.league.id)) {
      leaguesSeen.add(row.league.id);
      plan.leaguesSeenByTier[tier]++;
    }
  }
  if (!decision.widened) return plan;

  const taken = new Set<number>();
  for (const row of rows) {
    const tier = generationTierOf(row.league?.id);
    if ((tier !== "FALLBACK" && tier !== "DEEP_FALLBACK") || !decision.allowedTiers.includes(tier)) continue;
    plan.considered++;
    const key = keyOf(row);
    const verdict = fallbackQualityGate(row, { odds: key ? oddsByMatchKey.get(key) : null });
    if (!verdict.ok) {
      plan.rejected[verdict.reason] = (plan.rejected[verdict.reason] ?? 0) + 1;
      continue;
    }
    if (taken.has(row.fixture.id)) continue;
    taken.add(row.fixture.id);
    plan.eligible[verdict.tier as "FALLBACK" | "DEEP_FALLBACK"].push(row);
  }
  const order = (a: FixtureRow, b: FixtureRow) =>
    leaguePriorityRank(a.league.id) - leaguePriorityRank(b.league.id)
    || new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime()
    || a.fixture.id - b.fixture.id;
  plan.eligible.FALLBACK.sort(order);
  plan.eligible.DEEP_FALLBACK.sort(order);
  return plan;
}

/**
 * Fill `need` from the fallback tiers IN ORDER: FALLBACK first, and
 * DEEP_FALLBACK only for what FALLBACK could not supply. `take` receives each
 * tier's eligible rows plus the remaining need and returns how many it
 * actually added (after the shared candidate rules drop anything already
 * generated, queued or backing off).
 */
export async function fillFromTiers(
  plan: FallbackPlan,
  decision: Pick<CoverageDecision, "allowedTiers" | "need">,
  take: (rows: FixtureRow[], need: number, tier: GenerationTier) => Promise<number>,
): Promise<{ selected: number; byTier: Partial<Record<GenerationTier, number>> }> {
  let remaining = decision.need;
  const byTier: Partial<Record<GenerationTier, number>> = {};
  for (const tier of ["FALLBACK", "DEEP_FALLBACK"] as const) {
    if (remaining <= 0 || !decision.allowedTiers.includes(tier) || plan.eligible[tier].length === 0) continue;
    const added = Math.min(remaining, Math.max(0, await take(plan.eligible[tier], remaining, tier)));
    byTier[tier] = added;
    remaining -= added;
  }
  return { selected: decision.need - remaining, byTier };
}

/** The one-line JobRun summary. Written so a healthy "did no fallback work" run reads as healthy. */
export function summariseCoverage(c: {
  mode: CoverageMode;
  higherTierCount: number;
  widened: boolean;
  target: number | null;
  fallbackSelected: number;
  providerCalls: number;
  sweepSkippedReason?: string | null;
}): string {
  if (!c.widened) {
    return `${c.mode} healthy: ${c.higherTierCount} CORE+SECONDARY fixtures; no fallback work; ${c.providerCalls} provider call${c.providerCalls === 1 ? "" : "s"}`;
  }
  const sweep = c.sweepSkippedReason ? `; sweep skipped: ${c.sweepSkippedReason}` : "";
  return `widened to ${c.mode}: ${c.higherTierCount} CORE+SECONDARY fixtures (target ~${c.target}); queued ${c.fallbackSelected} fallback; ${c.providerCalls} provider call${c.providerCalls === 1 ? "" : "s"}${sweep}`;
}

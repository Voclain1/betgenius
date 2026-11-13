import type { FixtureRow } from "@/lib/football/api-football";
import { MIN_BOOKMAKERS } from "@/lib/odds";
import { fallbackQualityGate, type GateRejection, type OddsKnowledge } from "@/lib/generation/coverage";
import { fairOrder, laneCompetitionIds, PROPOSED_RULES, type CoverageRollout } from "@/lib/generation/competitionEligibility";

/**
 * Sprint 05 continuation: the bounded evaluation lane.
 *
 * On a HEALTHY day the adaptive scope never looks beyond CORE and SECONDARY,
 * so a well-priced fixture in an evidence-backed smaller competition is never
 * even evaluated. The lane is a small, separately budgeted look outside the
 * tiers on those days:
 *
 *   - Which competitions: only those the eligibility evidence supports
 *     (laneCompetitionIds: registry additions plus the global audit's INCLUDE
 *     decisions). No geography or reputation input.
 *   - What it may queue: fixtures passing the SAME fallback quality gate, then
 *     only with a bookmaker quote of at least MIN_BOOKMAKERS. Absence of a
 *     quote is not enough here, unlike the thin-day sweep.
 *   - How much: at most EVALUATION_LANE.MAX_QUEUE_PER_RUN per run and
 *     MAX_QUEUE_PER_DAY per Lagos day, one fixture per competition per run.
 *   - What it cannot do: it never publishes. Ordinary generation persists every
 *     pick PENDING_REVIEW, and the worker orders uncatalogued and DEEP_FALLBACK
 *     fixtures after every catalogued one, so a lane fixture can never take a
 *     generation slot from a better-placed candidate.
 *
 * COVERAGE_ROLLOUT:
 *   off     the lane does not run.
 *   shadow  (default) at most every INTERVAL_MINUTES it fetches the by-date
 *           payload (MAX_DATES calls) and RECORDS what it would have queued,
 *           with no odds calls and no queueing.
 *   on      the same, plus up to MAX_ODDS_SAMPLES odds calls, and it queues
 *           what qualifies.
 *
 * Budget, worst case: shadow 2 calls x 8 runs = 16 calls/day; on (2 + 3) x 8 =
 * 40 calls/day (0.5% of 7,500). It never runs below MIN_QUOTA_REMAINING.
 */
export const EVALUATION_LANE = {
  INTERVAL_MINUTES: 180,
  MAX_DATES: 2,
  MAX_ODDS_SAMPLES: 3,
  MAX_QUEUE_PER_RUN: 3,
  MAX_QUEUE_PER_DAY: 8,
  MIN_QUOTA_REMAINING: 2_000,
} as const;

export const EVALUATION_LANE_LEASE_KEY = "generation-evaluation-lane";

export function laneCallBudget(rollout: CoverageRollout, lane = EVALUATION_LANE): { perRun: number; perDay: number } {
  if (rollout === "off") return { perRun: 0, perDay: 0 };
  const perRun = lane.MAX_DATES + (rollout === "on" ? lane.MAX_ODDS_SAMPLES : 0);
  return { perRun, perDay: perRun * Math.ceil((24 * 60) / lane.INTERVAL_MINUTES) };
}

export type LanePlan = {
  considered: number;
  rejected: Partial<Record<GateRejection, number>>;
  /** Gate-passing rows, one per competition, fair order, before the bookmaker check. */
  shortlist: FixtureRow[];
  /** Of the shortlist, rows whose cached quote already shows >= MIN_BOOKMAKERS. */
  pricedFromCache: number;
  byCompetition: Record<number, number>;
};

/** Pure. Rows outside the lane competitions are ignored (never "rejected"). */
export function planEvaluationLane(
  rows: readonly FixtureRow[],
  odds: Map<string, OddsKnowledge>,
  keyOf: (r: FixtureRow) => string | null,
  now: Date,
  laneIds: ReadonlySet<number> = new Set(laneCompetitionIds()),
): LanePlan {
  const plan: LanePlan = { considered: 0, rejected: {}, shortlist: [], pricedFromCache: 0, byCompetition: {} };
  const passing: FixtureRow[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (!laneIds.has(r.league?.id)) continue;
    plan.considered++;
    const k = keyOf(r);
    const v = fallbackQualityGate(r, { odds: k ? odds.get(k) : null, now, rules: { ...PROPOSED_RULES, tierOf: () => "DEEP_FALLBACK" } });
    if (!v.ok) { plan.rejected[v.reason] = (plan.rejected[v.reason] ?? 0) + 1; continue; }
    if (seen.has(r.fixture.id)) continue;
    seen.add(r.fixture.id);
    passing.push(r);
  }
  const ordered = fairOrder(passing, (r) => r.league.id, (r) => new Date(r.fixture.date).getTime(), (r) => r.fixture.id);
  const perComp = new Set<number>();
  for (const r of ordered) {
    if (perComp.has(r.league.id)) continue;
    perComp.add(r.league.id);
    plan.shortlist.push(r);
    plan.byCompetition[r.league.id] = 1;
  }
  plan.pricedFromCache = plan.shortlist.filter((r) => {
    const k = keyOf(r);
    const o = k ? odds.get(k) : undefined;
    return (o?.bookmakerCount ?? 0) >= MIN_BOOKMAKERS;
  }).length;
  return plan;
}

/** How many the lane may still queue now: per-run cap, less what today already took. */
export function laneAllowance(queuedToday: number, lane = EVALUATION_LANE): number {
  return Math.max(0, Math.min(lane.MAX_QUEUE_PER_RUN, lane.MAX_QUEUE_PER_DAY - queuedToday));
}

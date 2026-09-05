/**
 * Odds-tier accumulators: the daily curation pass.
 *
 * Reads published picks and their cached prices, assembles one accumulator per
 * reachable tier, and persists them as Combos. src/lib/accumulatorTiers.ts owns
 * the selection rules; this file owns the reads, the cadence gate and the write.
 *
 * COST: ZERO API CALLS. Everything here is already in the database —
 * FixtureOddsCache is filled by the existing odds workload, Prediction by
 * generation. Unlike the Market-Confirmed gate, which spends odds quota to
 * reach its verdict, this is pure compute over data another job already paid
 * for. That is what makes a daily cadence essentially free, and it is why the
 * pass may safely re-run.
 *
 * The pass is IDEMPOTENT per Lagos day: a tier already published today is left
 * alone rather than rebuilt, so a second run (a retry, a manual trigger, a cron
 * overlap) cannot produce two 10x cards or silently reprice a published one.
 */
import { prisma } from "@/lib/prisma";
import { lagosDayBounds } from "@/lib/lagosDate";
import { matchKey } from "@/lib/slug";
import { setComboLegs } from "@/lib/combos";
import { findSelection, toBookmakerSelection, MIN_BOOKMAKERS, type FixtureOdds } from "@/lib/odds";
import { LEAGUE_PRIORITY_ORDER } from "@/lib/leagues";
import {
  ACCUMULATOR_TIERS,
  MIN_POOL_LEGS,
  TIER_CATEGORY,
  TIER_CONFIDENCE_FLOOR,
  combinedOdds,
  findTierCombination,
  tierDescription,
  tierLabel,
  type AccumulatorLeg,
} from "@/lib/accumulatorTiers";

/** The four markets prices are stored for — anything else cannot be priced and so cannot be a leg. */
const HEADLINE_MARKET_TYPES = new Set(["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"]);

export type PoolResult = {
  legs: AccumulatorLeg[];
  /** Every filter's survivor count, so a thin day can be explained rather than just reported. */
  funnel: { published: number; headline: number; cached: number; priced: number; deep: number; futureOnly: number };
};

/**
 * Candidate legs for today: published picks, still ahead of kickoff, in a
 * priced market, with a real multi-bookmaker quote for their OWN selection.
 *
 * Resolution goes through toBookmakerSelection then findSelection — the same
 * path Bet of the Day uses. That is not incidental: those two functions are
 * what guarantee the price belongs to the selection being tipped rather than
 * to some other line on the same fixture, and re-implementing the lookup here
 * would be the one place this feature could quietly start quoting the wrong
 * number.
 *
 * Kickoff must be in the FUTURE. An accumulator whose first leg has already
 * started is unplaceable, and publishing one would be advertising a bet the
 * reader cannot take.
 */
export async function buildAccumulatorPool(now: Date = new Date()): Promise<PoolResult> {
  const { start, end } = lagosDayBounds(0, now);

  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: start, lt: end }, homeTeam: { not: null }, awayTeam: { not: null } },
    select: {
      id: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
      marketType: true, selection: true, market: true, pick: true, confidence: true, leagueApiId: true,
    },
    orderBy: [{ confidence: "desc" }, { id: "asc" }],
  });

  const funnel = { published: rows.length, headline: 0, cached: 0, priced: 0, deep: 0, futureOnly: 0 };

  const future = rows.filter((r) => r.kickoff !== null && r.kickoff.getTime() > now.getTime());
  funnel.futureOnly = future.length;

  const headline = future.filter((r) => HEADLINE_MARKET_TYPES.has(r.marketType));
  funnel.headline = headline.length;

  const keys = [...new Set(headline.map((r) => matchKey(r)).filter((k): k is string => k !== null))];
  const cached = keys.length
    ? await prisma.fixtureOddsCache.findMany({
        where: { matchKey: { in: keys }, fetchedAt: { not: null } },
        select: { matchKey: true, oddsJson: true },
      })
    : [];
  const oddsByKey = new Map(cached.map((c) => [c.matchKey, c.oddsJson as unknown as FixtureOdds | null]));

  const legs: AccumulatorLeg[] = [];
  for (const r of headline) {
    const key = matchKey(r);
    if (!key || !oddsByKey.has(key)) continue;
    funnel.cached++;

    const bk = toBookmakerSelection(r.marketType, r.selection);
    if (!bk) continue;
    const sel = findSelection(oddsByKey.get(key) ?? null, bk.market, bk.value);
    if (!sel) continue;
    funnel.priced++;

    // A price one book is shouting into the void is not a market price. Same
    // bar Bet of the Day applies, for the same reason.
    if (sel.bookmakers < MIN_BOOKMAKERS) continue;
    funnel.deep++;

    // Widened to readonly number[]: LEAGUE_PRIORITY_ORDER is a const tuple of
    // literal ids, so indexOf would only accept an id already in the list —
    // which is the opposite of the question being asked here.
    const priorityIndex = r.leagueApiId != null ? (LEAGUE_PRIORITY_ORDER as readonly number[]).indexOf(r.leagueApiId) : -1;
    legs.push({
      predictionId: r.id,
      fixture: key,
      matchLabel: `${r.homeTeam} vs ${r.awayTeam}`,
      market: r.market,
      pick: r.pick,
      odds: sel.best,
      bookmakers: sel.bookmakers,
      confidence: r.confidence,
      // Unranked leagues sort last rather than first — indexOf returns -1, and
      // treating that as "top priority" would put the most obscure competitions
      // ahead of the Premier League in every tie.
      leaguePriority: priorityIndex === -1 ? LEAGUE_PRIORITY_ORDER.length : priorityIndex,
    });
  }

  return { legs, funnel };
}

/**
 * Whether the odds workload has produced anything usable for today yet.
 *
 * The cadence gate. Running the pass before the odds refresh has reached
 * today's card would assemble from whatever fragment happened to be cached,
 * publish a thin ladder, and then — because the pass is idempotent per day —
 * refuse to improve on it when the real prices landed an hour later. Checking
 * the pool rather than a job-status flag is the more honest test: what matters
 * is whether enough priced legs EXIST, not whether some other job reported
 * success.
 */
export function oddsWorkloadReady(pool: PoolResult): boolean {
  return pool.legs.length >= MIN_POOL_LEGS;
}

export type TierOutcome = {
  tier: number;
  status: "created" | "exists" | "empty";
  comboId?: string;
  legs?: number;
  product?: number;
  weakestLeg?: number;
  /** Why a tier came up empty, in words, so an empty ladder is explainable. */
  reason?: string;
};

export type AccumulatorRunResult = {
  ranAt: string;
  poolSize: number;
  funnel: PoolResult["funnel"];
  /** False when the pool gate stood the whole pass down — no tier was attempted. */
  attempted: boolean;
  tiers: TierOutcome[];
};

/**
 * Today's already-published accumulators, by tier.
 *
 * Keyed on the Lagos day the combo was created in, matching every other daily
 * quota in the app. oddsTier being non-null is what distinguishes a curated
 * accumulator from the hand-built Multi Bets that have always lived in this
 * table — a manual combo must never be counted against, or overwritten by,
 * this pass.
 */
export async function accumulatorsToday(now: Date = new Date()): Promise<Map<number, string>> {
  const { start, end } = lagosDayBounds(0, now);
  const rows = await prisma.combo.findMany({
    where: { oddsTier: { not: null }, createdAt: { gte: start, lt: end } },
    select: { id: true, oddsTier: true },
  });
  return new Map(rows.map((r) => [r.oddsTier!, r.id]));
}

/**
 * Assembles and publishes one accumulator per reachable tier.
 *
 * A tier that cannot be reached from today's pool is left EMPTY. Nothing here
 * relaxes the band, drops the confidence floor, or reaches outside the priced
 * pool to fill a rung — the 50x is expected to come up empty on thin days
 * (measured: one day in eleven), and forcing it would mean publishing an
 * accumulator that the day's actual prices did not support.
 */
export async function curateAccumulators(
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<AccumulatorRunResult> {
  const now = options.now ?? new Date();
  const pool = await buildAccumulatorPool(now);

  if (!oddsWorkloadReady(pool)) {
    return {
      ranAt: now.toISOString(),
      poolSize: pool.legs.length,
      funnel: pool.funnel,
      attempted: false,
      tiers: ACCUMULATOR_TIERS.map((tier) => ({
        tier,
        status: "empty" as const,
        reason: `pool of ${pool.legs.length} usable legs is below the ${MIN_POOL_LEGS}-leg gate`,
      })),
    };
  }

  const existing = await accumulatorsToday(now);
  const tiers: TierOutcome[] = [];

  for (const tier of ACCUMULATOR_TIERS) {
    const already = existing.get(tier);
    if (already) {
      tiers.push({ tier, status: "exists", comboId: already });
      continue;
    }

    const combo = findTierCombination(pool.legs, tier);
    if (!combo) {
      tiers.push({
        tier,
        status: "empty",
        reason: `no combination of <=8 distinct fixtures at >=${TIER_CONFIDENCE_FLOOR}% lands in [${tier}, ${(tier * 1.25).toFixed(2)}]`,
      });
      continue;
    }

    const product = combinedOdds(combo);
    const weakest = Math.min(...combo.map((c) => c.confidence));

    if (options.dryRun) {
      tiers.push({ tier, status: "created", legs: combo.length, product, weakestLeg: weakest });
      continue;
    }

    const created = await prisma.combo.create({
      data: {
        title: tierLabel(tier),
        description: tierDescription(combo),
        category: TIER_CATEGORY[tier],
        published: true,
        oddsTier: tier,
      },
      select: { id: true },
    });

    await setComboLegs(
      created.id,
      combo.map((leg) => ({
        matchLabel: leg.matchLabel,
        market: leg.market,
        pick: leg.pick,
        predictionId: leg.predictionId,
        odds: leg.odds,
      })),
    );

    tiers.push({ tier, status: "created", comboId: created.id, legs: combo.length, product, weakestLeg: weakest });
  }

  return { ranAt: now.toISOString(), poolSize: pool.legs.length, funnel: pool.funnel, attempted: true, tiers };
}

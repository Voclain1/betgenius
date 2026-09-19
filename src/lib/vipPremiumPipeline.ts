import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { matchKey } from "@/lib/slug";
import { leaguePriorityRank } from "@/lib/leagues";
import { setPredictionCategories } from "@/lib/predictions";
import type { FixtureOdds } from "@/lib/odds";
import type { Selection } from "@/lib/markets";
import { VIP_PROXY_LEAGUE_IDS } from "@/lib/ai/generationRisk";
import { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS } from "@/lib/generation/selector";
import {
  evaluateMarketConfirmed,
  compareMarketConfirmed,
  lopsidednessSignal,
  MC_MIN_MARKET_PROBABILITY,
  MC_MAX_QUOTE_AGE_MS,
  type MarketConfirmedVerdict,
} from "@/lib/marketConfirmed";
import { VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE } from "@/lib/geniusCuration";

/**
 * The dedicated VIP/PREMIUM pass: market-first targeting, one generation, two bars.
 *
 * WHAT THIS REPLACES, AND WHY. marketConfirmedPipeline.ts was already a
 * dedicated VIP/PREMIUM pass — its categories were literally ["VIP","PREMIUM"]
 * — and it was measured rather than assumed to be broken. Over 90 days it ran
 * 82 jobs on 22 distinct days, produced 168 drafts, and promoted 3 rows (1.8%).
 * Two independent causes, both structural and neither about the prompt:
 *
 *   COLD ODDS. Not one of the 168 drafts had a fresh quote when the gate read
 *   it. Drafts are created a median 43.3h before kickoff (p25 40.8, p75 45.8);
 *   odds were being FETCHED a median 1.8h before kickoff (p25 0.8, p90 15.8).
 *   The gate ran in the same request as generation, so it was asking the market
 *   a question roughly 41 hours before anything had asked the books. Median
 *   quote age at draft time was MINUS 41.7 hours — the cache row was filled
 *   afterwards, every time.
 *
 *   READ THAT 1.8h FIGURE CORRECTLY. It is when the REFRESH CRON got round to a
 *   fixture, not when a market exists to be read. The first live run of this
 *   pass tested the difference directly and the distinction is the whole reason
 *   this design works: priced on demand, 11 of 11 in-scope fixtures returned a
 *   full quote, including ones 25.8h, 27.3h and 28.3h before kickoff, at five
 *   to six bookmakers each. The books open well inside the generation window.
 *   Nothing had been asking them.
 *
 *   NO TARGETING. 60.7% of its drafts were rejected MODEL_BELOW_FLOOR. It took
 *   the next N fixtures from ordinary discovery, so most of what it generated
 *   was never going to clear 75 in the first place.
 *
 * This pass inverts both, the same way selectBetOfTheDayTargets inverts the
 * price band: a fixture is generated for BECAUSE the market has already priced
 * it into qualifying territory. A fresh quote therefore exists by construction,
 * and the candidate pool is pre-filtered to fixtures the market already calls
 * one-sided, which is where the model's own confidence is highest.
 *
 * WHAT IT DOES NOT DO — deliberately. It does not use a different prompt. That
 * experiment has already been run here and lost: the original tier-keyed
 * calibration told VIP/PREMIUM to be "more safer", and on fixtures the book
 * made the favourite 65%+, VIP-tier drafts took the straight winner 35.7% of
 * the time against GENIUS-tier's 72.7% — a 37pp gap on fixtures of the same
 * lopsidedness (see the note on tieredCalibrationBlock in ai/analysis.ts). A
 * stricter paid-tier prompt does not produce more rigour, it produces
 * over-hedging. And hedges are precisely where this gate fails: across 213
 * paid-tier-eligible rows, MATCH_WINNER confirmed 56.3% of the time and
 * DOUBLE_CHANCE 26.5%, while BTTS confirmed 0% (80% of it MARKET_BELOW_FLOOR).
 *
 * The market mix corrects itself through CANDIDATE SELECTION instead. Margin
 * calibration already routes a lopsided fixture to MATCH_WINNER, and targeting
 * selects lopsided fixtures — so the same prompt, given better inputs, produces
 * the market mix the gate can actually confirm. Rigour comes from the
 * cross-check and the floors, not from prose.
 *
 * ADDITIVE, NEVER A REPLACEMENT. Ordinary curation keeps filling VIP and
 * PREMIUM exactly as it does today. A day on which nothing qualifies is a
 * normal day, not a failure — the tiers were already empty on 6 of 31 observed
 * days for reasons this pass neither causes nor fixes.
 */

/** Label recorded on AIJob.prompt.intent — see GenerateFixtureInput.intent. */
export const VIP_PREMIUM_INTENT = "VIP_PREMIUM" as const;

/**
 * Dedicated generation attempts per day.
 *
 * Counted as ATTEMPTS, not survivors, for the reason every other pass here
 * counts them that way: a draft that then fails the gate has still spent
 * api-football budget, a model call and real money, and counting only successes
 * would let a bad day retry without limit.
 *
 * 6 is sized against the measured candidate supply, not chosen for feel. Over
 * 31 days there were ~6.4 paid-tier-eligible fixtures a day; modelled yield at
 * the VIP bar is 1.65 picks/day and at the PREMIUM bar 1.00/day. Six attempts
 * is enough to land one or two picks without consuming the whole pool, and
 * costs at most ~66 api-football calls (0.9% of the 7,500/day ceiling, which
 * currently runs 44-63% used) plus roughly 44k model tokens at the measured
 * 5.7k prompt + 1.6k output per job.
 *
 * Like BANKER_DAILY_QUOTA's 3, this is a starting number chosen so that being
 * wrong about it is affordable. The recorded attempt-to-promotion ratio is what
 * should revise it — see scripts/verify-vip-premium-pass.ts.
 */
export const VIP_PREMIUM_DAILY_QUOTA = 6;

/**
 * The market bar for each tier.
 *
 * VIP reuses MC_MIN_MARKET_PROBABILITY rather than restating 75, because it IS
 * that bar — the gate's own floor, unchanged.
 *
 * PREMIUM's 80 is the measured separator. Over 206 settled paid-tier-eligible
 * rows, raising the MODEL confidence floor from 75 to 80 moved the strike rate
 * 76.2% -> 78.8% while cutting the sample from 206 to 33. Raising the MARKET
 * floor from 75 to 80 moved it 84.2% -> 86.5% on a larger surviving sample
 * (n=57 -> n=37). The market is what separates the tiers; the confidence floor
 * barely does, which is why PREMIUM is a strict subset on price rather than a
 * second, higher confidence bar.
 */
export const VIP_MARKET_FLOOR = MC_MIN_MARKET_PROBABILITY;
export const PREMIUM_MARKET_FLOOR = 80;

/**
 * NOT tightened, on purpose. Agreement is non-monotonic against outcome in the
 * measured data — 0-5pp strikes 72.1% (n=43) while 5-10pp strikes 88.0%
 * (n=25) — so the gap is not the discriminator and narrowing it would trade
 * yield for noise. MC_MAX_GAP_PP stays where it is; this constant exists only
 * to make that decision legible rather than accidental.
 */
export const VIP_PREMIUM_MAX_GAP_PP_UNCHANGED = true;

/**
 * Most fixtures this pass will price itself in one run.
 *
 * Sized to the observed in-scope candidate pool (11 on the first live probe),
 * so a normal run warms all of them and an unusual day is still bounded. One
 * api-football call each.
 */
export const VIP_PREMIUM_ODDS_WARM_LIMIT = 12;

function intentOf(promptJson: string): string | null {
  try {
    return JSON.parse(promptJson)?.intent ?? null;
  } catch {
    return null;
  }
}

export async function vipPremiumGeneratedToday(now: Date = new Date()): Promise<number> {
  const { start, end } = lagosTodayBounds(now);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { prompt: true },
  });
  return jobs.filter((j) => intentOf(j.prompt) === VIP_PREMIUM_INTENT).length;
}

/**
 * Remaining quota for a KNOWN count, and whether that count exhausts the day.
 *
 * Pure, and separated from the counting query on purpose. The quota rule and
 * "how many did we generate today" are different questions: the first is fixed
 * arithmetic that must hold for every input, the second is whatever production
 * happens to have done since midnight in Lagos. Folding them together meant the
 * rule could only be checked against live state, so the check that guarded it
 * failed legitimately on any day generation had already run.
 *
 * Both call sites below go through these, so the stand-down decision is the
 * same comparison everywhere rather than two inequalities that could drift.
 */
export function vipPremiumQuotaFrom(generatedToday: number): number {
  return Math.max(0, VIP_PREMIUM_DAILY_QUOTA - generatedToday);
}

export function vipPremiumQuotaExhausted(generatedToday: number): boolean {
  return vipPremiumQuotaFrom(generatedToday) <= 0;
}

export async function vipPremiumQuotaRemaining(now: Date = new Date()): Promise<number> {
  return vipPremiumQuotaFrom(await vipPremiumGeneratedToday(now));
}

export type VipPremiumTarget = {
  matchKey: string;
  fixtureApiId: number;
  leagueApiId: number | null;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  /** The de-vigged probability that made this fixture worth a paid-tier attempt. */
  marketProbability: number;
  market: string;
  selection: string;
  bookmakers: number;
  quoteAgeMs: number;
};

export type TargetSelection = {
  targets: VipPremiumTarget[];
  /** Un-generated fixtures inside the odds horizon. */
  considered: number;
  /** ...of which are in the paid-tier league scope. */
  inScope: number;
  /** ...of which carry a quote fresh enough for the gate to read. */
  freshlyPriced: number;
  /** ...of which the market already prices at or above the VIP bar. */
  qualified: number;
  /** Fixtures this run priced itself before reading the cache. */
  warmed: number;
};

/**
 * Which un-generated fixtures deserve a paid-tier attempt today — market first.
 *
 * Mirrors selectBetOfTheDayTargets: read the same GenerationAttempt-backed
 * candidate list, keep only fixtures the cached market already qualifies, and
 * hand those to the worker through its matchKeys allow-list. Nothing is
 * generated speculatively and then discarded.
 *
 * FRESHNESS IS CHECKED HERE, not only in the gate. The gate will refuse a quote
 * older than MC_MAX_QUOTE_AGE_MS anyway, so targeting a stale fixture would
 * spend a model call on a draft that cannot pass — which is exactly the failure
 * that made the previous pipeline promote 3 rows in 90 days.
 *
 * Scoped to VIP_PROXY_LEAGUE_IDS, the same top-12 competition set the VIP
 * calibration route uses, so the population this generates over is the one the
 * yield forecast was measured on.
 */
export async function selectVipPremiumTargets(
  now: Date = new Date(),
  limit = VIP_PREMIUM_DAILY_QUOTA,
  options: {
    warmOdds?: boolean;
    /**
     * VERIFICATION ONLY. Drops the top-12 league restriction so the generate ->
     * gate -> promote path can be exercised end to end on whatever is claimable
     * right now. Production always uses the default: a fixture stays PENDING a
     * median of 23 minutes before ordinary generation claims it, so an in-scope
     * candidate is often simply not available on demand.
     */
    anyLeague?: boolean;
  } = {},
): Promise<TargetSelection> {
  const { getCandidateOddsTargets } = await import("@/lib/enrichment");
  const candidates = await getCandidateOddsTargets(now);
  const empty: TargetSelection = {
    targets: [], considered: candidates.length, inScope: 0, freshlyPriced: 0, qualified: 0, warmed: 0,
  };
  if (candidates.length === 0) return empty;

  const ledger = await prisma.generationAttempt.findMany({
    where: { matchKey: { in: candidates.map((c) => c.matchKey) } },
    select: {
      matchKey: true, leagueApiId: true, homeTeam: true, awayTeam: true,
      kickoff: true, fixtureApiId: true, status: true,
    },
  });
  const metaByKey = new Map(ledger.map((l) => [l.matchKey, l]));

  /**
   * Only fixtures the worker can actually CLAIM.
   *
   * getCandidateOddsTargets deliberately includes SUCCEEDED rows, because the
   * odds workload wants to keep pricing a fixture after it has been generated.
   * Targeting must not: a fixture that already has predictions is not selected
   * by selectCandidates, so generating for it is impossible and every slot
   * spent on one is a slot wasted.
   *
   * This was not a theoretical concern. The first live run targeted six
   * fixtures, all SUCCEEDED, and the worker claimed ZERO — the pass had spent
   * its targeting on fixtures it could never generate for.
   *
   * The kickoff window is the selector's own, for the same reason: a fixture
   * outside GENERATE_FROM_HOURS..GENERATE_UNTIL_HOURS is not a candidate there
   * either, so it cannot be one here.
   */
  const fromMs = now.getTime() + GENERATE_FROM_HOURS * 3_600_000;
  const untilMs = now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000;
  const inScopeKeys = candidates
    .map((c) => c.matchKey)
    .filter((k) => {
      const meta = metaByKey.get(k);
      if (!meta?.fixtureApiId || meta.status !== "PENDING") return false;
      if (!options.anyLeague && !(VIP_PROXY_LEAGUE_IDS as readonly number[]).includes(meta.leagueApiId ?? -1)) return false;
      const ko = meta.kickoff.getTime();
      return ko >= fromMs && ko <= untilMs;
    });
  if (inScopeKeys.length === 0) return { ...empty, inScope: 0 };

  /**
   * Warm this pass's OWN candidates before reading the cache.
   *
   * Without this the pass silently cannot fire. Measured on a live run before
   * it existed: of 11 in-scope candidates — eight of them kicking off within
   * four hours — ZERO had ever been priced, and the entire FixtureOddsCache
   * held 0 rows fetched in the previous two hours. Targeting on "already
   * priced" is only meaningful if something has actually priced, and depending
   * on an external scheduler to have run the odds workload first is exactly the
   * kind of unstated ordering dependency that let the predecessor pass fail
   * quietly for 90 days.
   *
   * Uses refreshOddsCache, the same per-fixture function the cron's odds
   * workload calls, and selectStaleOddsTargets, so the failed-fetch back-off
   * still applies and fixtures the books never price are not re-requested every
   * run. Nearest kickoff first, because a book that has priced anything has
   * priced its soonest fixtures — though in practice every in-scope fixture in
   * the generation window came back priced on the first live run.
   *
   * Cost is one api-football call per warmed fixture, capped below — a rounding
   * error against the 7,500/day ceiling, and it replaces calls the odds
   * workload would otherwise have spent on the same fixtures anyway.
   */
  let warmed = 0;
  if (options.warmOdds) {
    const { selectStaleOddsTargets, refreshOddsCache } = await import("@/lib/enrichment");
    const inScopeSet = new Set(inScopeKeys);
    const mine = candidates
      .filter((c) => inScopeSet.has(c.matchKey))
      .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
    const due = (await selectStaleOddsTargets(mine, now)).slice(0, VIP_PREMIUM_ODDS_WARM_LIMIT);
    for (const t of due) {
      try {
        await refreshOddsCache(t);
        warmed++;
      } catch {
        // A fixture the provider will not price is not a failure of the pass.
        // refreshOddsCache records its own lastError/back-off; the target simply
        // does not qualify below.
      }
    }
  }

  const cached = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: inScopeKeys }, fetchedAt: { not: null } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true },
  });

  let freshlyPriced = 0;
  const qualified: VipPremiumTarget[] = [];
  for (const c of cached) {
    const quoteAgeMs = now.getTime() - c.fetchedAt!.getTime();
    if (quoteAgeMs > MC_MAX_QUOTE_AGE_MS) continue;
    freshlyPriced++;

    const best = lopsidednessSignal((c.oddsJson as unknown as FixtureOdds | null) ?? null);
    if (!best || best.probability < VIP_MARKET_FLOOR) continue;

    const meta = metaByKey.get(c.matchKey)!;
    qualified.push({
      matchKey: c.matchKey,
      fixtureApiId: meta.fixtureApiId!,
      leagueApiId: meta.leagueApiId,
      homeTeam: meta.homeTeam,
      awayTeam: meta.awayTeam,
      kickoff: meta.kickoff,
      marketProbability: best.probability,
      market: best.market,
      selection: best.value,
      bookmakers: best.bookmakers,
      quoteAgeMs,
    });
  }

  // Strongest market conviction first — unlike Bet of the Day, which ranks by
  // league priority, because here the market's own confidence IS the thing
  // being bought and a 91% leg in a mid-table fixture is a better paid-tier
  // candidate than a 76% one in a marquee tie. League rank breaks ties.
  qualified.sort(
    (a, b) =>
      b.marketProbability - a.marketProbability ||
      leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
      a.kickoff.getTime() - b.kickoff.getTime() ||
      a.matchKey.localeCompare(b.matchKey),
  );

  return {
    targets: qualified.slice(0, limit),
    considered: candidates.length,
    inScope: inScopeKeys.length,
    freshlyPriced,
    qualified: qualified.length,
    warmed,
  };
}

export type PaidTier = "VIP" | "PREMIUM";

export type GateOutcome = {
  predictionId: string;
  fixture: string;
  market: string;
  pick: string;
  tier?: PaidTier;
  verdict: MarketConfirmedVerdict;
};

export type GateRunResult = {
  evaluated: number;
  fixtures: number;
  promotedVip: GateOutcome[];
  promotedPremium: GateOutcome[];
  rejected: GateOutcome[];
  /** Passing selections dropped only because another on the same fixture ranked higher. */
  runnersUp: GateOutcome[];
};

/** PREMIUM is a strict subset: it also carries VIP, so the higher tier is never a narrower feed. */
export function categoriesForTier(tier: PaidTier): string[] {
  return tier === "PREMIUM" ? ["VIP", "PREMIUM"] : ["VIP"];
}

export function provenanceForTier(tier: PaidTier): string {
  return tier === "PREMIUM" ? PREMIUM_GENERATED_PROVENANCE : VIP_GENERATED_PROVENANCE;
}

/**
 * Applies the odds-agreement gate to drafts this pass produced, and promotes
 * each survivor to the tier its market probability earns.
 *
 * Runs AFTER generation rather than inside it, so the model is never told what
 * the market thinks — being shown the price would let it anchor to it, and the
 * agreement being measured would stop being independent. Targeting does not
 * break that: the model is handed a fixture, never a price.
 *
 * Only rows whose own AIJob carried this pass's intent are considered. An
 * ordinary prediction that happens to agree with the market is not a paid-tier
 * pick; it was not generated for that purpose and was never held to this bar.
 *
 * Nothing here publishes. Drafts land PENDING_REVIEW as every generated row
 * does, and reach the feeds through the same editorial review as the rest; this
 * stamps the provenance and the tags that make a reviewed row land in the right
 * tier and survive the next curation pass.
 */
export async function applyVipPremiumGate(options: { now?: Date; dryRun?: boolean } = {}): Promise<GateRunResult> {
  const now = options.now ?? new Date();

  const drafts = await prisma.prediction.findMany({
    where: {
      status: "PENDING_REVIEW",
      provenance: { notIn: [VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE] },
      kickoff: { gt: now },
      aiJobId: { not: null },
    },
    select: {
      id: true, marketType: true, selection: true, confidence: true, market: true, pick: true,
      homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
      aiJob: { select: { prompt: true } },
    },
  });

  const mine = drafts.filter((d) => d.aiJob && intentOf(d.aiJob.prompt) === VIP_PREMIUM_INTENT);

  // One odds read per fixture, not per draft: a multi-market job produces
  // several rows on one fixture and they all price against the same quote.
  const keys = [...new Set(mine.map((d) => matchKey(d)).filter((k): k is string => k !== null))];
  const cached = keys.length
    ? await prisma.fixtureOddsCache.findMany({
        where: { matchKey: { in: keys } },
        select: { matchKey: true, oddsJson: true, fetchedAt: true },
      })
    : [];
  const oddsByKey = new Map(cached.map((c) => [c.matchKey, c]));

  const promotedVip: GateOutcome[] = [];
  const promotedPremium: GateOutcome[] = [];
  const rejected: GateOutcome[] = [];
  const runnersUp: GateOutcome[] = [];

  const byFixture = new Map<string, typeof mine>();
  for (const d of mine) {
    const key = matchKey(d);
    if (!key) continue;
    if (!byFixture.has(key)) byFixture.set(key, []);
    byFixture.get(key)!.push(d);
  }

  for (const [key, group] of byFixture) {
    const entry = oddsByKey.get(key) ?? null;
    const odds = (entry?.oddsJson as unknown as FixtureOdds | null) ?? null;

    const scored = group.map((d) => ({
      id: d.id,
      row: d,
      verdict: evaluateMarketConfirmed({
        marketType: d.marketType,
        selection: d.selection as Selection,
        confidence: d.confidence,
        odds,
        fetchedAt: entry?.fetchedAt ?? null,
        now,
      }),
    }));

    const describe = (s: (typeof scored)[number], tier?: PaidTier): GateOutcome => ({
      predictionId: s.id,
      fixture: `${s.row.homeTeam} v ${s.row.awayTeam}`,
      market: s.row.market,
      pick: s.row.pick,
      tier,
      verdict: s.verdict,
    });

    for (const s of scored) if (!s.verdict.confirmed) rejected.push(describe(s));

    // At most ONE passing selection per fixture. Two picks on one match, both
    // sold as market-confirmed, would read as two independent confirmations of
    // the same thing.
    const passing = scored.filter((s) => s.verdict.confirmed).sort(compareMarketConfirmed);
    if (passing.length === 0) continue;

    const winner = passing[0];
    for (const s of passing.slice(1)) runnersUp.push(describe(s));

    const tier: PaidTier = (winner.verdict.marketProbability ?? 0) >= PREMIUM_MARKET_FLOOR ? "PREMIUM" : "VIP";

    if (!options.dryRun) {
      // Provenance and tags in ONE transaction: a row tagged VIP without the
      // marker is a pick curation is free to strip, which is precisely the
      // failure the provenance column exists to prevent.
      await prisma.$transaction(async (tx) => {
        await tx.prediction.update({
          where: { id: winner.id },
          data: {
            provenance: provenanceForTier(tier),
            // Frozen at promotion time — see the note on the column. The badge
            // reports what the market said when the pick was made, not now.
            marketConfirmation: {
              modelProbability: winner.verdict.modelProbability,
              marketProbability: winner.verdict.marketProbability,
              gapPP: winner.verdict.gapPP,
              bookmakers: winner.verdict.bookmakers,
              market: winner.verdict.market,
              value: winner.verdict.value,
              tier,
              quoteFetchedAt: entry?.fetchedAt?.toISOString() ?? null,
              confirmedAt: now.toISOString(),
            },
          },
        });
      });
      await setPredictionCategories(winner.id, categoriesForTier(tier));
    }

    (tier === "PREMIUM" ? promotedPremium : promotedVip).push(describe(winner, tier));
  }

  return { evaluated: mine.length, fixtures: byFixture.size, promotedVip, promotedPremium, rejected, runnersUp };
}

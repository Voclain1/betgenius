import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { matchKey } from "@/lib/slug";
import { setPredictionCategories } from "@/lib/predictions";
import type { FixtureOdds } from "@/lib/odds";
import type { Selection } from "@/lib/markets";
import {
  evaluateMarketConfirmed,
  compareMarketConfirmed,
  type MarketConfirmedVerdict,
} from "@/lib/marketConfirmed";
import { MARKET_CONFIRMED_PROVENANCE } from "@/lib/geniusCuration";

/**
 * The dedicated Market-Confirmed pass: quota, gate application, promotion.
 *
 * Additive by construction. It never replaces ordinary generation, never
 * changes what curation would otherwise pick, and adds nothing to a feed
 * except picks that passed the gate. A day on which nothing passes is a
 * normal, expected day, and the paid feeds look exactly as they do now.
 */

/** Label recorded on AIJob.prompt.intent — see GenerateFixtureInput.intent. */
export const MARKET_CONFIRMED_INTENT = "MARKET_CONFIRMED" as const;

/**
 * Dedicated generation attempts per day.
 *
 * Counted as ATTEMPTS, not as picks: a job whose pick then fails the odds gate
 * still spent an api-football budget, a model call and real money. Counting
 * survivors would let a bad day retry indefinitely.
 */
export const MARKET_CONFIRMED_DAILY_QUOTA = 8;

/** Both paid feeds show the identical picks — there is no Premium-only subset. */
export const MARKET_CONFIRMED_CATEGORIES = ["VIP", "PREMIUM"] as const;

function intentOf(promptJson: string): string | null {
  try {
    return JSON.parse(promptJson)?.intent ?? null;
  } catch {
    return null;
  }
}

export async function marketConfirmedGeneratedToday(now: Date = new Date()): Promise<number> {
  const { start, end } = lagosTodayBounds(now);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { prompt: true },
  });
  return jobs.filter((j) => intentOf(j.prompt) === MARKET_CONFIRMED_INTENT).length;
}

export async function marketConfirmedQuotaRemaining(now: Date = new Date()): Promise<number> {
  return Math.max(0, MARKET_CONFIRMED_DAILY_QUOTA - (await marketConfirmedGeneratedToday(now)));
}

export type GateOutcome = {
  predictionId: string;
  fixture: string;
  market: string;
  pick: string;
  verdict: MarketConfirmedVerdict;
};

export type GateRunResult = {
  evaluated: number;
  fixtures: number;
  promoted: GateOutcome[];
  rejected: GateOutcome[];
  /** Passing selections dropped only because another on the same fixture ranked higher. */
  runnersUp: GateOutcome[];
};

/**
 * Applies the odds-agreement gate to drafts the dedicated pass produced.
 *
 * Runs AFTER generation rather than inside it, so the model is never told what
 * the market thinks — being shown the price would let it anchor to it, and the
 * agreement the gate measures would stop being independent.
 *
 * Only rows whose own AIJob carried the Market-Confirmed intent are considered.
 * An ordinary prediction that happens to agree with the market is not a
 * Market-Confirmed pick; it was not generated for that purpose and was never
 * held to this bar.
 */
export async function applyMarketConfirmedGate(options: { now?: Date; dryRun?: boolean } = {}): Promise<GateRunResult> {
  const now = options.now ?? new Date();

  const drafts = await prisma.prediction.findMany({
    where: {
      status: "PENDING_REVIEW",
      provenance: { not: MARKET_CONFIRMED_PROVENANCE },
      kickoff: { gt: now },
      aiJobId: { not: null },
    },
    select: {
      id: true, marketType: true, selection: true, confidence: true, market: true, pick: true,
      homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
      aiJob: { select: { prompt: true } },
    },
  });

  const mine = drafts.filter((d) => d.aiJob && intentOf(d.aiJob.prompt) === MARKET_CONFIRMED_INTENT);

  // One odds read per fixture, not per draft: a multi-market job produces
  // several rows on one fixture and they all price against the same quote.
  const keys = [...new Set(mine.map((d) => matchKey(d)).filter((k): k is string => k !== null))];
  const cached = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: keys } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true },
  });
  const oddsByKey = new Map(cached.map((c) => [c.matchKey, c]));

  const promoted: GateOutcome[] = [];
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

    const describe = (s: (typeof scored)[number]): GateOutcome => ({
      predictionId: s.id,
      fixture: `${s.row.homeTeam} v ${s.row.awayTeam}`,
      market: s.row.market,
      pick: s.row.pick,
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

    if (!options.dryRun) {
      // Provenance and tags in ONE transaction: a row tagged VIP without the
      // marker is a pick curation is free to strip, which is precisely the
      // failure this column exists to prevent.
      await prisma.$transaction(async (tx) => {
        await tx.prediction.update({
          where: { id: winner.id },
          data: {
            provenance: MARKET_CONFIRMED_PROVENANCE,
            // Frozen at promotion time — see the note on the column. The badge
            // reports what the market said when the pick was made, not what it
            // says now.
            marketConfirmation: {
              modelProbability: winner.verdict.modelProbability,
              marketProbability: winner.verdict.marketProbability,
              gapPP: winner.verdict.gapPP,
              bookmakers: winner.verdict.bookmakers,
              market: winner.verdict.market,
              value: winner.verdict.value,
              quoteFetchedAt: entry?.fetchedAt?.toISOString() ?? null,
              confirmedAt: now.toISOString(),
            },
          },
        });
      });
      await setPredictionCategories(winner.id, [...MARKET_CONFIRMED_CATEGORIES]);
    }

    promoted.push(describe(winner));
  }

  return { evaluated: mine.length, fixtures: byFixture.size, promoted, rejected, runnersUp };
}

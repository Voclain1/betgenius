import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { compareByEditorialRank } from "@/lib/predictionOrdering";
import { matchKey } from "@/lib/slug";
import { qualifiesForBetOfDay, affordsBetOfDayPrice, MIN_ODDS, MAX_ODDS, type FixtureOdds, type OddsGateResult } from "@/lib/odds";
import { leaguePriorityRank } from "@/lib/leagues";

/**
 * Bet of the Day — the single pinned pick.
 *
 * Two rules govern this file, and everything else follows from them:
 *
 * 1. SINGLE SLOT. At most one prediction carries the BET_OF_THE_DAY tag at any
 *    moment. This cannot be a database constraint: PredictionCategoryLink's
 *    unique key is (predictionId, category), which prevents a duplicate tag on
 *    one row but has no way to express "one row across the whole table". So it
 *    is enforced transactionally here — every write deletes ALL existing tags
 *    before creating the new one, in one transaction, which also means a
 *    replaced pick is untagged as part of the same atomic step and can never
 *    reappear on its own.
 *
 * 2. A HUMAN PIN OUTRANKS THE CRON. Once an admin pins a pick for the current
 *    Lagos day, auto-selection stands down for that day. Without this the
 *    scheduled run would quietly revert a deliberate editorial choice minutes
 *    after it was made, which is the single worst failure this feature could
 *    have — the admin would have no way to tell their action had been undone.
 *
 * Note on the pattern: GENIUS/VIP/PREMIUM curation (src/lib/geniusCuration.ts)
 * has NO manual-override protection — curateCategory unconditionally removes
 * any tagged row the ranking did not select. This file does not mirror that;
 * it deliberately adds the protection those categories lack, because a
 * multi-row feed silently regaining a row is a much smaller harm than a
 * single-slot editorial pick being silently replaced.
 */

export const BET_OF_THE_DAY = "BET_OF_THE_DAY" as const;

export type BetOfTheDayRow = {
  id: string;
  homeTeam: string | null;
  awayTeam: string | null;
  leagueApiId: number | null;
  leagueName: string | null;
  kickoff: Date | null;
  market: string;
  pick: string;
  marketType: string;
  selection: unknown;
  confidence: number;
  reasoning: string;
  matchPreview: string | null;
  outcome: string;
  category: string;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  betOfDayPinnedAt: Date | null;
};

const ROW_SELECT = {
  id: true,
  homeTeam: true,
  awayTeam: true,
  leagueApiId: true,
  leagueName: true,
  kickoff: true,
  market: true,
  pick: true,
  marketType: true,
  selection: true,
  confidence: true,
  reasoning: true,
  matchPreview: true,
  outcome: true,
  category: true,
  homeTeamApiId: true,
  awayTeamApiId: true,
  betOfDayPinnedAt: true,
} as const;

export type BetOfTheDayView = {
  row: BetOfTheDayRow;
  /** Cached prices for the fixture, or null when the odds refresh hasn't landed. */
  odds: FixtureOdds | null;
  /** When those prices were fetched — drives the staleness stamp beside the price. */
  oddsFetchedAt: Date | null;
  /** The gate's verdict for this exact selection, so the UI can show the price it qualified on. */
  gate: OddsGateResult | null;
};

/** Read the cached odds for one prediction's fixture, by the same matchKey every other cache uses. */
export async function getOddsForPrediction(row: {
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date | null;
}): Promise<{ odds: FixtureOdds | null; fetchedAt: Date | null }> {
  const key = matchKey(row);
  if (!key) return { odds: null, fetchedAt: null };
  const cached = await prisma.fixtureOddsCache.findUnique({ where: { matchKey: key } });
  // Same fetchedAt contract as every other cache: a row with no fetchedAt is
  // "never successfully fetched", not "no odds exist".
  if (!cached?.fetchedAt) return { odds: null, fetchedAt: null };
  return { odds: (cached.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: cached.fetchedAt };
}

/**
 * The current Bet of the Day, with its price — or null when nothing is pinned.
 *
 * Not restricted to today's kickoff on read. The tag itself is the state, and
 * a pick whose kickoff has passed should keep showing (with its result) until
 * the next selection replaces it, rather than leaving a hole on the homepage
 * between kickoff and the next cron cycle.
 */
export const getBetOfTheDay = cache(async (): Promise<BetOfTheDayView | null> => {
  const row = await prisma.prediction.findFirst({
    where: { status: "PUBLISHED", categories: { some: { category: BET_OF_THE_DAY } } },
    select: ROW_SELECT,
  });
  if (!row) return null;

  const { odds, fetchedAt } = await getOddsForPrediction(row);
  const gate = qualifiesForBetOfDay({ odds, marketType: row.marketType, selection: row.selection, confidence: row.confidence });
  return { row, odds, oddsFetchedAt: fetchedAt, gate };
});

/**
 * Move the tag to `predictionId`, atomically.
 *
 * The delete is unscoped by design — it removes the tag from every row, not
 * just from the one we believe currently holds it. If anything ever did leave
 * two rows tagged (a partial write, a manual database edit), a scoped delete
 * would preserve the corruption; this repairs it on the next pin.
 *
 * `pinnedById` set = a human pinned it, which engages the same-day protection
 * in autoSelectBetOfTheDay. The cron passes null, so an automatic selection
 * never claims to be an editorial decision.
 */
export async function setBetOfTheDay(predictionId: string, pinnedById: string | null, now: Date = new Date()) {
  const [, , updated] = await prisma.$transaction([
    prisma.predictionCategoryLink.deleteMany({ where: { category: BET_OF_THE_DAY } }),
    // Clearing the pin metadata everywhere, not just on the outgoing pick,
    // keeps a stale pin from suppressing tomorrow's auto-selection.
    prisma.prediction.updateMany({
      where: { betOfDayPinnedAt: { not: null } },
      data: { betOfDayPinnedAt: null, betOfDayPinnedById: null },
    }),
    prisma.prediction.update({
      where: { id: predictionId },
      data: {
        categories: { create: { category: BET_OF_THE_DAY } },
        ...(pinnedById ? { betOfDayPinnedAt: now, betOfDayPinnedById: pinnedById } : {}),
      },
      select: ROW_SELECT,
    }),
  ]);
  return updated;
}

/** True when an admin has pinned a pick during the current Lagos day. */
export async function hasManualPinToday(now: Date = new Date()): Promise<boolean> {
  const { start, end } = lagosTodayBounds(now);
  const pinned = await prisma.prediction.findFirst({
    where: {
      betOfDayPinnedAt: { gte: start, lt: end },
      categories: { some: { category: BET_OF_THE_DAY } },
    },
    select: { id: true },
  });
  return pinned !== null;
}

export type Candidate = {
  id: string;
  homeTeam: string | null;
  awayTeam: string | null;
  leagueApiId: number | null;
  confidence: number;
  market: string;
  pick: string;
  kickoff: Date | null;
  gate: OddsGateResult;
};

/**
 * Everything eligible for the slot today, strongest first.
 *
 * The pool is today's published picks that have not yet kicked off and that
 * clear the odds gate; ranking is compareByEditorialRank — the same league-
 * priority-then-confidence order curation and every display list already use,
 * so Bet of the Day is the top of the ordering the site already shows rather
 * than a fourth opinion about what "best" means.
 *
 * Returns rejected candidates too (with their reasons) so the admin panel and
 * the verification script can explain why a pick did not qualify.
 */
export async function getBetOfTheDayCandidates(now: Date = new Date()): Promise<{ eligible: Candidate[]; rejected: Candidate[] }> {
  const { start, end } = lagosTodayBounds(now);
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      outcome: "PENDING",
      kickoff: { gte: now, lt: end },
      // `start` still bounds the query below via the kickoff filter above; the
      // lower bound is `now` because a pick whose kickoff has passed cannot be
      // tipped, even though it is still part of today.
    },
    select: {
      id: true,
      homeTeam: true,
      awayTeam: true,
      leagueApiId: true,
      confidence: true,
      market: true,
      pick: true,
      marketType: true,
      selection: true,
      kickoff: true,
      homeTeamApiId: true,
      awayTeamApiId: true,
    },
  });
  void start;

  // One query for every fixture's odds rather than one per candidate.
  const keyByRow = new Map(rows.map((r) => [r.id, matchKey(r)]));
  const keys = [...new Set([...keyByRow.values()].filter((k): k is string => !!k))];
  const cached = keys.length
    ? await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys }, fetchedAt: { not: null } } })
    : [];
  const oddsByKey = new Map(cached.map((c) => [c.matchKey, (c.oddsJson as unknown as FixtureOdds | null) ?? null]));

  const eligible: Candidate[] = [];
  const rejected: Candidate[] = [];

  for (const r of rows) {
    const key = keyByRow.get(r.id);
    const odds = key ? (oddsByKey.get(key) ?? null) : null;
    const gate = qualifiesForBetOfDay({ odds, marketType: r.marketType, selection: r.selection, confidence: r.confidence });
    const candidate: Candidate = {
      id: r.id,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      leagueApiId: r.leagueApiId,
      confidence: r.confidence,
      market: r.market,
      pick: r.pick,
      kickoff: r.kickoff,
      gate,
    };
    (gate.qualifies ? eligible : rejected).push(candidate);
  }

  eligible.sort(compareByEditorialRank);
  rejected.sort(compareByEditorialRank);
  return { eligible, rejected };
}

export type AutoSelectResult = {
  action: "pinned" | "kept" | "skipped-manual-pin" | "no-eligible-candidate";
  selectedId: string | null;
  consideredEligible: number;
  consideredRejected: number;
  detail?: string;
};

/**
 * The scheduled selection.
 *
 * Stands down entirely when an admin has pinned a pick today — rule 2 above.
 * Note it does NOT re-pin when the current tag already sits on the top-ranked
 * candidate: rewriting the same tag would churn the row's updatedAt for no
 * reason, and "kept" is a more honest thing to report than a no-op "pinned".
 */
export async function autoSelectBetOfTheDay(now: Date = new Date()): Promise<AutoSelectResult> {
  if (await hasManualPinToday(now)) {
    return { action: "skipped-manual-pin", selectedId: null, consideredEligible: 0, consideredRejected: 0, detail: "an admin pinned today's Bet of the Day; auto-selection stands down" };
  }

  const { eligible, rejected } = await getBetOfTheDayCandidates(now);
  if (eligible.length === 0) {
    return {
      action: "no-eligible-candidate",
      selectedId: null,
      consideredEligible: 0,
      consideredRejected: rejected.length,
      detail: "no published pick cleared the odds gate — the slot keeps whatever it held",
    };
  }

  const winner = eligible[0];
  const current = await prisma.prediction.findFirst({
    where: { categories: { some: { category: BET_OF_THE_DAY } } },
    select: { id: true },
  });
  if (current?.id === winner.id) {
    return { action: "kept", selectedId: winner.id, consideredEligible: eligible.length, consideredRejected: rejected.length };
  }

  await setBetOfTheDay(winner.id, null, now);
  return { action: "pinned", selectedId: winner.id, consideredEligible: eligible.length, consideredRejected: rejected.length };
}


/**
 * The daily cap on bolder-path generation.
 *
 * Deliberately small, and deliberately not raised on a schedule. Nothing is
 * yet known about how the BANKER/uncalibrated prompt path calibrates, because
 * it had never run in production before this feature existed (verified from
 * AIJob.prompt: every prior scheduled job used FEATURED intent). Until settled
 * BET_OF_THE_DAY picks show confidence is not systematically overconfident
 * against outcomes, generating more of them just produces more unmeasured
 * output. See BET_OF_DAY_MIN_CALIBRATION_SAMPLE and the calibration panel on
 * /admin/generation.
 */
export const BET_OF_DAY_DAILY_QUOTA = 4;

/**
 * Minimum settled picks before the quota above may be raised.
 *
 * 30 is the smallest sample at which a systematic bias is distinguishable from
 * noise here. At a true 60% strike rate the standard error on 30 settled picks
 * is ~8.9pp, so a gap of ~18pp or more between mean confidence and actual
 * strike rate is outside two standard errors — detectable. Below ~30, an
 * overconfident model and an unlucky fortnight look identical, and the whole
 * point of the gate is to tell those apart.
 *
 * This is the floor for LOOKING, not a pass mark. The gate is the calibration
 * result, not the sample size.
 */
export const BET_OF_DAY_MIN_CALIBRATION_SAMPLE = 30;

export type GenerationTarget = {
  matchKey: string;
  fixtureApiId: number;
  leagueApiId: number | null;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  /** The in-band price that made this fixture worth a bolder pick. */
  price: number;
  market: string;
  selection: string;
  bookmakers: number;
};

/**
 * Which un-generated fixtures deserve a bolder pick today — price first.
 *
 * The ordering is the site-wide one (league priority, then soonest kickoff),
 * applied to the set of fixtures whose market ALREADY affords a Bet of the Day
 * price. That inversion is the point: rather than generating bolder picks
 * broadly and discarding those that miss the 2.20-4.50 band, only fixtures the
 * market has already priced into the band are generated at all.
 *
 * Returns at most `limit` targets, and never re-targets a fixture that already
 * has predictions — that exclusion lives in the generation queue, but is
 * repeated here so the reported targets match what generation will actually do.
 */
export async function selectBetOfTheDayTargets(now: Date = new Date(), limit = BET_OF_DAY_DAILY_QUOTA): Promise<{ targets: GenerationTarget[]; considered: number; pricedInBand: number }> {
  const { getCandidateOddsTargets } = await import("@/lib/enrichment");
  const candidates = await getCandidateOddsTargets(now);
  if (candidates.length === 0) return { targets: [], considered: 0, pricedInBand: 0 };

  const cached = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: candidates.map((c) => c.matchKey) }, fetchedAt: { not: null } },
    select: { matchKey: true, oddsJson: true },
  });
  const oddsByKey = new Map(cached.map((c) => [c.matchKey, (c.oddsJson as unknown as FixtureOdds | null) ?? null]));

  const ledger = await prisma.generationAttempt.findMany({
    where: { matchKey: { in: candidates.map((c) => c.matchKey) } },
    select: { matchKey: true, leagueApiId: true, homeTeam: true, awayTeam: true, kickoff: true, fixtureApiId: true },
  });
  const metaByKey = new Map(ledger.map((l) => [l.matchKey, l]));

  const inBand: GenerationTarget[] = [];
  for (const c of candidates) {
    const meta = metaByKey.get(c.matchKey);
    if (!meta?.fixtureApiId) continue;
    const { affords, best, market } = affordsBetOfDayPrice(oddsByKey.get(c.matchKey) ?? null);
    if (!affords || !best || !market) continue;
    inBand.push({
      matchKey: c.matchKey,
      fixtureApiId: meta.fixtureApiId,
      leagueApiId: meta.leagueApiId,
      homeTeam: meta.homeTeam,
      awayTeam: meta.awayTeam,
      kickoff: meta.kickoff,
      price: best.best,
      market,
      selection: best.value,
      bookmakers: best.bookmakers,
    });
  }

  inBand.sort(
    (a, b) =>
      leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
      a.kickoff.getTime() - b.kickoff.getTime() ||
      a.matchKey.localeCompare(b.matchKey),
  );

  return { targets: inBand.slice(0, limit), considered: candidates.length, pricedInBand: inBand.length };
}

/**
 * How many bolder-path fixtures have already been generated during the current
 * Lagos day — what enforces the daily quota across separate scheduler pokes.
 *
 * Counted from AIJob.prompt (the literal generation input), not from the
 * category tags on the resulting predictions: a tag can be added or removed by
 * an admin afterwards, whereas the recorded prompt is what the model was
 * actually asked for. That distinction is exactly what proved BANKER intent had
 * never run before this feature existed.
 */
export async function betOfTheDayGeneratedToday(now: Date = new Date()): Promise<number> {
  const { start, end } = lagosTodayBounds(now);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { prompt: true },
  });
  return jobs.filter((j) => {
    try {
      return (JSON.parse(j.prompt)?.categories ?? []).includes(BET_OF_THE_DAY);
    } catch {
      return false;
    }
  }).length;
}

/** Remaining bolder-path generations allowed today. */
export async function betOfTheDayQuotaRemaining(now: Date = new Date()): Promise<number> {
  return Math.max(0, BET_OF_DAY_DAILY_QUOTA - (await betOfTheDayGeneratedToday(now)));
}

export const BET_OF_DAY_PRICE_BAND = { min: MIN_ODDS, max: MAX_ODDS };

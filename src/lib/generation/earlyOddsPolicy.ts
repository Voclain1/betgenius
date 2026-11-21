/**
 * Early FREE publication prices have a lead-time-dependent freshness/depth
 * policy. Does not alter paid tiers, Bet of the Day, or the 2h match-page clock.
 * The provider's own update timestamp, not our fetch time, establishes age.
 */
import { AUTO_MIN_MEDIAN_ODDS } from "@/lib/autoOddsFloor";
import { findSelection, toBookmakerSelection, type FixtureOdds } from "@/lib/odds";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const EARLY_ODDS_MAX_HORIZON_DAYS = 14;

export function earlyOddsBand(kickoff: Date, now: Date): {
  maxQuoteAgeMs: number; refreshAfterMs: number; retryAfterMs: number; minBooks: number;
} {
  const lead = kickoff.getTime() - now.getTime();
  if (lead > 7 * DAY) return { maxQuoteAgeMs: 24 * HOUR, refreshAfterMs: 8 * HOUR, retryAfterMs: 8 * HOUR, minBooks: 3 };
  if (lead > 3 * DAY) return { maxQuoteAgeMs: 12 * HOUR, refreshAfterMs: 4 * HOUR, retryAfterMs: 4 * HOUR, minBooks: 4 };
  return { maxQuoteAgeMs: 6 * HOUR, refreshAfterMs: 2 * HOUR, retryAfterMs: 2 * HOUR, minBooks: 5 };
}

export type EarlyQuote = {
  median: number; best: number; bookmakers: number; market: string; value: string;
  providerAt: Date; fetchedAt: Date; bestBookmaker: string;
};
export type EarlyQuoteResult =
  | { ok: true; quote: EarlyQuote }
  | { ok: false; reason: "missing-odds" | "unpriced-market" | "unpriced-selection" | "stale-odds" |
    "insufficient-bookmakers" | "below-minimum-odds" | "invalid-odds" };

/**
 * Price the EXACT selection, never the fixture's shortest or highest price.
 * During reassessment, allowBelowFloor lets a downward move be detected and
 * reviewed rather than invisibly treating the new quote as unavailable.
 */
export function earlyQuotedSelection(input: {
  odds: FixtureOdds | null; fetchedAt: Date | null; kickoff: Date; now: Date;
  marketType: string; selection: unknown; allowBelowFloor?: boolean;
}): EarlyQuoteResult {
  const { odds, fetchedAt, kickoff, now } = input;
  const lead = kickoff.getTime() - now.getTime();
  if (!odds || !fetchedAt) return { ok: false, reason: "missing-odds" };
  if (!(lead > 0 && lead <= EARLY_ODDS_MAX_HORIZON_DAYS * DAY))
    return { ok: false, reason: "stale-odds" };
  const mapped = toBookmakerSelection(input.marketType, input.selection);
  if (!mapped) return { ok: false, reason: "unpriced-market" };
  const selection = findSelection(odds, mapped.market, mapped.value);
  if (!selection) return { ok: false, reason: "unpriced-selection" };
  const providerAt = odds.update ? new Date(odds.update) : null;
  if (!providerAt || !Number.isFinite(providerAt.getTime()) ||
      providerAt.getTime() > now.getTime() ||
      providerAt.getTime() > kickoff.getTime() ||
      !Number.isFinite(fetchedAt.getTime()) || fetchedAt.getTime() > now.getTime() ||
      fetchedAt.getTime() < providerAt.getTime() - 5 * 60_000 ||
      now.getTime() - providerAt.getTime() > earlyOddsBand(kickoff, now).maxQuoteAgeMs)
    return { ok: false, reason: "stale-odds" };
  if (!Number.isFinite(selection.median) || !Number.isFinite(selection.best) ||
      selection.median <= 1 || selection.best <= 1)
    return { ok: false, reason: "invalid-odds" };
  if (selection.bookmakers < earlyOddsBand(kickoff, now).minBooks)
    return { ok: false, reason: "insufficient-bookmakers" };
  if (!input.allowBelowFloor && selection.median < AUTO_MIN_MEDIAN_ODDS)
    return { ok: false, reason: "below-minimum-odds" };
  return { ok: true, quote: {
    median: selection.median, best: selection.best, bookmakers: selection.bookmakers,
    market: mapped.market, value: mapped.value, providerAt, fetchedAt,
    bestBookmaker: selection.bestBookmaker,
  } };
}

/**
 * The generator should not spend inference on an unpriced early fixture. The
 * bookmaker market must already have opened and have at least one usable
 * above-floor exact line; publication rechecks the specific generated pick.
 */
export function earlyFixturePricedForGeneration(input: {
  odds: FixtureOdds | null; fetchedAt: Date | null; kickoff: Date; now: Date;
}): boolean {
  const { odds, fetchedAt, kickoff, now } = input;
  if (!odds?.update || !fetchedAt) return false;
  const providerAt = new Date(odds.update);
  const lead = kickoff.getTime() - now.getTime();
  if (!Number.isFinite(providerAt.getTime()) || providerAt > now ||
      providerAt > kickoff || fetchedAt > now ||
      fetchedAt.getTime() < providerAt.getTime() - 5 * 60_000 ||
      lead <= 48 * HOUR || lead > EARLY_ODDS_MAX_HORIZON_DAYS * DAY ||
      now.getTime() - providerAt.getTime() > earlyOddsBand(kickoff, now).maxQuoteAgeMs)
    return false;
  const minBooks = earlyOddsBand(kickoff, now).minBooks;
  return odds.markets.some(m =>
    ["Match Winner", "Double Chance", "Goals Over/Under", "Both Teams Score"].includes(m.market) &&
    m.selections.some(v => v.bookmakers >= minBooks &&
      Number.isFinite(v.median) && v.median >= AUTO_MIN_MEDIAN_ODDS));
}

export function earlyOddsRefreshDue(input: {
  kickoff: Date; now: Date; fetchedAt: Date | null; lastAttemptAt: Date | null;
}): boolean {
  const { kickoff, now, fetchedAt, lastAttemptAt } = input;
  const lead = kickoff.getTime() - now.getTime();
  if (lead <= 48 * HOUR || lead > EARLY_ODDS_MAX_HORIZON_DAYS * DAY) return false;
  const band = earlyOddsBand(kickoff, now);
  if (!fetchedAt) return !lastAttemptAt || now.getTime() - lastAttemptAt.getTime() >= band.retryAfterMs;
  return now.getTime() - fetchedAt.getTime() >= band.refreshAfterMs;
}

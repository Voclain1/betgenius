import { prisma } from "@/lib/prisma";
import type { PredictionCategory } from "@/lib/enums";
import { categoryFeedWhere } from "@/lib/categoryPredictions";
import { lagosDateKey } from "@/lib/lagosDate";
import { FEED_RESULTS_MAX_DAYS_BACK, shiftDayKey, type DayResult } from "@/lib/feedResultsDays";

export { FEED_RESULTS_MAX_DAYS_BACK, FEED_RESULTS_PAGE_DAYS, resultsDayLabel, shiftDayKey, type DayResult } from "@/lib/feedResultsDays";

/**
 * Past-days results at the foot of the VIP, Premium and Banker pages.
 *
 * LIGHT BY CONSTRUCTION. The page itself does no work for this section: it
 * renders a list of past calendar days (a week at a time, "Show more days"
 * for the next week) with nothing inside them. Only when a reader opens a day
 * is that one day's results read, by /api/predictions/results, which returns
 * at most a feed's worth of rows for a single Lagos day. History therefore
 * costs nothing until someone asks for a specific day, however long the
 * record grows.
 *
 * SAME LOCK AS THE FEED. VIP and PREMIUM results are for members only
 * (MEMBERS_ONLY_RESULTS): a reader who cannot view the tier gets no rows at
 * all, as the feed's own tabs show them a subscribe cover. BANKER keeps its
 * public record: match and result, never the pick. The route applies these
 * rules; nothing here decides access.
 */

export const FEED_RESULTS_CATEGORIES: readonly PredictionCategory[] = ["VIP", "PREMIUM", "BANKER"];

/** Feeds whose past results, matches included, only their members may read. */
export const MEMBERS_ONLY_RESULTS: readonly PredictionCategory[] = ["VIP", "PREMIUM"];
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const LAGOS_OFFSET = "+01:00";

/** Yesterday in Lagos: the first day the section lists. */
export function firstResultsDay(now: Date = new Date()): string {
  return shiftDayKey(lagosDateKey(now), -1);
}

/**
 * The Lagos-day bounds for a requested key, or null when the key is not a
 * past day inside the paging limit. Today and the future are refused: today's
 * picks are on the feed itself, and a future day has no results.
 */
export function resultsDayBounds(key: string | null | undefined, now: Date = new Date()): { start: Date; end: Date } | null {
  if (!key || !DAY_KEY.test(key)) return null;
  const start = new Date(`${key}T00:00:00${LAGOS_OFFSET}`);
  if (Number.isNaN(start.getTime()) || lagosDateKey(start) !== key) return null;
  const today = lagosDateKey(now);
  if (key >= today || key < shiftDayKey(today, -FEED_RESULTS_MAX_DAYS_BACK)) return null;
  return { start, end: new Date(start.getTime() + 24 * 3_600_000) };
}

/** Shape a day's rows for one reader. The only place the lock is applied. */
export function shapeDayResults(
  rows: ReadonlyArray<{
    id: string;
    homeTeam: string | null;
    awayTeam: string | null;
    homeTeamApiId?: number | null;
    awayTeamApiId?: number | null;
    kickoff: Date | null;
    market: string;
    pick: string;
    outcome: string;
  }>,
  canView: boolean,
): DayResult[] {
  return rows.map((r) => ({
    id: r.id,
    homeTeam: r.homeTeam,
    awayTeam: r.awayTeam,
    homeTeamApiId: r.homeTeamApiId ?? null,
    awayTeamApiId: r.awayTeamApiId ?? null,
    kickoff: r.kickoff?.toISOString() ?? null,
    market: r.market,
    pick: canView ? r.pick : null,
    outcome: r.outcome,
  }));
}

/** One Lagos day of a feed: the same rows the feed showed that day, minimal fields. */
export async function getFeedDayResults(category: PredictionCategory, bounds: { start: Date; end: Date }) {
  return prisma.prediction.findMany({
    where: { ...categoryFeedWhere(category), kickoff: { gte: bounds.start, lt: bounds.end } },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    select: { id: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, market: true, pick: true, outcome: true },
    take: 60,
  });
}

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { PredictionCategory } from "@/lib/enums";
import { lagosDayBounds } from "@/lib/lagosDate";
import { orderForDisplay } from "@/lib/predictionOrdering";

// Shared between /predictions/[category] and the account dashboard so the
// two never end up running two slightly different queries for the same
// "published predictions in category X" data.

export const CATEGORY_SLUGS: Record<string, PredictionCategory> = {
  featured: "FEATURED",
  genius: "GENIUS",
  today: "TODAY",
  banker: "BANKER",
  vip: "VIP",
  premium: "PREMIUM",
  "bet-of-the-day": "BET_OF_THE_DAY",
  // Display-layer rename only: the enum, the DB column values and every
  // stored PredictionCategoryTag row still say SAME_GAME_DOUBLE. See
  // next.config.mjs for the redirect from the old slug.
  "combo-bets": "SAME_GAME_DOUBLE",
};

export const CATEGORY_NAMES: Record<PredictionCategory, string> = {
  FEATURED: "Featured tips",
  GENIUS: "Genius tips",
  TODAY: "Today's predictions",
  BANKER: "Banker",
  VIP: "VIP tips",
  PREMIUM: "Premium tips",
  BET_OF_THE_DAY: "Bet of the Day",
  SAME_GAME_DOUBLE: "Combo Bets",
};

/**
 * One line saying what each feed IS, in the reader's terms.
 *
 * Lifted verbatim from the /predictions index, which is where this copy has
 * always lived, so the index card and the feed's own answer paragraph (see
 * src/lib/answerSummary.ts) describe a category identically instead of in two
 * separately-invented voices. Editing one place changes both.
 */
export const CATEGORY_BLURBS: Record<PredictionCategory, string> = {
  FEATURED: "Editor-picked, highest-conviction plays.",
  GENIUS: "Our highest-scoring picks of the day, ranked by confidence.",
  TODAY: "Every match happening today.",
  BANKER: "Our single most-confident pick.",
  VIP: "Subscriber-only edge plays.",
  PREMIUM: "Top-tier tips + accumulators.",
  BET_OF_THE_DAY: "A single pick each day, taken from everything published that morning.",
  SAME_GAME_DOUBLE: "Two picks on the same match, combined into one selection.",
};

/**
 * Short labels for the chip on a prediction card and the dashboard tiles.
 *
 * The card used to print the raw enum, so a combo card was badged
 * "SAME_GAME_DOUBLE" and the daily pick "BET_OF_THE_DAY". CATEGORY_NAMES is
 * too long for a chip ("Featured tips"), so these are the short forms.
 */
export const CATEGORY_CHIP_LABELS: Record<PredictionCategory, string> = {
  FEATURED: "Featured",
  GENIUS: "Genius",
  TODAY: "Today",
  BANKER: "Banker",
  VIP: "VIP",
  PREMIUM: "Premium",
  BET_OF_THE_DAY: "Bet of the Day",
  SAME_GAME_DOUBLE: "Combo Bet",
};

/** Chip text for a category string that came from the database. */
export function categoryChipLabel(category: string): string {
  return CATEGORY_CHIP_LABELS[category as PredictionCategory] ?? category;
}

export const CATEGORY_TO_SLUG = Object.fromEntries(
  Object.entries(CATEGORY_SLUGS).map(([slug, cat]) => [cat, slug]),
) as Record<PredictionCategory, string>;

/**
 * The three days a category feed can be browsed on.
 *
 * Deliberately three fixed options rather than a calendar. Each is one scoped
 * query against the same indexed kickoff range the page already ran, so the
 * cost profile does not change. Open-ended history is a different feature —
 * it needs paging and a story for old data — and is not bundled here.
 */
export const FEED_DAYS = ["yesterday", "today", "tomorrow"] as const;
export type FeedDay = (typeof FEED_DAYS)[number];

const DAY_OFFSETS: Record<FeedDay, number> = { yesterday: -1, today: 0, tomorrow: 1 };

/** Anything unrecognised (or absent) resolves to today, so a junk param cannot 404. */
export function parseFeedDay(value: string | string[] | undefined): FeedDay {
  const raw = Array.isArray(value) ? value[0] : value;
  return (FEED_DAYS as readonly string[]).includes(raw ?? "") ? (raw as FeedDay) : "today";
}

/** Only yesterday is settled enough to carry outcomes; today matches its current behaviour. */
export function dayShowsOutcomes(day: FeedDay): boolean {
  return day === "yesterday";
}

/**
 * The URL for a day on any surface that supports the switch, keeping "today" as
 * the bare path so the default view has one canonical URL rather than two that
 * render identically.
 */
export function dayHref(basePath: string, day: FeedDay): string {
  return day === "today" ? basePath : `${basePath}?date=${day}`;
}

/** Category-feed convenience wrapper over dayHref. */
export function feedDayHref(slug: string, day: FeedDay): string {
  return dayHref(`/predictions/${slug}`, day);
}

// Shared between generateMetadata and the page body on /predictions/[category]
// (and now the dashboard) so a given category's predictions are only fetched
// once per request — React's cache() memoizes by arguments within a render pass.
// The day argument is part of the cache key, so callers MUST pass the same
// value the page resolved — generateMetadata and the body both pass it
// explicitly. Calling this once with and once without the argument would be
// two keys and therefore two queries for the same rows.
export const getCategoryPredictions = cache(async (cat: PredictionCategory, day: FeedDay = "today") => {
  const today = lagosDayBounds(DAY_OFFSETS[day]);
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      kickoff: { gte: today.start, lt: today.end },
      // TODAY ignores category tags. Include the assembled double as part of
      // the regular mix, but continue excluding its internally tagged source
      // legs so one fixture never appears as three loose public picks.
      ...(cat === "TODAY"
        ? {
            OR: [
              { categories: { none: { category: "SAME_GAME_DOUBLE" } } },
              { marketType: "SAME_GAME_DOUBLE" },
            ],
          }
        : { categories: { some: { category: cat } } }),
      // The Doubles feed shows assembled DOUBLES, not the legs they are built
      // from. A multi-market generation tags its source rows SAME_GAME_DOUBLE
      // so they stay out of every other feed, which would otherwise make them
      // surface here as two loose single-market picks sitting beside the double
      // that already quotes them both.
      ...(cat === "SAME_GAME_DOUBLE" ? { marketType: "SAME_GAME_DOUBLE" } : {}),
    },
    // Deterministic, but not the order the page renders in — the ranking in
    // orderForDisplay decides that. This clause exists so the `take` below
    // always cuts the same 60 rows out of a larger day, rather than letting an
    // unordered query decide which ones the ranking never gets to see.
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
    take: 60,
  });
  return orderForDisplay(rows);
});

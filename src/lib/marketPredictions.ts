import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { lagosDayBounds } from "@/lib/lagosDate";
import { orderForDisplay } from "@/lib/predictionOrdering";
import type { FeedDay } from "@/lib/categoryPredictions";
import type { Prisma } from "@prisma/client";
import { NOT_PAID_ONLY } from "@/lib/paidOnly";
import { MARKET_HUB_EXCLUDED_CATEGORIES } from "@/lib/marketHubs";

const DAY_OFFSETS: Record<FeedDay, number> = { yesterday: -1, today: 0, tomorrow: 1 };

/**
 * Every market page lists free-tier tips only: no VIP or Premium tag, primary
 * or linked, and none of the dedicated paid-pass rows (src/lib/marketHubs.ts).
 */
const FREE_TIERS_ONLY: Prisma.PredictionWhereInput = {
  ...NOT_PAID_ONLY,
  category: { notIn: [...MARKET_HUB_EXCLUDED_CATEGORIES] },
  categories: { none: { category: { in: [...MARKET_HUB_EXCLUDED_CATEGORIES] } } },
};

/** One bounded read for the exact Over 2.5 Goals selection shown by the hub. */
export const getOver25Predictions = cache(async (day: FeedDay = "today") => {
  const bounds = lagosDayBounds(DAY_OFFSETS[day]);
  const rows = await prisma.prediction.findMany({
    where: {
      ...FREE_TIERS_ONLY,
      status: "PUBLISHED",
      kickoff: { gte: bounds.start, lt: bounds.end },
      marketType: "OVER_UNDER",
      AND: [
        { selection: { path: ["line"], equals: 2.5 } },
        { selection: { path: ["direction"], equals: "OVER" } },
      ],
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: {
      categories: true,
      fixture: { include: { homeTeam: true, awayTeam: true, league: true } },
    },
    take: 60,
  });
  return orderForDisplay(rows);
});

/** One bounded read for all Both Teams to Score selections, Yes and No. */
export const getBttsPredictions = cache(async (day: FeedDay = "today") => {
  const bounds = lagosDayBounds(DAY_OFFSETS[day]);
  const rows = await prisma.prediction.findMany({
    where: {
      ...FREE_TIERS_ONLY,
      status: "PUBLISHED",
      kickoff: { gte: bounds.start, lt: bounds.end },
      marketType: "BTTS",
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: {
      categories: true,
      fixture: { include: { homeTeam: true, awayTeam: true, league: true } },
    },
    take: 60,
  });
  return orderForDisplay(rows);
});

/** One bounded read for all three structured Double Chance selections. */
export const getDoubleChancePredictions = cache(async (day: FeedDay = "today") => {
  const bounds = lagosDayBounds(DAY_OFFSETS[day]);
  const rows = await prisma.prediction.findMany({
    where: {
      ...FREE_TIERS_ONLY,
      status: "PUBLISHED",
      kickoff: { gte: bounds.start, lt: bounds.end },
      marketType: "DOUBLE_CHANCE",
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: {
      categories: true,
      fixture: { include: { homeTeam: true, awayTeam: true, league: true } },
    },
    take: 60,
  });
  return orderForDisplay(rows);
});

/** One bounded read for straight wins: a home or away win, never a draw. */
export const getStraightWinPredictions = cache(async (day: FeedDay = "today") => {
  const bounds = lagosDayBounds(DAY_OFFSETS[day]);
  const rows = await prisma.prediction.findMany({
    where: {
      ...FREE_TIERS_ONLY,
      status: "PUBLISHED",
      kickoff: { gte: bounds.start, lt: bounds.end },
      marketType: "MATCH_WINNER",
      OR: [
        { selection: { path: ["value"], equals: "HOME" } },
        { selection: { path: ["value"], equals: "AWAY" } },
      ],
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: {
      categories: true,
      fixture: { include: { homeTeam: true, awayTeam: true, league: true } },
    },
    take: 60,
  });
  return orderForDisplay(rows);
});

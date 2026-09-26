import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { lagosDayBounds } from "@/lib/lagosDate";
import { orderForDisplay } from "@/lib/predictionOrdering";
import type { FeedDay } from "@/lib/categoryPredictions";

const DAY_OFFSETS: Record<FeedDay, number> = { yesterday: -1, today: 0, tomorrow: 1 };

/** One bounded read for the exact Over 2.5 Goals selection shown by the hub. */
export const getOver25Predictions = cache(async (day: FeedDay = "today") => {
  const bounds = lagosDayBounds(DAY_OFFSETS[day]);
  const rows = await prisma.prediction.findMany({
    where: {
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

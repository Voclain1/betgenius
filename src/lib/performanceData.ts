import { prisma } from "./prisma";
import { discoveryAccessWhere } from "./predictionVisibility";
import type { Entitlement } from "./entitlement";
import {
  PERFORMANCE_CAP,
  performanceBounds,
  type PerformanceFilter,
  type PerformanceRow,
} from "./performanceTransparency";
export const PERFORMANCE_SELECT = {
  id: true,
  fixtureApiId: true,
  fixtureId: true,
  homeTeam: true,
  awayTeam: true,
  leagueName: true,
  leagueApiId: true,
  kickoff: true,
  publishedAt: true,
  settledAt: true,
  outcome: true,
  marketType: true,
  selection: true,
  market: true,
  pick: true,
  category: true,
  categories: { select: { category: true } },
  provenance: true,
  finalHomeScore: true,
  finalAwayScore: true,
  marketConfirmation: true,
  rewriteCount: true,
  matchSlugKey: true,
} as const;
export async function loadPerformance(
  f: PerformanceFilter,
  viewer: Entitlement,
  now = new Date(),
) {
  const bounds = performanceBounds(f.months, now);
  const rows = await prisma.prediction.findMany({
    where: {
      AND: [
        discoveryAccessWhere(viewer),
        {
          status: "PUBLISHED",
          publishedAt: { gte: bounds.start, lt: bounds.end },
          kickoff: { gte: bounds.start, lt: bounds.end },
        },
      ],
    },
    select: PERFORMANCE_SELECT,
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    take: PERFORMANCE_CAP + 1,
  });
  return {
    rows: rows.slice(0, PERFORMANCE_CAP) as PerformanceRow[],
    truncated: rows.length > PERFORMANCE_CAP,
    bounds,
  };
}
export async function loadPerformanceRecord(id: string, viewer: Entitlement) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return null;
  return prisma.prediction.findFirst({
    where: {
      AND: [
        discoveryAccessWhere(viewer),
        { id, status: "PUBLISHED", publishedAt: { not: null } },
      ],
    },
    select: PERFORMANCE_SELECT,
  });
}

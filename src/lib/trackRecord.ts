import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { MARKET_TYPES, type MarketType } from "@/lib/markets";

// Minimum settled (non-PENDING) predictions required before /track-record
// shows real numbers instead of a "not enough data yet" placeholder — and,
// per-bucket, before any single stat (a specific category/market/window) is
// shown as a percentage rather than its own "not enough data" state. A rate
// like "100% win rate, 2 tips" is worse for trust than no page at all.
// Revisit as the site's settled-tip volume grows.
export const MIN_SETTLED_SAMPLE_SIZE = 20;

export const TRACK_RECORD_CATEGORIES = ["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"] as const;
export const TRACK_RECORD_MARKET_TYPES = MARKET_TYPES.filter((m) => m !== "OTHER") as Exclude<MarketType, "OTHER">[];
export const WINDOW_OPTIONS = [7, 30, 90] as const;
export type WindowDays = (typeof WINDOW_OPTIONS)[number];

export type WinRateStat = {
  won: number;
  lost: number;
  void: number;
  total: number; // won + lost + void — all settled, regardless of method
  decided: number; // won + lost — the rate's denominator (VOID excluded)
  rate: number | null; // 0-1, null when decided === 0
};

function computeStat(outcomes: string[]): WinRateStat {
  const won = outcomes.filter((o) => o === "WON").length;
  const lost = outcomes.filter((o) => o === "LOST").length;
  const voided = outcomes.filter((o) => o === "VOID").length;
  const decided = won + lost;
  return { won, lost, void: voided, total: outcomes.length, decided, rate: decided > 0 ? won / decided : null };
}

export type RecentTip = {
  id: string;
  homeTeam: string | null;
  awayTeam: string | null;
  market: string;
  pick: string;
  outcome: string;
  category: string;
  kickoff: string | null;
  settledAt: string | null;
};

export type WindowStats = {
  headline: WinRateStat;
  byCategory: Record<string, WinRateStat>;
  byMarketType: Record<string, WinRateStat>;
};

export type TrackRecordData = {
  totalSettledAllTime: number;
  windows: Record<WindowDays, WindowStats>;
  recentTips: RecentTip[];
};

/**
 * Read-only aggregation over Prediction rows already settled by A1 (auto) or
 * A2 (manual admin override) — no schema of its own. Every stat here counts
 * settledById: null (auto) and settledById: set (manual) identically; nothing
 * in this module distinguishes settlement method in the numbers themselves.
 */
export const getTrackRecordData = cache(async (): Promise<TrackRecordData> => {
  const totalSettledAllTime = await prisma.prediction.count({
    where: { status: "PUBLISHED", outcome: { not: "PENDING" } },
  });

  const maxWindowDays = Math.max(...WINDOW_OPTIONS);
  const maxCutoff = new Date(Date.now() - maxWindowDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", outcome: { not: "PENDING" }, publishedAt: { gte: maxCutoff } },
    select: {
      outcome: true,
      marketType: true,
      category: true,
      publishedAt: true,
      categories: { select: { category: true } },
    },
  });

  const windows = {} as Record<WindowDays, WindowStats>;
  for (const days of WINDOW_OPTIONS) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const windowRows = rows.filter((r) => r.publishedAt && r.publishedAt >= cutoff);

    const byCategory: Record<string, WinRateStat> = {};
    for (const cat of TRACK_RECORD_CATEGORIES) {
      byCategory[cat] = computeStat(windowRows.filter((r) => r.categories.some((c) => c.category === cat)).map((r) => r.outcome));
    }

    const byMarketType: Record<string, WinRateStat> = {};
    for (const mt of TRACK_RECORD_MARKET_TYPES) {
      byMarketType[mt] = computeStat(windowRows.filter((r) => r.marketType === mt).map((r) => r.outcome));
    }

    windows[days] = { headline: computeStat(windowRows.map((r) => r.outcome)), byCategory, byMarketType };
  }

  const recent = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", outcome: { not: "PENDING" } },
    orderBy: { settledAt: "desc" },
    take: 20,
    select: { id: true, homeTeam: true, awayTeam: true, market: true, pick: true, outcome: true, category: true, kickoff: true, settledAt: true },
  });

  const recentTips: RecentTip[] = recent.map((r) => ({
    ...r,
    kickoff: r.kickoff?.toISOString() ?? null,
    settledAt: r.settledAt?.toISOString() ?? null,
  }));

  return { totalSettledAllTime, windows, recentTips };
});

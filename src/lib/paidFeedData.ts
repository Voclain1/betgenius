import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { matchKey } from "@/lib/slug";
import type { FixtureOdds } from "@/lib/odds";
import { pickPrice } from "@/lib/paidSelection";
import { PAID_TIER_CUTOVER } from "@/lib/geniusCuration";
import { computePaidPerformance, paidPickStatus, paidSelectionReason, PAID_STATUS_LABELS, type PaidPerformance, type PaidPickStatus } from "@/lib/paidPerformance";

/**
 * Server-side data for the VIP / Premium feeds, for a reader who CAN view them.
 * Callers must have made the entitlement decision first: nothing here checks
 * access, and nothing here may be rendered for a locked reader.
 */

export type PaidCardPrice = {
  odds: number;
  bookmakers: number;
  /** entry: frozen when the pick was published. current: the latest quote, before kickoff. closing: the last quote before kickoff, after it. */
  kind: "entry" | "current" | "closing";
  at: string | null;
};

export type PaidCardDetail = {
  status: PaidPickStatus | null;
  statusLabel: string | null;
  price: PaidCardPrice | null;
  publishedAt: string | null;
  reason: string;
};

type CardRow = {
  id: string;
  kickoff: Date | null;
  outcome: string;
  publishedAt: Date | null;
  marketType: string;
  selection: unknown;
  confidence: number;
  marketConfirmation: unknown;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
};

/** Pure: the card detail for one row given its cached quote. */
export function paidCardDetail(row: CardRow, quote: { oddsJson: FixtureOdds | null; fetchedAt: Date | null } | null, tier: "VIP" | "PREMIUM", now: Date): PaidCardDetail {
  const status = paidPickStatus(row.kickoff, row.outcome, now);
  const mc = row.marketConfirmation as { entryPrice?: unknown; entryBookmakers?: unknown; confirmedAt?: unknown } | null;
  let price: PaidCardPrice | null = null;
  if (mc && typeof mc.entryPrice === "number" && mc.entryPrice > 1) {
    price = { odds: mc.entryPrice, bookmakers: typeof mc.entryBookmakers === "number" ? mc.entryBookmakers : 0, kind: "entry", at: typeof mc.confirmedAt === "string" ? mc.confirmedAt : null };
  } else if (quote?.fetchedAt && row.kickoff && quote.fetchedAt.getTime() < row.kickoff.getTime()) {
    const p = pickPrice(quote.oddsJson, row.marketType, row.selection);
    // A price derived from another market (draw no bet from the 1X2) is not a
    // quote anyone can take, so it is never shown as one.
    if (p && !p.derived) price = { odds: p.median, bookmakers: p.bookmakers, kind: row.kickoff.getTime() > now.getTime() ? "current" : "closing", at: quote.fetchedAt.toISOString() };
  }
  return {
    status,
    statusLabel: status ? PAID_STATUS_LABELS[status] : null,
    price,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    reason: paidSelectionReason({ marketConfirmation: row.marketConfirmation, confidence: row.confidence }, tier),
  };
}

export async function loadPaidCardDetails(rows: readonly CardRow[], tier: "VIP" | "PREMIUM", now: Date = new Date()): Promise<Map<string, PaidCardDetail>> {
  const keys = [...new Set(rows.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const quotes = keys.length
    ? await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })
    : [];
  const byKey = new Map(quotes.map((q) => [q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt }]));
  return new Map(rows.map((r) => [r.id, paidCardDetail(r, byKey.get(matchKey(r) ?? "") ?? null, tier, now)]));
}

/**
 * The tier's settled record since PAID_TIER_CUTOVER, when the current paid
 * rules (hard floors, one pick per fixture, no doubles) began. Earlier days
 * ran under different rules and are not mixed in.
 */
export const getPaidPerformance = cache(async (tier: "VIP" | "PREMIUM", nowMs?: number): Promise<PaidPerformance> => {
  const now = new Date(nowMs ?? Date.now());
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      kickoff: { gte: PAID_TIER_CUTOVER, lte: now },
      marketType: { not: "SAME_GAME_DOUBLE" },
      categories: { some: { category: tier } },
      NOT: { categories: { some: { category: "SAME_GAME_DOUBLE" } } },
    },
    select: {
      id: true, kickoff: true, marketType: true, market: true, pick: true, homeTeam: true, awayTeam: true, leagueName: true,
      outcome: true, selection: true, marketConfirmation: true, homeTeamApiId: true, awayTeamApiId: true,
    },
  });
  const keys = [...new Set(rows.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const quotes = new Map<string, { oddsJson: FixtureOdds | null; fetchedAt: Date | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) {
      quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
    }
  }
  return computePaidPerformance(
    rows.map((r) => {
      const mc = r.marketConfirmation as { entryPrice?: unknown } | null;
      const q = quotes.get(matchKey(r) ?? "");
      const closing = q?.fetchedAt && r.kickoff && q.fetchedAt < r.kickoff ? pickPrice(q.oddsJson, r.marketType, r.selection) : null;
      return {
        id: r.id, kickoff: r.kickoff!, marketType: r.marketType, market: r.market, pick: r.pick, homeTeam: r.homeTeam, awayTeam: r.awayTeam, leagueName: r.leagueName,
        outcome: r.outcome,
        entryPrice: mc && typeof mc.entryPrice === "number" ? mc.entryPrice : null,
        closingPrice: closing && !closing.derived ? closing.median : null,
      };
    }),
    PAID_TIER_CUTOVER.toISOString().slice(0, 10),
    now,
  );
});

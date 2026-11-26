/**
 * The admin review queue: every pick waiting for a human decision, sorted into
 * two piles so the reviewer's job is obvious.
 *
 *   READY      priced fairly, evidence complete: publish in one tap.
 *   ATTENTION  something is wrong the reviewer must see first: the price is
 *              too short to be worth tipping, there is no verified price, or
 *              the football evidence was incomplete when it was written.
 *
 * Replaces having to cross-check Predictions, Evidence review, Reassessment and
 * Market quality by hand. A pick never reaches READY with a blocking price.
 * Pure classification here; the database read is in loadReviewQueue.
 */
import { prisma } from "@/lib/prisma";
import { matchKey } from "@/lib/slug";
import type { FixtureOdds } from "@/lib/odds";
import { pricedOptions, priceVerdict, type PriceStatus } from "@/lib/marketPricePolicy";

export type QueueRow = {
  id: string; marketType: string; selection: unknown; market: string; pick: string; confidence: number;
  homeTeam: string | null; awayTeam: string | null; leagueName: string | null; kickoff: Date | null;
  contextComplete: boolean; aiJobId: string | null; createdAt: Date;
};

export type QueueItem = {
  id: string; fixture: string; league: string | null; kickoff: string | null; market: string; pick: string; confidence: number;
  price: { status: PriceStatus; label: string; median: number | null };
  /** Why this is not ready; empty when it is. */
  problems: string[];
  /** Real quoted alternatives at or above the useful floor (names only, highest price first). */
  betterOptions: string[];
  kickedOff: boolean;
};

export function classifyQueueRow(row: QueueRow, odds: FixtureOdds | null, now: Date = new Date()): QueueItem {
  const home = row.homeTeam ?? "Home";
  const away = row.awayTeam ?? "Away";
  const verdict = priceVerdict(odds, row.marketType, row.selection);
  const problems: string[] = [];
  // A hand-written pick (no model job) is the admin's own call: its price is
  // shown but never makes it "needs attention" on its own.
  const generated = row.aiJobId != null;
  if (generated && verdict.blocksPublication) problems.push(`Price too short or unverifiable: ${verdict.label}`);
  if (!row.contextComplete) problems.push("Written without enough football evidence");
  const kickedOff = !!row.kickoff && row.kickoff.getTime() <= now.getTime();
  const betterOptions = problems.length && odds
    ? pricedOptions(odds, home, away).filter((o) => o.median >= 1.2).slice(0, 4).map((o) => `${o.label} (${o.median.toFixed(2)})`)
    : [];
  return {
    id: row.id, fixture: `${home} v ${away}`, league: row.leagueName, kickoff: row.kickoff?.toISOString() ?? null,
    market: row.market, pick: row.pick, confidence: row.confidence,
    price: { status: verdict.status, label: verdict.label, median: verdict.median },
    problems, betterOptions, kickedOff,
  };
}

/** Whether a generated row may not be published for its price (used by the bulk publish guard). */
export function publishPriceProblem(row: Pick<QueueRow, "marketType" | "selection" | "aiJobId">, odds: FixtureOdds | null): string | null {
  if (row.aiJobId == null) return null;
  const v = priceVerdict(odds, row.marketType, row.selection);
  return v.blocksPublication ? v.label : null;
}

/** Cached odds for a set of rows, keyed by row id. */
export async function oddsForRows(rows: Array<{ id: string; homeTeamApiId: number | null; awayTeamApiId: number | null; kickoff: Date | null }>): Promise<Map<string, FixtureOdds | null>> {
  const keyOf = new Map(rows.map((r) => [r.id, matchKey(r)] as const));
  const keys = [...new Set([...keyOf.values()].filter((k): k is string => !!k))];
  const cached = keys.length
    ? await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys } }, select: { matchKey: true, oddsJson: true } })
    : [];
  const byKey = new Map(cached.map((c) => [c.matchKey, (c.oddsJson as unknown as FixtureOdds | null) ?? null]));
  return new Map(rows.map((r) => [r.id, byKey.get(keyOf.get(r.id) ?? "") ?? null]));
}

export async function loadReviewQueue(now: Date = new Date()) {
  const rows = await prisma.prediction.findMany({
    where: { status: "PENDING_REVIEW", OR: [{ kickoff: null }, { kickoff: { gt: now } }] },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    take: 300,
    select: {
      id: true, marketType: true, selection: true, market: true, pick: true, confidence: true, homeTeam: true, awayTeam: true,
      leagueName: true, kickoff: true, contextComplete: true, aiJobId: true, createdAt: true, homeTeamApiId: true, awayTeamApiId: true,
    },
  });
  const odds = await oddsForRows(rows);
  const items = rows.map((r) => classifyQueueRow(r, odds.get(r.id) ?? null, now));
  return { ready: items.filter((i) => i.problems.length === 0), attention: items.filter((i) => i.problems.length > 0) };
}

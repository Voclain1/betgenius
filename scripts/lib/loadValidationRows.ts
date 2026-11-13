/**
 * Settled published singles at confidence >= the VIP floor, with point-in-time
 * prices, as ValidationRows. Shared by the validation and research scripts.
 * Entry price where a dedicated pick recorded one (verifiedEntryPrice);
 * otherwise the last PRE-KICKOFF cached quote, labelled "closing". A quote
 * taken after kickoff is never used. Read-only.
 */
import { prisma } from "../../src/lib/prisma";
import { lagosDateKey } from "../../src/lib/lagosDate";
import { matchKey } from "../../src/lib/slug";
import type { FixtureOdds } from "../../src/lib/odds";
import { pickPrice } from "../../src/lib/paidSelection";
import { verifiedEntryPrice } from "../../src/lib/paidEntryEvidence";
import { PAID_ANY_LEAGUE_IDS } from "../../src/lib/vipPremiumOverlay";
import { QUALITY_POLICY } from "../../src/lib/paidCandidateQuality";
import type { ValidationRow } from "../../src/lib/paidPolicyValidation";

export async function loadValidationRows(since: Date, now: Date): Promise<{ rows: ValidationRow[]; postKickoff: number }> {
  const raw = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED", outcome: { in: ["WON", "LOST", "VOID"] }, confidence: { gte: QUALITY_POLICY.VIP.minConfidence },
      kickoff: { gte: since, lt: now }, marketType: { not: "SAME_GAME_DOUBLE" },
    },
    select: {
      id: true, kickoff: true, leagueApiId: true, marketType: true, selection: true, confidence: true, outcome: true,
      homeTeamApiId: true, awayTeamApiId: true, marketConfirmation: true, categories: { select: { category: true } },
    },
    take: 30_000,
  });
  const rowsIn = raw.filter((r) => r.kickoff && !r.categories.some((c) => c.category === "SAME_GAME_DOUBLE"));
  const keys = [...new Set(rowsIn.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const quotes = new Map<string, { oddsJson: FixtureOdds | null; fetchedAt: Date | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) {
      quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
    }
  }

  let postKickoff = 0;
  const rows: ValidationRow[] = rowsIn.map((r) => {
    const kickoff = r.kickoff!;
    const key = matchKey(r) ?? `id:${r.id}`;
    const q = quotes.get(key);
    const pre = !!q?.fetchedAt && q.fetchedAt < kickoff;
    if (q?.fetchedAt && !pre) postKickoff++;
    const price = pre ? pickPrice(q!.oddsJson, r.marketType, r.selection) : null;
    const entry = verifiedEntryPrice(r.marketConfirmation, kickoff);
    const mc = r.marketConfirmation as any;
    const executable = price && !price.derived ? price : null;
    const odds = entry ?? executable?.median ?? null;
    return {
      id: r.id, fixtureKey: key, leagueApiId: r.leagueApiId, marketType: r.marketType,
      selection: typeof r.selection === "string" ? r.selection : JSON.stringify(r.selection ?? null),
      kickoff, confidence: r.confidence, odds,
      marketProbability: entry && typeof mc?.marketProbability === "number" ? mc.marketProbability : executable?.fair ?? null,
      bookmakers: entry && typeof mc?.bookmakers === "number" ? mc.bookmakers : executable?.bookmakers ?? null,
      derivedPrice: !!price?.derived && !entry,
      quoteFetchedAt: entry && typeof mc?.quoteFetchedAt === "string" ? new Date(mc.quoteFetchedAt) : pre ? q!.fetchedAt : null,
      calibratedLower: null, expectedValueLower: null,
      outcome: r.outcome as ValidationRow["outcome"],
      categories: r.categories.map((c) => c.category),
      inPaidScope: PAID_ANY_LEAGUE_IDS.includes(r.leagueApiId ?? -1),
      day: lagosDateKey(kickoff),
      priceSource: entry ? "entry" : executable ? "closing" : "missing",
    };
  });
  return { rows, postKickoff };
}

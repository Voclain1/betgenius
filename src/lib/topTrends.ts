import { prisma } from "@/lib/prisma";
import type { InsightEvidence } from "@/lib/insights";
import type { FixtureOdds } from "@/lib/odds";
import { matchKey, matchSlug } from "@/lib/slug";
import {
  TREND_PERIODS,
  compareTrends,
  periodBounds,
  topPerFixture,
  trendBadge,
  trendPrice,
  trendKickoffLabel,
  trendSentence,
  type SentencePart,
  type TrendPeriod,
  type TrendTone,
} from "@/lib/trendCards";

export type TrendCard = {
  id: string;
  teamName: string;
  crestUrl: string | null;
  badge: { title: string; figure: string; tone: TrendTone };
  sentence: SentencePart[];
  match: string;
  kickoff: string;
  href: string | null;
  price: { label: string; odds: number } | null;
};

type Row = { id: string; predictionId: string; teamApiId: number; kickoff: Date; strength: number; evidence: InsightEvidence };

async function loadRows(start: Date, end: Date, now: Date): Promise<Row[]> {
  const rows = await prisma.matchInsightCache.findMany({
    where: { expiresAt: { gt: now }, kickoff: { gte: start > now ? start : now, lt: end } },
    select: { id: true, predictionId: true, teamApiId: true, kickoff: true, strength: true, evidence: true },
  });
  return rows.map((r) => ({ ...r, evidence: r.evidence as unknown as InsightEvidence }));
}

/** Turns stored insights into display cards: match names, crest, and a price for the bet each trend describes. */
async function toCards(rows: Row[]): Promise<TrendCard[]> {
  if (!rows.length) return [];
  const [predictions, crests] = await Promise.all([
    prisma.prediction.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.predictionId))] } },
      select: { id: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
    }),
    prisma.teamEnrichmentCache.findMany({ where: { teamApiId: { in: [...new Set(rows.map((r) => r.teamApiId))] } }, select: { teamApiId: true, crestUrl: true } }),
  ]);
  const byId = new Map(predictions.map((p) => [p.id, p]));
  const keys = predictions.map((p) => matchKey(p)).filter((k): k is string => !!k);
  const odds = keys.length
    ? await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys }, fetchedAt: { not: null } }, select: { matchKey: true, oddsJson: true } })
    : [];
  const oddsByKey = new Map(odds.map((o) => [o.matchKey, o.oddsJson as unknown as FixtureOdds | null]));
  const crestById = new Map(crests.map((c) => [c.teamApiId, c.crestUrl]));

  return rows.flatMap((row) => {
    const p = byId.get(row.predictionId);
    if (!p?.homeTeam || !p.awayTeam) return [];
    const venue = p.homeTeamApiId === row.teamApiId ? "HOME" : p.awayTeamApiId === row.teamApiId ? "AWAY" : null;
    if (!venue) return [];
    const key = matchKey(p);
    const slug = matchSlug(p);
    return [{
      id: row.id,
      teamName: row.evidence.teamName,
      crestUrl: crestById.get(row.teamApiId) ?? null,
      badge: trendBadge(row.evidence),
      sentence: trendSentence(row.evidence),
      match: `${p.homeTeam} - ${p.awayTeam}`,
      kickoff: trendKickoffLabel(row.kickoff),
      href: slug ? `/predictions/match/${slug}` : null,
      price: trendPrice(key ? oddsByKey.get(key) ?? null : null, row.evidence.type, venue, p.homeTeam, p.awayTeam),
    }];
  });
}

/** The strongest trend per fixture for each period, for the prediction-page panel. */
export async function loadTopTrends(limit = 6, now: Date = new Date()): Promise<Record<TrendPeriod, TrendCard[]>> {
  const bounds = TREND_PERIODS.map((period) => periodBounds(period, now));
  const rows = await loadRows(
    new Date(Math.min(...bounds.map((b) => b.start.getTime()))),
    new Date(Math.max(...bounds.map((b) => b.end.getTime()))),
    now,
  );
  const entries = await Promise.all(
    TREND_PERIODS.map(async (period, i) => {
      const inPeriod = rows.filter((r) => r.kickoff >= bounds[i].start && r.kickoff < bounds[i].end);
      return [period, await toCards(topPerFixture(inPeriod, limit))] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<TrendPeriod, TrendCard[]>;
}

/** Every current trend for one period, strongest first, for /match-insights. */
export async function loadTrendPage(period: TrendPeriod, page: number, pageSize: number, now: Date = new Date()) {
  const { start, end } = periodBounds(period, now);
  const rows = (await loadRows(start, end, now)).sort(compareTrends);
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  return { cards: await toCards(slice), total: rows.length };
}

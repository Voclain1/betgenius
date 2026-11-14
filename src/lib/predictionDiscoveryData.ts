import { readFixtureResult } from "./matchCentre";
import { rowStatus, trustedStatusCode } from "./predictionStatus";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { canViewCategory, presentedCategory } from "./access";
import type { Entitlement } from "./entitlement";
import { type PredictionCategory } from "./enums";
import { rowViewable } from "./lockedPrediction";
import { categoryFeedWhere, CATEGORY_SLUGS } from "./categoryPredictions";
import { goalsFeedRows } from "./goalsCategory";
import { matchKey, matchSlug } from "./slug";
import { discoveryQuote } from "./selectionQuote";
export { discoveryQuote } from "./selectionQuote";
import {
  DISCOVERY_LIMIT,
  DISCOVERY_PAGE_SIZE,
  discoveryPhase,
  matchesDiscoveryTime,
  type DiscoveryFilter,
} from "./predictionDiscovery";

/** Query and serialization both enforce access. No shared user-specific cache. */
export { discoveryAccessWhere } from "./predictionVisibility";
import { discoveryAccessWhere } from "./predictionVisibility";
export type DiscoveryInterests = {
  teams: number[];
  leagues: number[];
  markets: string[];
  saved: string[];
};
const EMPTY_INTERESTS: DiscoveryInterests = {
  teams: [],
  leagues: [],
  markets: [],
  saved: [],
};
export const DISCOVERY_SELECT = {
  id: true,
  category: true,
  categories: { select: { category: true } },
  provenance: true,
  homeTeam: true,
  awayTeam: true,
  homeTeamApiId: true,
  awayTeamApiId: true,
  leagueName: true,
  leagueApiId: true,
  fixtureApiId: true,
  kickoff: true,
  outcome: true,
  marketType: true,
  selection: true,
  market: true,
  pick: true,
  confidence: true,
} satisfies Prisma.PredictionSelect;
export type DiscoverySource = Prisma.PredictionGetPayload<{
  select: typeof DISCOVERY_SELECT;
}>;

/** Read-only, at most 301 prediction rows and three bounded cache reads. */
export async function loadDiscovery(
  f: DiscoveryFilter,
  viewer: Entitlement,
  fixedCategory?: PredictionCategory,
  interests = EMPTY_INTERESTS,
  now = new Date(),
) {
  const allowed = (c: string) =>
    canViewCategory(
      c as PredictionCategory,
      viewer.tier,
      viewer.status,
      viewer.role,
    );
  const category = fixedCategory ?? CATEGORY_SLUGS[f.category];
  if (category && !allowed(category))
    return {
      locked: true,
      items: [],
      matched: 0,
      truncated: false,
      page: 1,
      pages: 1,
    };
  const feeds: Prisma.PredictionWhereInput = category
    ? categoryFeedWhere(category)
    : {
        OR: [
          categoryFeedWhere("TODAY"),
          ...(["VIP", "PREMIUM"] as const)
            .filter(allowed)
            .map(categoryFeedWhere),
        ],
      };
  const personal: Prisma.PredictionWhereInput =
    f.personal === "saved"
      ? { id: { in: interests.saved } }
      : f.personal === "markets"
        ? { marketType: { in: interests.markets } }
        : f.personal === "favourites"
          ? {
              OR: [
                { homeTeamApiId: { in: interests.teams } },
                { awayTeamApiId: { in: interests.teams } },
                { leagueApiId: { in: interests.leagues } },
              ],
            }
          : {};
  const found = await prisma.prediction.findMany({
    where: {
      AND: [
        feeds,
        discoveryAccessWhere(viewer),
        personal,
        { kickoff: { gte: f.bounds.start, lt: f.bounds.end } },
        ...(f.competition ? [{ leagueApiId: f.competition }] : []),
        ...(f.team
          ? [
              {
                OR: [
                  {
                    homeTeam: {
                      contains: f.team,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    awayTeam: {
                      contains: f.team,
                      mode: "insensitive" as const,
                    },
                  },
                ],
              },
            ]
          : []),
        ...(f.market ? [{ marketType: f.market }] : []),
      ],
    },
    select: DISCOVERY_SELECT,
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    take: DISCOVERY_LIMIT + 1,
  });
  const rows = found
    .slice(0, DISCOVERY_LIMIT)
    .filter((r) =>
      rowViewable(
        r,
        allowed(presentedCategory(r.category, r.categories)),
        allowed,
      ),
    );
  const keys = rows.map((r) => matchKey(r)).filter((k): k is string => !!k);
  const [odds, fixtures, results] = await Promise.all([
    prisma.fixtureOddsCache.findMany({
      where: { matchKey: { in: keys } },
      take: DISCOVERY_LIMIT,
      select: {
        matchKey: true,
        fixtureApiId: true,
        oddsJson: true,
        fetchedAt: true,
      },
    }),
    prisma.fixture.findMany({
      where: {
        apiId: {
          in: rows.flatMap((r) =>
            r.fixtureApiId == null ? [] : [r.fixtureApiId],
          ),
        },
      },
      take: DISCOVERY_LIMIT,
      select: {
        apiId: true,
        kickoff: true,
        status: true,
        homeTeam: { select: { apiId: true } },
        awayTeam: { select: { apiId: true } },
        league: { select: { apiId: true } },
      },
    }),
    prisma.fixtureDetailCache.findMany({
      where: { matchKey: { in: keys } },
      take: DISCOVERY_LIMIT,
      select: {
        matchKey: true,
        fixtureApiId: true,
        homeTeamApiId: true,
        awayTeamApiId: true,
        detailJson: true,
      },
    }),
  ]);
  const capturedByKey = new Map(results.map((r) => [r.matchKey, r]));
  const quoteByKey = new Map(odds.map((q) => [q.matchKey, q])),
    fixtureById = new Map(fixtures.map((q) => [q.apiId, q]));
  const eligible = category === "GOALS" ? goalsFeedRows(rows) : rows;
  const items = eligible.flatMap((r) => {
    if (
      !r.kickoff ||
      !r.homeTeam ||
      !r.awayTeam ||
      !matchesDiscoveryTime(r.kickoff, f, now)
    )
      return [];
    const fixture =
      r.fixtureApiId == null ? undefined : fixtureById.get(r.fixtureApiId);
    const verified =
      fixture &&
      fixture.homeTeam.apiId === r.homeTeamApiId &&
      fixture.awayTeam.apiId === r.awayTeamApiId &&
      fixture.league.apiId === r.leagueApiId;
    const disagreement =
      !!fixture &&
      (!verified || Math.abs(+fixture.kickoff - +r.kickoff) > 60000);
    const resultCache = capturedByKey.get(matchKey(r) ?? "");
    const captured =
      resultCache &&
      resultCache.fixtureApiId != null &&
      (r.fixtureApiId == null || resultCache.fixtureApiId === r.fixtureApiId) &&
      resultCache.homeTeamApiId === r.homeTeamApiId &&
      resultCache.awayTeamApiId === r.awayTeamApiId
        ? readFixtureResult(
            (resultCache.detailJson as any)?.result,
            resultCache.fixtureApiId,
          )
        : null;
    const statusCode =
      trustedStatusCode(captured?.status) ?? (verified ? fixture.status : null);
    const phase = disagreement
      ? "unavailable"
      : (discoveryPhase(r.kickoff, r.outcome, statusCode, now) ??
        (r.kickoff > now && r.outcome === "PENDING"
          ? "upcoming"
          : r.outcome !== "PENDING"
            ? "finished"
            : "started"));
    if (
      f.state !== "all" &&
      phase !== (f.state === "live" ? "started" : f.state)
    )
      return [];
    const quote =
      disagreement ||
      phase === "unavailable" ||
      phase === "started" ||
      (phase === "finished" && r.kickoff > now)
        ? null
        : discoveryQuote(r, quoteByKey.get(matchKey(r) ?? ""), now);
    if (f.odds && !quote) return [];
    const slug = matchSlug(r);
    if (!slug) return [];
    // Explicit projection: source selection, provenance and any future columns never cross this boundary.
    return [
      {
        id: r.id,
        category: presentedCategory(r.category, r.categories),
        home: r.homeTeam,
        away: r.awayTeam,
        league: r.leagueName,
        leagueApiId: r.leagueApiId,
        kickoff: r.kickoff,
        market: r.market,
        pick: r.pick,
        confidence: r.confidence,
        phase,
        statusVerified: !!verified || !!captured,
        statusLabel: rowStatus({
          kickoff: r.kickoff,
          outcome: r.outcome,
          statusCode,
          now,
        }).label,
        href: `/predictions/match/${slug}`,
        quote,
      },
    ];
  });
  const pages = Math.max(1, Math.ceil(items.length / DISCOVERY_PAGE_SIZE)),
    page = Math.min(f.page, pages);
  return {
    locked: false,
    items: items.slice(
      (page - 1) * DISCOVERY_PAGE_SIZE,
      page * DISCOVERY_PAGE_SIZE,
    ),
    matched: items.length,
    truncated: found.length > DISCOVERY_LIMIT,
    page,
    pages,
  };
}

/**
 * Sprint 01 personalization: the database half. Every function takes the
 * server-resolved userId as its first argument and scopes every query by it —
 * nothing here accepts a user id from a request body.
 *
 * Rules (ranking, validation, settlement display) live in the pure module
 * src/lib/personalization.ts.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canViewCategory, presentedCategory } from "@/lib/access";
import type { Entitlement } from "@/lib/entitlement";
import type { PredictionCategory } from "@/lib/enums";
import { categoryFeedWhere } from "@/lib/categoryPredictions";
import { isFixtureTaken, takeFixture } from "@/lib/fixtureIdentity";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";
import { upcomingTeamIds, type LeagueUpcomingFixture } from "@/lib/enrichment";
import { matchKey, matchSlug } from "@/lib/slug";
import {
  DEFAULT_TIMEZONE,
  LIMITS,
  buildUpcoming,
  diffIds,
  hasInterests,
  isCatalogueLeague,
  isPreferenceMarket,
  rankPersonalized,
  SAVED_FILTERS,
  matchesSavedFilter,
  orderSaved,
  recentlySettled,
  safeTimeZone,
  savedPredictionView,
  uniqueIds,
  zonedDayBounds,
  type Interests,
  type PreferencesUpdateInput,
  type SavedFilter,
  type SavedView,
  type UpcomingSource,
} from "@/lib/personalization";

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export type Favourite = { id: number; name: string };

export type PersonalizationState = {
  hasPreferenceRow: boolean;
  timezone: string;
  preferredMarkets: string[];
  onboardingCompletedAt: Date | null;
  onboardingSkippedAt: Date | null;
  teams: Favourite[];
  leagues: Favourite[];
};

function leagueNameFromCatalogue(id: number): string | null {
  return LEAGUE_CATALOGUE.find((l) => l.id === id)?.name ?? null;
}

/** Preferences + favourite teams/leagues for one user, once per request. */
export const getPersonalization = cache(async (userId: string): Promise<PersonalizationState> => {
  const [pref, follows] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId } }),
    prisma.userFollow.findMany({
      where: { userId, targetType: { in: ["TEAM", "LEAGUE"] } },
      select: { targetType: true, targetKey: true, label: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const toFav = (f: { targetKey: string; label: string | null }, fallback: (id: number) => string | null): Favourite | null => {
    const id = Number(f.targetKey);
    if (!Number.isInteger(id) || id <= 0) return null;
    return { id, name: f.label || fallback(id) || `#${id}` };
  };
  return {
    hasPreferenceRow: !!pref,
    timezone: safeTimeZone(pref?.timezone ?? DEFAULT_TIMEZONE),
    preferredMarkets: (pref?.preferredMarkets ?? []).filter(isPreferenceMarket),
    onboardingCompletedAt: pref?.onboardingCompletedAt ?? null,
    onboardingSkippedAt: pref?.onboardingSkippedAt ?? null,
    teams: follows.filter((f) => f.targetType === "TEAM").map((f) => toFav(f, () => null)).filter((f): f is Favourite => !!f),
    leagues: follows.filter((f) => f.targetType === "LEAGUE").map((f) => toFav(f, leagueNameFromCatalogue)).filter((f): f is Favourite => !!f),
  };
});

export function interestsOf(s: PersonalizationState): Interests {
  return {
    teamIds: new Set(s.teams.map((t) => t.id)),
    leagueIds: new Set(s.leagues.map((l) => l.id)),
    markets: new Set(s.preferredMarkets),
  };
}

type TeamRow = { id: number; name: string; n: number };

/**
 * Canonical names for team ids, from published predictions (where every team
 * id in the app comes from) with the enrichment cache as a fallback. An id in
 * neither is not a team this site covers and is refused — a client cannot
 * follow an arbitrary number or choose the label stored for it.
 */
export async function resolveTeams(ids: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const list = [...ids];
  const rows = await prisma.$queryRaw<TeamRow[]>`
    SELECT id, (array_agg(name ORDER BY kickoff DESC NULLS LAST))[1] AS name, count(*)::int AS n FROM (
      SELECT "homeTeamApiId" AS id, "homeTeam" AS name, kickoff FROM "Prediction"
        WHERE status = 'PUBLISHED' AND "homeTeamApiId" = ANY(${list}) AND "homeTeam" IS NOT NULL
      UNION ALL
      SELECT "awayTeamApiId", "awayTeam", kickoff FROM "Prediction"
        WHERE status = 'PUBLISHED' AND "awayTeamApiId" = ANY(${list}) AND "awayTeam" IS NOT NULL
    ) t GROUP BY id`;
  for (const r of rows) out.set(Number(r.id), r.name);
  const missing = list.filter((id) => !out.has(id));
  if (missing.length) {
    const cached = await prisma.teamEnrichmentCache.findMany({ where: { teamApiId: { in: missing }, teamName: { not: null } }, select: { teamApiId: true, teamName: true } });
    for (const c of cached) if (c.teamName) out.set(c.teamApiId, c.teamName);
  }
  return out;
}

/** League ids: the catalogue, or any competition a published prediction carries. */
export async function resolveLeagues(ids: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unknown: number[] = [];
  for (const id of ids) {
    const name = isCatalogueLeague(id) ? leagueNameFromCatalogue(id) : null;
    if (name) out.set(id, name);
    else unknown.push(id);
  }
  if (unknown.length) {
    const rows = await prisma.prediction.findMany({
      where: { status: "PUBLISHED", leagueApiId: { in: unknown }, leagueName: { not: null } },
      distinct: ["leagueApiId"],
      select: { leagueApiId: true, leagueName: true },
    });
    for (const r of rows) if (r.leagueApiId != null && r.leagueName) out.set(r.leagueApiId, r.leagueName);
  }
  return out;
}

export class PreferenceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * Apply a validated update. Omitted fields are left alone; a provided list
 * REPLACES the current set (the client sends the whole selection), applied as
 * a diff so untouched follows keep their createdAt and notification history.
 * One transaction: a half-applied save cannot leave teams changed and markets
 * not.
 */
export async function updatePreferences(userId: string, input: PreferencesUpdateInput): Promise<PersonalizationState> {
  const teamIds = input.teamIds ? uniqueIds(input.teamIds) : null;
  const leagueIds = input.leagueIds ? uniqueIds(input.leagueIds) : null;

  const [teamNames, leagueNames] = await Promise.all([
    teamIds ? resolveTeams(teamIds) : Promise.resolve(new Map<number, string>()),
    leagueIds ? resolveLeagues(leagueIds) : Promise.resolve(new Map<number, string>()),
  ]);
  if (teamIds?.some((id) => !teamNames.has(id))) throw new PreferenceError("One or more teams are not recognised");
  if (leagueIds?.some((id) => !leagueNames.has(id))) throw new PreferenceError("One or more competitions are not recognised");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const data: Prisma.UserPreferenceUncheckedUpdateInput = {};
    if (input.timezone) data.timezone = input.timezone;
    if (input.preferredMarkets) data.preferredMarkets = Array.from(new Set(input.preferredMarkets));
    if (input.onboarding === "complete") data.onboardingCompletedAt = now;
    if (input.onboarding === "skip") data.onboardingSkippedAt = now;
    await tx.userPreference.upsert({
      where: { userId },
      update: data,
      create: { ...(data as Omit<Prisma.UserPreferenceUncheckedCreateInput, "userId">), userId },
    });
    // Keep notification quiet hours on the same clock, but never create a
    // NotificationPreference row here — whether one exists changes alert
    // defaults, which is not this screen's decision.
    if (input.timezone) await tx.notificationPreference.updateMany({ where: { userId }, data: { timezone: input.timezone } });

    for (const [type, ids, names] of [
      ["TEAM", teamIds, teamNames],
      ["LEAGUE", leagueIds, leagueNames],
    ] as const) {
      if (!ids) continue;
      const current = await tx.userFollow.findMany({ where: { userId, targetType: type }, select: { targetKey: true } });
      const { add, remove } = diffIds(
        current.map((c) => Number(c.targetKey)).filter((n) => Number.isInteger(n)),
        ids,
      );
      if (remove.length) await tx.userFollow.deleteMany({ where: { userId, targetType: type, targetKey: { in: remove.map(String) } } });
      if (add.length) {
        await tx.userFollow.createMany({
          data: add.map((id) => ({ userId, targetType: type, targetKey: String(id), label: names.get(id) ?? null })),
          skipDuplicates: true,
        });
      }
    }
  });
  return readPersonalizationFresh(userId);
}

/** Uncached read for the response to a mutation. */
async function readPersonalizationFresh(userId: string): Promise<PersonalizationState> {
  const [pref, follows] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId } }),
    prisma.userFollow.findMany({ where: { userId, targetType: { in: ["TEAM", "LEAGUE"] } }, select: { targetType: true, targetKey: true, label: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const fav = (type: string) =>
    follows
      .filter((f) => f.targetType === type)
      .map((f) => ({ id: Number(f.targetKey), name: f.label || (type === "LEAGUE" ? leagueNameFromCatalogue(Number(f.targetKey)) : null) || `#${f.targetKey}` }))
      .filter((f) => Number.isInteger(f.id) && f.id > 0);
  return {
    hasPreferenceRow: !!pref,
    timezone: safeTimeZone(pref?.timezone),
    preferredMarkets: (pref?.preferredMarkets ?? []).filter(isPreferenceMarket),
    onboardingCompletedAt: pref?.onboardingCompletedAt ?? null,
    onboardingSkippedAt: pref?.onboardingSkippedAt ?? null,
    teams: fav("TEAM"),
    leagues: fav("LEAGUE"),
  };
}

export { readPersonalizationFresh };

/**
 * Reset: markets and timezone back to defaults, favourite teams and
 * competitions removed. Onboarding state is kept (the reader has seen it) and
 * saved predictions, match/category follows and notification settings are
 * untouched — they are not preferences.
 */
export async function resetPreferences(userId: string): Promise<PersonalizationState> {
  await prisma.$transaction([
    prisma.userPreference.upsert({
      where: { userId },
      update: { preferredMarkets: [], timezone: DEFAULT_TIMEZONE },
      create: { userId, onboardingSkippedAt: new Date() },
    }),
    prisma.userFollow.deleteMany({ where: { userId, targetType: { in: ["TEAM", "LEAGUE"] } } }),
  ]);
  return readPersonalizationFresh(userId);
}

// ---------------------------------------------------------------------------
// Team search (public data; never user-specific)
// ---------------------------------------------------------------------------

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Teams by name among those the site has published predictions for. */
export async function searchTeams(q: string, limit = 20): Promise<Favourite[]> {
  const pattern = likePattern(q.trim().slice(0, 60));
  const rows = await prisma.$queryRaw<TeamRow[]>`
    SELECT id, (array_agg(name ORDER BY kickoff DESC NULLS LAST))[1] AS name, count(*)::int AS n FROM (
      SELECT "homeTeamApiId" AS id, "homeTeam" AS name, kickoff FROM "Prediction"
        WHERE status = 'PUBLISHED' AND "homeTeamApiId" IS NOT NULL AND "homeTeam" ILIKE ${pattern}
      UNION ALL
      SELECT "awayTeamApiId", "awayTeam", kickoff FROM "Prediction"
        WHERE status = 'PUBLISHED' AND "awayTeamApiId" IS NOT NULL AND "awayTeam" ILIKE ${pattern}
    ) t GROUP BY id ORDER BY n DESC, name ASC LIMIT ${limit}`;
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

/**
 * The most-covered teams of the last 120 days — the picker's starting list.
 * Public and identical for everyone, so it is cached across requests; nothing
 * personal ever enters this cache.
 */
export const popularTeams = unstable_cache(
  async (limit = 24): Promise<Favourite[]> => {
    const since = new Date(Date.now() - 120 * 86_400_000);
    const rows = await prisma.$queryRaw<TeamRow[]>`
      SELECT id, (array_agg(name ORDER BY kickoff DESC NULLS LAST))[1] AS name, count(*)::int AS n FROM (
        SELECT "homeTeamApiId" AS id, "homeTeam" AS name, kickoff FROM "Prediction"
          WHERE status = 'PUBLISHED' AND "homeTeamApiId" IS NOT NULL AND "homeTeam" IS NOT NULL AND kickoff >= ${since}
        UNION ALL
        SELECT "awayTeamApiId", "awayTeam", kickoff FROM "Prediction"
          WHERE status = 'PUBLISHED' AND "awayTeamApiId" IS NOT NULL AND "awayTeam" IS NOT NULL AND kickoff >= ${since}
      ) t GROUP BY id ORDER BY n DESC, name ASC LIMIT ${limit}`;
    return rows.map((r) => ({ id: Number(r.id), name: r.name }));
  },
  ["personalization-popular-teams"],
  { revalidate: 3600 },
);

// ---------------------------------------------------------------------------
// Dashboard: today's predictions
// ---------------------------------------------------------------------------

const PICK_SELECT = {
  id: true,
  category: true,
  categories: { select: { category: true } },
  marketType: true,
  market: true,
  pick: true,
  odds: true,
  confidence: true,
  outcome: true,
  leagueApiId: true,
  leagueName: true,
  homeTeam: true,
  awayTeam: true,
  homeTeamApiId: true,
  awayTeamApiId: true,
  fixtureApiId: true,
  kickoff: true,
  publishedAt: true,
  finalHomeScore: true,
  finalAwayScore: true,
} satisfies Prisma.PredictionSelect;

export type DashboardPick = Prisma.PredictionGetPayload<{ select: typeof PICK_SELECT }> & {
  presented: PredictionCategory;
  href: string | null;
  /** Provider status from the captured result record (Sprint 02), when one exists. See loadStatusCodes. */
  statusCode: string | null;
};

type StatusKey = { homeTeamApiId?: number | null; awayTeamApiId?: number | null; kickoff?: Date | null };

/**
 * Provider status codes for fixtures, keyed by matchKey, from the result record
 * Sprint 02 captures into FixtureDetailCache.detailJson.result.
 *
 * ONE indexed read, no provider call. A record only counts when it is for the
 * SAME fixture the cache row is for (result.fixtureApiId = the row's
 * fixtureApiId), so a rescheduled match cannot inherit another game's status.
 * The codes are presentation input only — src/lib/predictionStatus.ts decides
 * which ones to believe. Failure is not an error: the label then comes from the
 * clock alone, exactly as before this existed.
 */
export async function loadStatusCodes(fixtures: StatusKey[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const keys = Array.from(new Set(fixtures.map((f) => matchKey(f)).filter((k): k is string => !!k)));
  if (!keys.length) return out;
  try {
    const rows = await prisma.$queryRaw<{ matchKey: string; status: string | null }[]>`
      SELECT "matchKey",
             CASE WHEN "detailJson"#>>'{result,fixtureApiId}' = "fixtureApiId"::text THEN "detailJson"#>>'{result,status}' END AS status
      FROM "FixtureDetailCache" WHERE "matchKey" = ANY(${keys})`;
    for (const r of rows) if (r.status) out.set(r.matchKey, r.status);
  } catch (e) {
    console.error("[personalization] status lookup skipped:", e instanceof Error ? e.message : e);
  }
  return out;
}

const statusOf = (codes: Map<string, string>, f: StatusKey): string | null => {
  const k = matchKey(f);
  return k ? (codes.get(k) ?? null) : null;
};

/**
 * Today's published picks in the reader's own day, from the feeds they can
 * read: the Today mix (which already excludes hidden combo legs and paid-only
 * picks) plus VIP and Premium when entitled. Nothing locked is ever fetched
 * into this list, and each row is re-checked with the same gate every feed
 * uses before it is returned.
 */
export async function todaysPicks(viewer: Entitlement, timezone: string, now: Date = new Date()): Promise<DashboardPick[]> {
  const { start, end } = zonedDayBounds(timezone, now);
  const feeds: Prisma.PredictionWhereInput[] = [categoryFeedWhere("TODAY")];
  for (const paid of ["VIP", "PREMIUM"] as const) {
    if (canViewCategory(paid, viewer.tier, viewer.status, viewer.role)) feeds.push(categoryFeedWhere(paid));
  }
  const rows = await prisma.prediction.findMany({
    where: { AND: [{ OR: feeds }, { kickoff: { gte: start, lt: end } }] },
    select: PICK_SELECT,
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    take: 150,
  });
  const viewable = rows
    .map((r) => ({ ...r, presented: presentedCategory(r.category, r.categories), href: matchHref(r) }))
    .filter((r) => canViewCategory(r.presented, viewer.tier, viewer.status, viewer.role));
  // Status is looked up only for rows the reader can already see.
  const codes = await loadStatusCodes(viewable);
  return viewable.map((r) => ({ ...r, statusCode: statusOf(codes, r) }));
}

function matchHref(r: { homeTeam: string | null; awayTeam: string | null; kickoff: Date | null }): string | null {
  const slug = matchSlug(r);
  return slug ? `/predictions/match/${slug}` : null;
}

export type RankedPick = { row: DashboardPick; reasons: ("team" | "league" | "market")[] };

/** Personal ranking, one pick per fixture, and a split into "matches your interests" and the rest. */
export function personalizePicks(rows: DashboardPick[], interests: Interests, now: Date = new Date()): { relevant: RankedPick[]; others: RankedPick[] } {
  const ranked = rankPersonalized(rows, interests, now);
  const taken = new Set<string>();
  const all: RankedPick[] = [];
  for (const r of ranked) {
    if (isFixtureTaken(r.row, taken)) continue;
    takeFixture(r.row, taken);
    all.push({ row: r.row, reasons: r.reasons });
  }
  if (!hasInterests(interests)) return { relevant: [], others: all };
  return { relevant: all.filter((r) => r.reasons.length > 0), others: all.filter((r) => r.reasons.length === 0) };
}

// ---------------------------------------------------------------------------
// Dashboard: upcoming fixtures
// ---------------------------------------------------------------------------

export async function upcomingForFavourites(state: PersonalizationState, now: Date = new Date()) {
  const teamIds = new Set(state.teams.map((t) => t.id));
  const leagueIds = new Set(state.leagues.map((l) => l.id));
  if (!teamIds.size && !leagueIds.size) return [];

  // Leagues whose cached fixture lists can contain a followed team's next match.
  const teamLeagues = teamIds.size
    ? await prisma.teamEnrichmentCache.findMany({ where: { teamApiId: { in: [...teamIds] }, leagueApiId: { not: null } }, select: { leagueApiId: true } })
    : [];
  const cacheLeagueIds = Array.from(new Set([...leagueIds, ...teamLeagues.map((t) => t.leagueApiId!).filter(Boolean)])).slice(0, 60);

  const horizon = new Date(now.getTime() + 21 * 86_400_000);
  const [caches, preds] = await Promise.all([
    cacheLeagueIds.length
      ? prisma.leagueEnrichmentCache.findMany({ where: { leagueApiId: { in: cacheLeagueIds }, fetchedAt: { not: null } }, select: { leagueApiId: true, upcomingJson: true } })
      : Promise.resolve([]),
    prisma.prediction.findMany({
      where: {
        status: "PUBLISHED",
        kickoff: { gte: new Date(now.getTime() - 86_400_000), lt: horizon },
        OR: [
          ...(teamIds.size ? [{ homeTeamApiId: { in: [...teamIds] } }, { awayTeamApiId: { in: [...teamIds] } }] : []),
          ...(leagueIds.size ? [{ leagueApiId: { in: [...leagueIds] } }] : []),
        ],
      },
      select: { homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, leagueApiId: true, leagueName: true, kickoff: true, fixtureApiId: true, outcome: true },
      orderBy: { kickoff: "asc" },
      take: 300,
    }),
  ]);

  const sources: UpcomingSource[] = [];
  for (const c of caches) {
    const list = Array.isArray(c.upcomingJson) ? (c.upcomingJson as unknown as LeagueUpcomingFixture[]) : [];
    for (const f of list) {
      const ids = upcomingTeamIds(f);
      sources.push({ fixtureApiId: f.id, homeTeam: f.homeTeam, awayTeam: f.awayTeam, homeTeamApiId: ids.home, awayTeamApiId: ids.away, leagueApiId: c.leagueApiId, leagueName: leagueNameFromCatalogue(c.leagueApiId), kickoff: f.date });
    }
  }
  for (const p of preds) {
    if (!p.homeTeam || !p.awayTeam || !p.kickoff) continue;
    sources.push({ ...p, homeTeam: p.homeTeam, awayTeam: p.awayTeam, kickoff: p.kickoff, predictionHref: matchHref(p) });
  }
  return buildUpcoming(sources, teamIds, leagueIds, now);
}

// ---------------------------------------------------------------------------
// Saved predictions
// ---------------------------------------------------------------------------

export class SaveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Bookmark a prediction. Only a PUBLISHED pick the viewer can currently read
 * may be saved — saving is not a way round the paywall, and the snapshot it
 * writes must be something they were entitled to see. Idempotent: a repeat
 * (double click, retry) returns the existing bookmark.
 */
export async function savePrediction(userId: string, predictionId: string, viewer: Entitlement) {
  const p = await prisma.prediction.findFirst({
    where: { id: predictionId, status: "PUBLISHED" },
    select: { ...PICK_SELECT, selection: true },
  });
  if (!p) throw new SaveError("Prediction not found", 404);
  const presented = presentedCategory(p.category, p.categories);
  if (!canViewCategory(presented, viewer.tier, viewer.status, viewer.role)) throw new SaveError("Upgrade to save this prediction", 403);

  const existing = await prisma.savedPrediction.findUnique({ where: { userId_predictionId: { userId, predictionId } } });
  if (existing) return { saved: existing, created: false };
  const count = await prisma.savedPrediction.count({ where: { userId } });
  if (count >= LIMITS.saved) throw new SaveError(`You can keep up to ${LIMITS.saved} saved predictions. Remove some to save more.`, 409);

  try {
    const saved = await prisma.savedPrediction.create({
      data: {
        userId,
        predictionId,
        category: presented,
        marketType: p.marketType,
        selection: p.selection ?? Prisma.JsonNull,
        market: p.market,
        pick: p.pick,
        odds: p.odds,
        confidence: p.confidence,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        homeTeamApiId: p.homeTeamApiId,
        awayTeamApiId: p.awayTeamApiId,
        leagueApiId: p.leagueApiId,
        leagueName: p.leagueName,
        kickoff: p.kickoff,
      },
    });
    return { saved, created: true };
  } catch (e) {
    // Two concurrent saves: the unique key let one through; return it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const saved = await prisma.savedPrediction.findUnique({ where: { userId_predictionId: { userId, predictionId } } });
      if (saved) return { saved, created: false };
    }
    throw e;
  }
}

/** Remove by prediction id or by bookmark id; always scoped to the owner, so another user's id simply matches nothing. */
export async function unsavePrediction(userId: string, ref: { predictionId?: string; savedId?: string }): Promise<number> {
  if (!ref.predictionId && !ref.savedId) return 0;
  const r = await prisma.savedPrediction.deleteMany({
    where: { userId, ...(ref.predictionId ? { predictionId: ref.predictionId } : {}), ...(ref.savedId ? { id: ref.savedId } : {}) },
  });
  return r.count;
}

export async function savedPredictionIds(userId: string): Promise<string[]> {
  const rows = await prisma.savedPrediction.findMany({ where: { userId, predictionId: { not: null } }, select: { predictionId: true }, orderBy: { createdAt: "desc" }, take: LIMITS.saved });
  return rows.map((r) => r.predictionId!).filter(Boolean);
}

const SAVED_INCLUDE = {
  prediction: {
    select: {
      status: true,
      category: true,
      categories: { select: { category: true } },
      marketType: true,
      selection: true,
      pick: true,
      outcome: true,
      finalHomeScore: true,
      finalAwayScore: true,
      kickoff: true,
      settledAt: true,
      homeTeam: true,
      awayTeam: true,
    },
  },
} satisfies Prisma.SavedPredictionInclude;

type SavedRecord = Prisma.SavedPredictionGetPayload<{ include: typeof SAVED_INCLUDE }>;

export type SavedItem = {
  id: string;
  predictionId: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  leagueApiId: number | null;
  leagueName: string | null;
  kickoff: Date | null;
  settledAt: Date | null;
  savedAt: Date;
  category: string;
  /** Null when locked: never sent to the page for a reader who cannot view it. */
  market: string | null;
  pick: string | null;
  odds: number | null;
  confidence: number | null;
  href: string | null;
  view: SavedView;
  /** Provider status from the captured result record, when one exists (a public fact, not part of the pick). */
  statusCode: string | null;
};

/**
 * Shape a bookmark for display. The access decision uses the LIVE row's
 * categories when it exists (a pick that has since become paid-only locks),
 * and the snapshot's category otherwise. A locked item carries no market,
 * pick, odds or confidence at all — they are dropped here, server-side, so
 * nothing restricted reaches the client.
 */
export function toSavedItem(s: SavedRecord, viewer: Entitlement, now: Date = new Date(), statusCode: string | null = null): SavedItem {
  const live = s.prediction;
  const category = live ? presentedCategory(live.category, live.categories) : (s.category as PredictionCategory);
  const canView = canViewCategory(category, viewer.tier, viewer.status, viewer.role);
  const view = savedPredictionView(
    { category: s.category, marketType: s.marketType, selection: s.selection, market: s.market, pick: s.pick, odds: s.odds, confidence: s.confidence, kickoff: s.kickoff },
    live ? { status: live.status, marketType: live.marketType, selection: live.selection, pick: live.pick, outcome: live.outcome, finalHomeScore: live.finalHomeScore, finalAwayScore: live.finalAwayScore, kickoff: live.kickoff } : null,
    canView,
    now,
    statusCode,
  );
  const href = live ? matchHref({ homeTeam: live.homeTeam, awayTeam: live.awayTeam, kickoff: live.kickoff }) : null;
  return {
    id: s.id,
    predictionId: s.predictionId,
    homeTeam: s.homeTeam,
    awayTeam: s.awayTeam,
    homeTeamApiId: s.homeTeamApiId,
    awayTeamApiId: s.awayTeamApiId,
    leagueApiId: s.leagueApiId,
    leagueName: s.leagueName,
    kickoff: live?.kickoff ?? s.kickoff,
    settledAt: live?.settledAt ?? null,
    savedAt: s.createdAt,
    statusCode,
    category,
    market: canView ? s.market : null,
    pick: canView ? s.pick : null,
    odds: canView ? s.odds : null,
    confidence: canView ? s.confidence : null,
    href,
    view,
  };
}

export const SAVED_PAGE_SIZE = 20;

/**
 * Every bookmark of one user, shaped and settled once.
 *
 * Filters, counts, ordering and the overview's highlights all derive from
 * these SavedView values — the same ones each row displays — rather than from
 * a SQL condition on the live prediction. A SQL filter on `prediction.outcome`
 * describes the LIVE pick, which after a rewrite is not the pick the reader
 * saved, so the list and the row could disagree. Bounded by LIMITS.saved
 * (500, enforced on save), so this is at most one indexed read per page.
 */
async function loadSavedItems(userId: string, viewer: Entitlement, now: Date): Promise<SavedItem[]> {
  const rows = await prisma.savedPrediction.findMany({
    where: { userId },
    include: SAVED_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIMITS.saved,
  });
  const codes = await loadStatusCodes(rows.map((r) => ({ homeTeamApiId: r.homeTeamApiId, awayTeamApiId: r.awayTeamApiId, kickoff: r.prediction?.kickoff ?? r.kickoff })));
  return rows.map((r) => toSavedItem(r, viewer, now, statusOf(codes, { homeTeamApiId: r.homeTeamApiId, awayTeamApiId: r.awayTeamApiId, kickoff: r.prediction?.kickoff ?? r.kickoff })));
}

export async function listSaved(userId: string, viewer: Entitlement, filter: SavedFilter, page: number, now: Date = new Date()) {
  const all = await loadSavedItems(userId, viewer, now);
  const matching = orderSaved(all.filter((i) => matchesSavedFilter(i.view, filter)), filter);
  const counts = Object.fromEntries(SAVED_FILTERS.map((f) => [f, all.filter((i) => matchesSavedFilter(i.view, f)).length])) as Record<SavedFilter, number>;
  return {
    items: matching.slice((page - 1) * SAVED_PAGE_SIZE, page * SAVED_PAGE_SIZE),
    total: matching.length,
    all: all.length,
    counts,
  };
}

/** For the overview: the next few saved picks to play and the latest few to settle — same views as /dashboard/saved. */
export async function savedHighlights(userId: string, viewer: Entitlement, now: Date = new Date()) {
  const all = await loadSavedItems(userId, viewer, now);
  return {
    upcoming: orderSaved(all.filter((i) => matchesSavedFilter(i.view, "upcoming")), "upcoming").slice(0, 4),
    settled: recentlySettled(all, 4),
    total: all.length,
  };
}

// Team/league enrichment cache — refreshed on a cron (see
// src/app/api/admin/refresh-enrichment/route.ts), read-only from pages (see
// getTeamEnrichment/getLeagueEnrichment in src/lib/predictionScope.ts). Pages
// never call the football API live; this module is the only writer.
//
// Scope is deliberately narrow: only teams/leagues referenced by real
// PUBLISHED predictions, not the whole football universe — mirrors the
// full-scan-then-dedupe-in-JS posture predictionScope.ts already uses at this
// data volume (see its file comment) rather than adding new indexes.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getTeamById,
  getTeamContext,
  getStandings,
  getFixturesByLeague,
  getFixturesByDate,
  getHeadToHead,
  getTopScorers,
  getTopAssists,
  getTopYellowCards,
  getSquad,
  getCoaches,
  resolveSeason,
  getOdds,
  type FixtureRow,
  type StandingsEntry,
  type StandingsSplit,
  type PlayerStatEntry,
  type CoachEntry,
} from "@/lib/football/api-football";
import { matchKey, kickoffDay, h2hPairKey } from "@/lib/slug";
import { leaguePriorityRank, LEAGUE_PRIORITY_ORDER } from "@/lib/leagues";
import { trimH2H } from "@/lib/h2h";
import { trimOdds } from "@/lib/odds";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { buildTeamDigest, type TeamDigest } from "@/lib/ai/digest";

export type TeamTarget = {
  teamApiId: number;
  teamName: string | null;
  leagueApiId: number | null;
  /** Kickoff used for season resolution. */
  kickoff: Date | null;
  /** Soonest FUTURE kickoff for this team, which is what the refresh priority tiers key on. Null when the team has no upcoming fixture. */
  nextKickoff?: Date | null;
};
export type LeagueTarget = { leagueApiId: number; kickoff: Date | null };
export type FixtureTarget = { matchKey: string; homeTeamApiId: number; awayTeamApiId: number; kickoffDay: string };
export type H2HTarget = { pairKey: string; teamAApiId: number; teamBApiId: number; latestKickoff: Date | null };

/** Meetings requested per pair. 10 covers both the "last 5" and "last 10" views the H2H page shows, in one call. */
export const H2H_FETCH_LAST = 10;

// Shapes stored in TeamEnrichmentCache/LeagueEnrichmentCache's Json columns —
// shared with the read side (TeamEnrichmentPanel/LeagueEnrichmentPanel) so
// both sides agree on what's actually in the cache without re-deriving it.
export type TeamStatsSummary = { played: number | null; win: number | null; draw: number | null; loss: number | null; goalsFor: number | null; goalsAgainst: number | null };
/**
 * `goalsFor`/`goalsAgainst` are the team's own goals in that fixture, and feed
 * the goal-difference half of the form rating (src/lib/form.ts). They're
 * optional because rows cached before this field existed don't carry them —
 * the rating degrades to results-only for those until the next refresh rather
 * than treating a missing score as 0-0.
 */
export type TeamFixtureSummary = {
  opponent: string;
  result: string;
  date: string;
  venue: "home" | "away";
  goalsFor?: number | null;
  goalsAgainst?: number | null;
};
/** Played/won/drawn/lost + goals for one split of a standings row. */
export type LeagueStandingSplit = { played: number; win: number; draw: number; loss: number; goalsFor: number; goalsAgainst: number };

/**
 * A standings row. The top-level played/win/... fields are the OVERALL split,
 * kept flat for backward compatibility with rows cached before the splits
 * existed; `home`/`away` are the same numbers restricted to matches played at
 * each venue.
 *
 * api-football returns all three in a single /standings response — the Home
 * and Away views cost no extra call. They're optional only because rows cached
 * before this field was added don't carry them, in which case the league page
 * offers Overall alone rather than empty tables.
 */
export type LeagueStandingRow = {
  rank: number;
  teamId: number;
  teamName: string;
  teamLogo: string | null;
  points: number;
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  form: string | null;
  home?: LeagueStandingSplit | null;
  away?: LeagueStandingSplit | null;
  /**
   * The competition's own label for this position — "Relegation", "Promotion -
   * Champions League (League phase)". Comes off the same /standings response as
   * everything else here, so it costs nothing, and it is what lets the match
   * page say what is at stake without inferring it from rank arithmetic (which
   * would need per-competition rules this app doesn't have).
   *
   * Null for mid-table rows, which is itself meaningful: no label means nothing
   * is at stake there. Optional because rows cached before this field don't
   * carry it.
   */
  zone?: string | null;
};
export type LeagueUpcomingFixture = { id: number; date: string; homeTeam: string; awayTeam: string; homeLogo: string | null; awayLogo: string | null };
/**
 * Shape stored in FixtureDetailCache.detailJson — only fields that exist
 * nowhere else in the app. Team names come from Prediction and crests from
 * TeamEnrichmentCache, so neither is duplicated here; nor is score/status,
 * which is read live (see the model comment in schema.prisma).
 */
export type FixtureDetail = { venue: string | null; city: string | null; referee: string | null; round: string | null };

/** A squad member. Deliberately no stats — listing a squad is the scope, player profiles are not. */
export type SquadPlayer = { id: number; name: string; age: number | null; number: number | null; position: string | null; photo: string | null };

/** `since` is null when the record exists but its start date isn't trustworthy enough to assert — see resolveCurrentCoach. */
export type TeamCoach = { name: string; nationality: string | null; since: string | null };

/**
 * Squads and coaches change on a transfer-window timescale, so they get a
 * 7-day TTL and their own squadFetchedAt rather than riding the 3-hourly
 * team refresh. Two calls per team, and the cost scales with TEAM count, not
 * league count.
 */
const SQUAD_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * A tenure this old is treated as an unclosed record rather than a real spell.
 * Set deliberately high: Simeone has been open at Atlético since 2011 (a
 * genuine 15-year tenure), so any threshold tight enough to catch a decade-old
 * stale record would suppress real ones. Length alone is a weak signal —
 * `contradicted` below does most of the work.
 */
const IMPLAUSIBLE_TENURE_MS = 20 * 365 * 24 * 60 * 60_000;

/**
 * Picks the current coach out of everything /coachs returns for a team.
 *
 * Two rules, both learned from the live data rather than assumed:
 *
 * 1. Take the open spell (`end: null`) at THIS team with the LATEST start.
 *    Never index [0] — that returns Ljungberg for Arsenal, Xavi for Barcelona
 *    and Mihajlović for Bologna. Ordering by start date is what fixes those.
 *
 * 2. Suppress the start date when the records contradict themselves. Ordabasy
 *    has THREE simultaneously-open spells (2016, 2024, 2025) and Kairat four —
 *    api-football simply never closed the old ones. The latest is very likely
 *    the incumbent, but its date can't be asserted alongside two others that
 *    claim to be equally current, so the name is shown without a "since".
 *
 * Returns null when nothing has an open spell here (Bologna, Cagliari), which
 * the page renders as "no current coach on record" rather than guessing.
 */
export function resolveCurrentCoach(list: CoachEntry[] | null, teamApiId: number): TeamCoach | null {
  if (!list?.length) return null;

  const open = list
    .map((c) => {
      const spell = (c.career ?? [])
        .filter((k) => k.team?.id === teamApiId && !k.end && k.start)
        .sort((a, b) => (a.start! < b.start! ? 1 : -1))[0];
      return spell ? { coach: c, start: spell.start! } : null;
    })
    .filter((x): x is { coach: CoachEntry; start: string } => x !== null)
    .sort((a, b) => (a.start < b.start ? 1 : -1));

  if (open.length === 0) return null;

  const best = open[0];
  const contradicted = open.length > 1;
  const tooOld = Date.now() - new Date(best.start).getTime() > IMPLAUSIBLE_TENURE_MS;

  return {
    name: best.coach.name,
    nationality: best.coach.nationality ?? null,
    since: contradicted || tooOld ? null : best.start,
  };
}

/** Squad rows, trimmed to the listing fields and ordered by shirt number (unnumbered last). */
export function trimSquad(rows: Array<{ players: SquadEntryLike[] }> | null): SquadPlayer[] {
  const players = rows?.[0]?.players ?? [];
  return players
    .map((p) => ({
      id: p.id,
      name: p.name,
      age: p.age ?? null,
      number: p.number ?? null,
      position: p.position ?? null,
      photo: p.photo ?? null,
    }))
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
}
type SquadEntryLike = { id: number; name: string; age?: number | null; number?: number | null; position?: string | null; photo?: string | null };

/** Teams whose squad/coach cache is older than the 7-day TTL, stalest first. */
export async function selectStaleSquadTargets(targets: TeamTarget[]): Promise<TeamTarget[]> {
  const existing = await prisma.teamEnrichmentCache.findMany({
    where: { teamApiId: { in: targets.map((t) => t.teamApiId) } },
    select: { teamApiId: true, squadFetchedAt: true },
  });
  const byId = new Map(existing.map((r) => [r.teamApiId, r.squadFetchedAt]));
  const cutoff = Date.now() - SQUAD_TTL_MS;
  return targets
    .filter((t) => {
      const at = byId.get(t.teamApiId);
      return !at || at.getTime() < cutoff;
    })
    .sort((a, b) => (byId.get(a.teamApiId)?.getTime() ?? -Infinity) - (byId.get(b.teamApiId)?.getTime() ?? -Infinity));
}

/**
 * Refresh one team's squad and coach — two calls, both through the same
 * apiFetch that enforces the daily quota gate and the request throttle, so
 * this pass is budgeted exactly like every other enrichment call.
 *
 * squadFetchedAt is set whenever the calls succeed, including when the coach
 * doesn't resolve: "no current coach on record" is a real answer, the same
 * rule H2H needed for "never met". Only an outright failure of both calls
 * leaves prior data untouched.
 */
export async function refreshTeamSquad(target: TeamTarget): Promise<{ teamApiId: number; result: "ok" | "failed" | "error"; detail?: string }> {
  const now = new Date();
  try {
    const [squadRaw, coachRaw] = await Promise.all([getSquad(target.teamApiId), getCoaches(target.teamApiId)]);

    if (squadRaw == null && coachRaw == null) {
      const lastError = "No response from /players/squads or /coachs — see server logs";
      await prisma.teamEnrichmentCache.upsert({
        where: { teamApiId: target.teamApiId },
        create: { teamApiId: target.teamApiId, teamName: target.teamName, lastAttemptAt: now, lastError },
        update: { lastAttemptAt: now, lastError },
      });
      return { teamApiId: target.teamApiId, result: "failed" };
    }

    const squad = trimSquad(squadRaw);
    const coach = resolveCurrentCoach(coachRaw, target.teamApiId);

    await prisma.teamEnrichmentCache.upsert({
      where: { teamApiId: target.teamApiId },
      create: { teamApiId: target.teamApiId, teamName: target.teamName, squadJson: squad, coachJson: coach ?? undefined, squadFetchedAt: now, lastAttemptAt: now },
      update: { squadJson: squad, coachJson: coach ?? Prisma.DbNull, squadFetchedAt: now, lastAttemptAt: now },
    });
    return { teamApiId: target.teamApiId, result: "ok", detail: `${squad.length} players, coach ${coach ? coach.name : "unresolved"}` };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await prisma.teamEnrichmentCache
      .upsert({ where: { teamApiId: target.teamApiId }, create: { teamApiId: target.teamApiId, teamName: target.teamName, lastAttemptAt: now, lastError: message }, update: { lastAttemptAt: now, lastError: message } })
      .catch(() => {});
    return { teamApiId: target.teamApiId, result: "error", detail: message };
  }
}

/** Distinct team ids referenced by PUBLISHED predictions, each paired with the most recent row's league/kickoff (for season resolution). */
export async function getScopedTeamTargets(): Promise<TeamTarget[]> {
  // Scope is every team with a prediction that still matters, not just
  // PUBLISHED ones. A fixture sitting in PENDING_REVIEW needs warm caches
  // BEFORE it is reviewed and published, and a fixture the generator is about
  // to pick up needs them before generation — refreshing only after publication
  // meant the data was always one step behind the page that renders it.
  const [rows, pending] = await Promise.all([
    prisma.prediction.findMany({
      where: {
        status: { in: ["PUBLISHED", "APPROVED", "PENDING_REVIEW"] },
        OR: [{ homeTeamApiId: { not: null } }, { awayTeamApiId: { not: null } }],
      },
      select: { homeTeamApiId: true, awayTeamApiId: true, homeTeam: true, awayTeam: true, leagueApiId: true, kickoff: true },
      orderBy: { publishedAt: "desc" },
    }),
    prisma.generationAttempt.findMany({
      where: { status: { in: ["PENDING", "FAILED"] }, kickoff: { gt: new Date() } },
      select: { homeTeam: true, awayTeam: true, leagueApiId: true, kickoff: true, matchKey: true },
    }),
  ]);

  const now = Date.now();
  const byId = new Map<number, TeamTarget>();

  const note = (apiId: number | null, name: string | null, leagueApiId: number | null, kickoff: Date | null) => {
    if (apiId == null) return;
    const existing = byId.get(apiId);
    // The soonest future kickoff wins — that is what the priority tiers read.
    const future = kickoff && kickoff.getTime() > now ? kickoff : null;
    if (!existing) {
      byId.set(apiId, { teamApiId: apiId, teamName: name, leagueApiId, kickoff, nextKickoff: future });
      return;
    }
    if (future && (!existing.nextKickoff || future < existing.nextKickoff)) {
      existing.nextKickoff = future;
      existing.kickoff = kickoff;
      existing.leagueApiId = existing.leagueApiId ?? leagueApiId;
    }
  };

  for (const r of rows) {
    note(r.homeTeamApiId, r.homeTeam, r.leagueApiId, r.kickoff);
    note(r.awayTeamApiId, r.awayTeam, r.leagueApiId, r.kickoff);
  }
  // Attempt rows carry team ids inside the matchKey ("home-away-day"), which is
  // the only place they exist on that table.
  for (const a of pending) {
    const [home, away] = a.matchKey.split("-");
    note(Number(home), a.homeTeam, a.leagueApiId, a.kickoff);
    note(Number(away), a.awayTeam, a.leagueApiId, a.kickoff);
  }

  return [...byId.values()].filter((t) => Number.isFinite(t.teamApiId));
}

/**
 * Refresh priority tiers, by how soon the team next plays.
 *
 * Pure staleness ordering treats a team playing in two hours identically to one
 * playing next Saturday, so at volume the imminent fixture waits behind a queue
 * of teams whose data nobody needs yet. Tiering by kickoff proximity fixes that
 * and — because far-off teams stop being refreshed every cycle — actually
 * reduces total api-football calls rather than adding to them.
 *
 * Team news is the field that moves fastest and matters most close to kickoff,
 * which is why Tier A is tight.
 */
export const REFRESH_TIERS = [
  { name: "A", withinHours: 24, maxAgeMs: 3 * 60 * 60_000 },
  { name: "B", withinHours: 72, maxAgeMs: 12 * 60 * 60_000 },
  { name: "C", withinHours: Infinity, maxAgeMs: 48 * 60 * 60_000 },
] as const;

export function tierFor(nextKickoff: Date | null | undefined, now: Date = new Date()): (typeof REFRESH_TIERS)[number] | null {
  // No upcoming fixture: nothing on the site is about to render this team's
  // data, so it is not refreshed at all until one appears.
  if (!nextKickoff) return null;
  const hours = (nextKickoff.getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) return null;
  return REFRESH_TIERS.find((t) => hours <= t.withinHours) ?? null;
}

/**
 * Teams due a refresh, most urgent first.
 *
 * A team is due when its cache is older than its tier's tolerance; teams inside
 * tolerance are skipped entirely rather than ordered last, which is where the
 * call saving comes from. Within the due set, ordering is by tier then by
 * staleness, so the soonest kickoff is always served first.
 */
export async function orderTeamsByPriority(targets: TeamTarget[], now: Date = new Date()): Promise<TeamTarget[]> {
  const existing = await prisma.teamEnrichmentCache.findMany({
    where: { teamApiId: { in: targets.map((t) => t.teamApiId) } },
    select: { teamApiId: true, lastAttemptAt: true, fetchedAt: true },
  });
  const byId = new Map(existing.map((r) => [r.teamApiId, r]));

  const due: Array<{ target: TeamTarget; tierIndex: number; age: number }> = [];
  for (const target of targets) {
    const tier = tierFor(target.nextKickoff, now);
    if (!tier) continue;
    const row = byId.get(target.teamApiId);
    const fetchedAt = row?.fetchedAt?.getTime() ?? null;
    const age = fetchedAt === null ? Infinity : now.getTime() - fetchedAt;
    if (age < tier.maxAgeMs) continue;
    due.push({ target, tierIndex: REFRESH_TIERS.indexOf(tier), age });
  }

  due.sort((a, b) => a.tierIndex - b.tierIndex || b.age - a.age);
  return due.map((d) => d.target);
}

/** Distinct league ids referenced by PUBLISHED predictions, each paired with the most recent row's kickoff (for season resolution). */
export async function getScopedLeagueTargets(): Promise<LeagueTarget[]> {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", leagueApiId: { not: null } },
    select: { leagueApiId: true, kickoff: true },
    orderBy: { publishedAt: "desc" },
  });
  const byId = new Map<number, LeagueTarget>();
  for (const r of rows) {
    if (!byId.has(r.leagueApiId!)) byId.set(r.leagueApiId!, { leagueApiId: r.leagueApiId!, kickoff: r.kickoff });
  }
  return [...byId.values()];
}

/**
 * Distinct fixtures referenced by PUBLISHED predictions, keyed by matchKey —
 * the same identity /predictions/match/[slug] resolves against, so everything
 * this returns backs a page a reader can actually reach. Rows missing a team
 * id or kickoff have no matchKey and are skipped (see matchKey's comment).
 */
export async function getScopedFixtureTargets(): Promise<FixtureTarget[]> {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", homeTeamApiId: { not: null }, awayTeamApiId: { not: null }, kickoff: { not: null } },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
    orderBy: { publishedAt: "desc" },
  });
  const byKey = new Map<string, FixtureTarget>();
  for (const r of rows) {
    const key = matchKey(r);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      matchKey: key,
      homeTeamApiId: r.homeTeamApiId!,
      awayTeamApiId: r.awayTeamApiId!,
      kickoffDay: kickoffDay(r.kickoff!),
    });
  }
  return [...byKey.values()];
}

/**
 * Refresh every target falling on one UTC day with a SINGLE api-football call.
 *
 * /fixtures?date= returns that day's whole slate, so one call covers all of
 * that day's targets no matter how many there are — the reason this refresh is
 * batched by date rather than run per fixture like the team/league ones. A
 * per-fixture lookup would cost one call each and there's no endpoint that
 * takes our identity (two team ids + a day) directly anyway.
 *
 * Same write invariants as refreshTeamCache: fetchedAt and detailJson are only
 * touched on a real hit. A target the slate doesn't contain (wrong day, or a
 * team id that no longer resolves) records lastError and keeps whatever was
 * cached before.
 */
export async function refreshFixtureDetailsForDay(
  day: string,
  targets: FixtureTarget[],
): Promise<{ matchKey: string; result: "ok" | "failed" | "error"; detail?: string }[]> {
  const now = new Date();
  const results: { matchKey: string; result: "ok" | "failed" | "error"; detail?: string }[] = [];

  let slate: FixtureRow[] | null = null;
  let fetchError: string | null = null;
  try {
    slate = await getFixturesByDate(day);
  } catch (err: any) {
    fetchError = err?.message ?? String(err);
  }

  for (const t of targets) {
    const base = { matchKey: t.matchKey, homeTeamApiId: t.homeTeamApiId, awayTeamApiId: t.awayTeamApiId, kickoffDay: t.kickoffDay };
    const found = slate?.find((f) => f.teams.home.id === t.homeTeamApiId && f.teams.away.id === t.awayTeamApiId) ?? null;

    if (!found) {
      const lastError = fetchError ?? (slate ? "Fixture not present in that day's api-football slate" : "No slate returned — see server logs for the underlying api-football error");
      await prisma.fixtureDetailCache
        .upsert({ where: { matchKey: t.matchKey }, create: { ...base, lastAttemptAt: now, lastError }, update: { lastAttemptAt: now, lastError } })
        .catch(() => {});
      results.push({ matchKey: t.matchKey, result: fetchError ? "error" : "failed", detail: fetchError ?? undefined });
      continue;
    }

    const detail: FixtureDetail = {
      venue: found.fixture.venue?.name ?? null,
      city: found.fixture.venue?.city ?? null,
      referee: found.fixture.referee ?? null,
      round: found.league.round ?? null,
    };
    await prisma.fixtureDetailCache.upsert({
      where: { matchKey: t.matchKey },
      create: { ...base, fixtureApiId: found.fixture.id, detailJson: detail, fetchedAt: now, lastAttemptAt: now, lastError: null },
      update: { fixtureApiId: found.fixture.id, detailJson: detail, fetchedAt: now, lastAttemptAt: now, lastError: null },
    });
    results.push({ matchKey: t.matchKey, result: "ok" });
  }

  return results;
}

/**
 * Distinct team PAIRS referenced by PUBLISHED predictions, keyed by
 * h2hPairKey. `latestKickoff` is the most recent kickoff we hold for the pair
 * — what makes staleness decidable without spending a call (see
 * selectStaleH2HTargets).
 */
export async function getScopedH2HTargets(): Promise<H2HTarget[]> {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", homeTeamApiId: { not: null }, awayTeamApiId: { not: null } },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });
  const byPair = new Map<string, H2HTarget>();
  for (const r of rows) {
    const pairKey = h2hPairKey(r.homeTeamApiId, r.awayTeamApiId);
    if (!pairKey) continue;
    const [lo, hi] = pairKey.split("-").map(Number);
    const existing = byPair.get(pairKey);
    if (!existing) {
      byPair.set(pairKey, { pairKey, teamAApiId: lo, teamBApiId: hi, latestKickoff: r.kickoff });
    } else if (r.kickoff && (!existing.latestKickoff || r.kickoff > existing.latestKickoff)) {
      existing.latestKickoff = r.kickoff;
    }
  }
  return [...byPair.values()];
}

/**
 * The targets actually worth spending a call on, newest-need first.
 *
 * A head-to-head record only changes when the two teams play each other again,
 * so a pair whose cache was fetched AFTER the latest kickoff we hold for it is
 * already current and is skipped entirely — this is what keeps the H2H pass
 * from re-fetching the same unchanged records every cycle. Never-fetched pairs
 * come first, then those whose latest meeting post-dates their cache.
 */
export async function selectStaleH2HTargets(targets: H2HTarget[]): Promise<H2HTarget[]> {
  const existing = await prisma.h2HCache.findMany({
    where: { pairKey: { in: targets.map((t) => t.pairKey) } },
    select: { pairKey: true, fetchedAt: true, lastAttemptAt: true },
  });
  const byKey = new Map(existing.map((r) => [r.pairKey, r]));

  return targets
    .filter((t) => {
      const row = byKey.get(t.pairKey);
      if (!row?.fetchedAt) return true; // never successfully fetched
      return t.latestKickoff != null && t.latestKickoff > row.fetchedAt;
    })
    .sort((a, b) => {
      const aAt = byKey.get(a.pairKey)?.lastAttemptAt?.getTime() ?? -Infinity;
      const bAt = byKey.get(b.pairKey)?.lastAttemptAt?.getTime() ?? -Infinity;
      return aAt - bAt;
    });
}

/**
 * Refresh one pair's head-to-head. Costs a single api-football call.
 *
 * Same write invariants as the other refreshes, with one difference worth
 * naming: an EMPTY meeting list is a success, not a failure. "These two have
 * never met" is a real answer the page needs to distinguish from "not fetched
 * yet", so it sets fetchedAt with an empty array. Only a null response — the
 * call itself failing — is treated as a failure that leaves prior data alone.
 */
export async function refreshH2HCache(target: H2HTarget): Promise<{ pairKey: string; result: "ok" | "failed" | "error"; meetings?: number; detail?: string }> {
  const now = new Date();
  const base = { pairKey: target.pairKey, teamAApiId: target.teamAApiId, teamBApiId: target.teamBApiId };
  try {
    const raw = await getHeadToHead(target.teamAApiId, target.teamBApiId, H2H_FETCH_LAST);

    if (raw == null) {
      const lastError = "No response — see server logs for the underlying api-football error";
      await prisma.h2HCache.upsert({
        where: { pairKey: target.pairKey },
        create: { ...base, lastAttemptAt: now, lastError },
        update: { lastAttemptAt: now, lastError },
      });
      return { pairKey: target.pairKey, result: "failed" };
    }

    const meetings = trimH2H(raw);
    await prisma.h2HCache.upsert({
      where: { pairKey: target.pairKey },
      create: { ...base, meetingsJson: meetings, fetchedAt: now, lastAttemptAt: now, lastError: null },
      update: { meetingsJson: meetings, fetchedAt: now, lastAttemptAt: now, lastError: null },
    });
    return { pairKey: target.pairKey, result: "ok", meetings: meetings.length };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await prisma.h2HCache
      .upsert({ where: { pairKey: target.pairKey }, create: { ...base, lastAttemptAt: now, lastError: message }, update: { lastAttemptAt: now, lastError: message } })
      .catch(() => {});
    return { pairKey: target.pairKey, result: "error", detail: message };
  }
}

function trimStatistics(statistics: any): TeamStatsSummary | null {
  if (!statistics) return null;
  return {
    played: statistics.fixtures?.played?.total ?? null,
    win: statistics.fixtures?.wins?.total ?? null,
    draw: statistics.fixtures?.draws?.total ?? null,
    loss: statistics.fixtures?.loses?.total ?? null,
    goalsFor: statistics.goals?.for?.total?.total ?? null,
    goalsAgainst: statistics.goals?.against?.total?.total ?? null,
  };
}

function trimLastFixtures(teamApiId: number, fixtures: FixtureRow[] | null): TeamFixtureSummary[] | null {
  if (!fixtures?.length) return null;
  return fixtures.map((f) => {
    const isHome = f.teams.home.id === teamApiId;
    const own = isHome ? f.goals.home : f.goals.away;
    const opp = isHome ? f.goals.away : f.goals.home;
    const result = own == null || opp == null ? "?" : own > opp ? "W" : own < opp ? "L" : "D";
    return {
      opponent: isHome ? f.teams.away.name : f.teams.home.name,
      result,
      date: f.fixture.date,
      venue: isHome ? "home" : "away",
      goalsFor: own ?? null,
      goalsAgainst: opp ?? null,
    };
  });
}

/**
 * Refresh one team's cache row. On any usable data, sets fetchedAt + the data
 * columns. On nothing usable (incl. today's expected free-plan rejection),
 * only lastAttemptAt/lastError are written — fetchedAt and prior data columns
 * are left untouched so a transient failure can't blank out a previously-good
 * cache entry.
 */
export async function refreshTeamCache(target: TeamTarget): Promise<{ teamApiId: number; result: "ok" | "failed" | "error"; detail?: string }> {
  const now = new Date();
  try {
    const season = target.leagueApiId ? await resolveSeason(target.leagueApiId, target.kickoff ?? new Date()) : new Date().getFullYear();

    const [teamInfo, context] = await Promise.all([
      getTeamById(target.teamApiId),
      target.leagueApiId ? getTeamContext(target.teamApiId, target.leagueApiId, season) : Promise.resolve(null),
    ]);

    const form = typeof context?.statistics === "object" && context.statistics ? ((context.statistics as any).form ?? null) : null;
    const statsJson = trimStatistics(context?.statistics);
    const lastFixtures = trimLastFixtures(target.teamApiId, context?.lastFixtures ?? null);
    // The same projection the AI prompt is built from. /injuries was already
    // being fetched by getTeamContext above and discarded — this is where it
    // stops being discarded, at no extra api-football cost.
    //
    // statsJson/lastFixtures/form are still written beside it: the team and
    // league pages read those today, and rewriting every reader is not what
    // this change is for. New readers prefer teamDigestJson.
    const teamDigest = context
      ? buildTeamDigest({
          name: target.teamName ?? String(target.teamApiId),
          apiId: target.teamApiId,
          statistics: context.statistics,
          injuries: context.injuries,
          lastFixtures: context.lastFixtures ?? null,
          // Standings are a league-level fetch, not part of this refresh — see
          // the column comment in schema.prisma. Readers merge rank/points from
          // LeagueEnrichmentCache.
          standingsRow: null,
        })
      : null;
    // Venue rides along on the /teams response that already produced the crest.
    // Written as explicit nulls when absent so a club that loses its venue
    // upstream doesn't keep showing a stale stadium.
    const venueFields = {
      venueName: teamInfo?.venue?.name ?? null,
      venueCity: teamInfo?.venue?.city ?? null,
      venueAddress: teamInfo?.venue?.address ?? null,
      venueCapacity: teamInfo?.venue?.capacity ?? null,
    };
    const succeeded = !!teamInfo || !!statsJson || !!lastFixtures || !!form;

    if (!succeeded) {
      await prisma.teamEnrichmentCache.upsert({
        where: { teamApiId: target.teamApiId },
        create: { teamApiId: target.teamApiId, teamName: target.teamName, leagueApiId: target.leagueApiId, lastAttemptAt: now, lastError: "No data returned — see server logs for the underlying api-football error" },
        update: { lastAttemptAt: now, lastError: "No data returned — see server logs for the underlying api-football error" },
      });
      return { teamApiId: target.teamApiId, result: "failed" };
    }

    await prisma.teamEnrichmentCache.upsert({
      where: { teamApiId: target.teamApiId },
      create: {
        teamApiId: target.teamApiId, teamName: target.teamName, leagueApiId: target.leagueApiId, season,
        crestUrl: teamInfo?.logo ?? null, ...venueFields, form, statsJson: statsJson ?? undefined, lastFixtures: lastFixtures ?? undefined,
        teamDigestJson: (teamDigest as unknown as Prisma.InputJsonValue) ?? undefined,
        fetchedAt: now, lastAttemptAt: now, lastError: null,
      },
      update: {
        teamName: target.teamName, leagueApiId: target.leagueApiId, season,
        crestUrl: teamInfo?.logo ?? null, ...venueFields, form, statsJson: statsJson ?? undefined, lastFixtures: lastFixtures ?? undefined,
        teamDigestJson: (teamDigest as unknown as Prisma.InputJsonValue) ?? undefined,
        fetchedAt: now, lastAttemptAt: now, lastError: null,
      },
    });
    return { teamApiId: target.teamApiId, result: "ok" };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await prisma.teamEnrichmentCache
      .upsert({
        where: { teamApiId: target.teamApiId },
        create: { teamApiId: target.teamApiId, teamName: target.teamName, leagueApiId: target.leagueApiId, lastAttemptAt: now, lastError: message },
        update: { lastAttemptAt: now, lastError: message },
      })
      .catch(() => {});
    return { teamApiId: target.teamApiId, result: "error", detail: message };
  }
}

/** One row of a league leaderboard, trimmed from the very large raw player payload to what a table shows. */
export type LeaguePlayerStat = {
  playerId: number;
  name: string;
  photo: string | null;
  teamId: number;
  teamName: string;
  teamLogo: string | null;
  /** The metric this leaderboard ranks by — goals, assists or yellow cards depending on the column it's stored in. */
  value: number;
  /** Carried on the cards board only, from the same payload — a second call for red-card leaders would buy nothing new. */
  redCards?: number;
  appearances: number | null;
  minutes: number | null;
};

/** How many rows of each leaderboard are kept. Beyond this is a full stats page, not a league-page section. */
const PLAYER_STAT_ROWS = 10;

/**
 * Trims a /players/top* response, dropping every entry whose metric is zero.
 *
 * That filter is doing real work, not tidying. Two observed cases produce
 * zero-valued rows that would otherwise render as a leaderboard:
 *   - Smaller leagues can return a degenerate current-season response — the
 *     Kazakh Premier League returns the same three players with goals=0 and
 *     yellow=0 for BOTH boards, despite its standings correctly showing 22
 *     matches played.
 *   - Early in a season the API pads the list; La Liga after one matchday
 *     returns twenty "top scorers" who are all on a single goal.
 * A leaderboard entry with none of the thing it ranks by is noise, so the
 * honest rendering of that response is an empty board, which the page reports
 * as "not available yet" rather than as data.
 */
export function trimPlayerStats(rows: PlayerStatEntry[] | null, metric: "goals" | "assists" | "yellow"): LeaguePlayerStat[] {
  if (!rows?.length) return [];
  return rows
    .map((r) => {
      const s = r.statistics?.[0];
      if (!s) return null;
      const value = metric === "goals" ? s.goals?.total : metric === "assists" ? s.goals?.assists : s.cards?.yellow;
      return {
        playerId: r.player.id,
        name: r.player.name,
        photo: r.player.photo ?? null,
        teamId: s.team.id,
        teamName: s.team.name,
        teamLogo: s.team.logo ?? null,
        value: value ?? 0,
        ...(metric === "yellow" ? { redCards: s.cards?.red ?? 0 } : {}),
        appearances: s.games?.appearences ?? null,
        minutes: s.games?.minutes ?? null,
      };
    })
    .filter((r): r is LeaguePlayerStat => r !== null && r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, PLAYER_STAT_ROWS);
}

/**
 * Player stats are refreshed at most this often, against the 3-hourly cadence
 * the rest of the enrichment runs at. They only change when matches are
 * played, so re-fetching three leaderboards per league every cycle would spend
 * ~128 calls a day to mostly rewrite identical rows.
 */
const PLAYER_STATS_TTL_MS = 12 * 60 * 60_000;

/** Leagues whose player leaderboards are stale enough to be worth three calls, stalest first. */
export async function selectStalePlayerStatLeagues(targets: LeagueTarget[]): Promise<LeagueTarget[]> {
  const existing = await prisma.leagueEnrichmentCache.findMany({
    where: { leagueApiId: { in: targets.map((t) => t.leagueApiId) } },
    select: { leagueApiId: true, playersFetchedAt: true },
  });
  const byId = new Map(existing.map((r) => [r.leagueApiId, r.playersFetchedAt]));
  const cutoff = Date.now() - PLAYER_STATS_TTL_MS;
  return targets
    .filter((t) => {
      const at = byId.get(t.leagueApiId);
      return !at || at.getTime() < cutoff;
    })
    .sort((a, b) => (byId.get(a.leagueApiId)?.getTime() ?? -Infinity) - (byId.get(b.leagueApiId)?.getTime() ?? -Infinity));
}

/**
 * Refresh one league's leaderboards — three calls (scorers, assists, yellow
 * cards; see getTopYellowCards on why red is not a fourth).
 *
 * `playersFetchedAt` is set whenever the calls SUCCEED, including when every
 * board trims to empty: "this season has no player stats yet" is a real
 * answer the page needs to distinguish from "never fetched", the same rule
 * H2H needed for "these two have never met". Only an outright API failure
 * (all three null) leaves it untouched so prior boards survive.
 */
export async function refreshLeaguePlayerStats(
  target: LeagueTarget,
): Promise<{ leagueApiId: number; result: "ok" | "failed" | "error"; counts?: string; detail?: string }> {
  const now = new Date();
  try {
    const season = await resolveSeason(target.leagueApiId, target.kickoff ?? new Date());
    const [scorersRaw, assistsRaw, cardsRaw] = await Promise.all([
      getTopScorers(target.leagueApiId, season),
      getTopAssists(target.leagueApiId, season),
      getTopYellowCards(target.leagueApiId, season),
    ]);

    if (scorersRaw == null && assistsRaw == null && cardsRaw == null) {
      const lastError = "No response from any /players/top* endpoint — see server logs";
      await prisma.leagueEnrichmentCache.upsert({
        where: { leagueApiId: target.leagueApiId },
        create: { leagueApiId: target.leagueApiId, season, lastAttemptAt: now, lastError },
        update: { lastAttemptAt: now, lastError },
      });
      return { leagueApiId: target.leagueApiId, result: "failed" };
    }

    const scorers = trimPlayerStats(scorersRaw, "goals");
    const assists = trimPlayerStats(assistsRaw, "assists");
    const cards = trimPlayerStats(cardsRaw, "yellow");

    await prisma.leagueEnrichmentCache.upsert({
      where: { leagueApiId: target.leagueApiId },
      create: { leagueApiId: target.leagueApiId, season, topScorersJson: scorers, topAssistsJson: assists, topCardsJson: cards, playersFetchedAt: now, lastAttemptAt: now },
      update: { season, topScorersJson: scorers, topAssistsJson: assists, topCardsJson: cards, playersFetchedAt: now, lastAttemptAt: now },
    });
    return { leagueApiId: target.leagueApiId, result: "ok", counts: `${scorers.length}s/${assists.length}a/${cards.length}c` };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await prisma.leagueEnrichmentCache
      .upsert({ where: { leagueApiId: target.leagueApiId }, create: { leagueApiId: target.leagueApiId, lastAttemptAt: now, lastError: message }, update: { lastAttemptAt: now, lastError: message } })
      .catch(() => {});
    return { leagueApiId: target.leagueApiId, result: "error", detail: message };
  }
}

function splitOf(split: StandingsSplit | undefined): LeagueStandingSplit | null {
  if (!split) return null;
  return {
    played: split.played,
    win: split.win,
    draw: split.draw,
    loss: split.lose,
    goalsFor: split.goals.for,
    goalsAgainst: split.goals.against,
  };
}

function trimStandings(standings: StandingsEntry[] | null): LeagueStandingRow[] | null {
  if (!standings?.length) return null;
  return standings.map((s) => ({
    rank: s.rank,
    teamId: s.team.id,
    teamName: s.team.name,
    teamLogo: s.team.logo ?? null,
    points: s.points,
    played: s.all.played,
    win: s.all.win,
    draw: s.all.draw,
    loss: s.all.lose,
    goalsFor: s.all.goals.for,
    goalsAgainst: s.all.goals.against,
    form: s.form ?? null,
    home: splitOf(s.home),
    away: splitOf(s.away),
    zone: s.description?.trim() || null,
  }));
}

function trimUpcoming(fixtures: FixtureRow[] | null): LeagueUpcomingFixture[] | null {
  if (!fixtures?.length) return null;
  return fixtures
    .filter((f) => f.fixture.status.short === "NS")
    .slice(0, 8)
    .map((f) => ({
      id: f.fixture.id,
      date: f.fixture.date,
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      homeLogo: f.teams.home.logo ?? null,
      awayLogo: f.teams.away.logo ?? null,
    }));
}

/** Same shape/invariants as refreshTeamCache — see its comment. */
export async function refreshLeagueCache(target: LeagueTarget): Promise<{ leagueApiId: number; result: "ok" | "failed" | "error"; detail?: string }> {
  const now = new Date();
  try {
    const season = await resolveSeason(target.leagueApiId, target.kickoff ?? new Date());
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [standingsRaw, fixturesRaw] = await Promise.all([
      getStandings(target.leagueApiId, season),
      getFixturesByLeague(target.leagueApiId, season, today, to),
    ]);

    const standingsJson = trimStandings(standingsRaw);
    const upcomingJson = trimUpcoming(fixturesRaw);
    const succeeded = !!standingsJson || !!upcomingJson;

    if (!succeeded) {
      await prisma.leagueEnrichmentCache.upsert({
        where: { leagueApiId: target.leagueApiId },
        create: { leagueApiId: target.leagueApiId, lastAttemptAt: now, lastError: "No data returned — see server logs for the underlying api-football error" },
        update: { lastAttemptAt: now, lastError: "No data returned — see server logs for the underlying api-football error" },
      });
      return { leagueApiId: target.leagueApiId, result: "failed" };
    }

    await prisma.leagueEnrichmentCache.upsert({
      where: { leagueApiId: target.leagueApiId },
      create: { leagueApiId: target.leagueApiId, season, standingsJson: standingsJson ?? undefined, upcomingJson: upcomingJson ?? undefined, fetchedAt: now, lastAttemptAt: now, lastError: null },
      update: { season, standingsJson: standingsJson ?? undefined, upcomingJson: upcomingJson ?? undefined, fetchedAt: now, lastAttemptAt: now, lastError: null },
    });
    return { leagueApiId: target.leagueApiId, result: "ok" };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await prisma.leagueEnrichmentCache
      .upsert({
        where: { leagueApiId: target.leagueApiId },
        create: { leagueApiId: target.leagueApiId, lastAttemptAt: now, lastError: message },
        update: { lastAttemptAt: now, lastError: message },
      })
      .catch(() => {});
    return { leagueApiId: target.leagueApiId, result: "error", detail: message };
  }
}

/** Orders scoped targets so never-attempted ids come first, then the stalest lastAttemptAt — round-robins across cycles if the scoped set ever exceeds one run's slice. */
export async function orderTeamsByStaleness(targets: TeamTarget[]): Promise<TeamTarget[]> {
  const existing = await prisma.teamEnrichmentCache.findMany({
    where: { teamApiId: { in: targets.map((t) => t.teamApiId) } },
    select: { teamApiId: true, lastAttemptAt: true },
  });
  const attemptMap = new Map(existing.map((r) => [r.teamApiId, r.lastAttemptAt?.getTime() ?? -Infinity]));
  return [...targets].sort((a, b) => (attemptMap.get(a.teamApiId) ?? -Infinity) - (attemptMap.get(b.teamApiId) ?? -Infinity));
}

/**
 * Groups fixture targets into per-day batches (the unit one api-football call
 * covers) and orders the batches never-attempted first, then stalest — same
 * round-robin intent as the team/league orderings, but the cost being spread
 * is one call per DAY rather than per item, so a day's batch is never split.
 * A day's staleness is that of its stalest member.
 */
export async function orderFixtureDaysByStaleness(targets: FixtureTarget[]): Promise<{ day: string; targets: FixtureTarget[] }[]> {
  const existing = await prisma.fixtureDetailCache.findMany({
    where: { matchKey: { in: targets.map((t) => t.matchKey) } },
    select: { matchKey: true, lastAttemptAt: true },
  });
  const attemptMap = new Map(existing.map((r) => [r.matchKey, r.lastAttemptAt?.getTime() ?? -Infinity]));

  const byDay = new Map<string, FixtureTarget[]>();
  for (const t of targets) {
    if (!byDay.has(t.kickoffDay)) byDay.set(t.kickoffDay, []);
    byDay.get(t.kickoffDay)!.push(t);
  }

  return [...byDay.entries()]
    .map(([day, dayTargets]) => ({
      day,
      targets: dayTargets,
      staleness: Math.min(...dayTargets.map((t) => attemptMap.get(t.matchKey) ?? -Infinity)),
    }))
    .sort((a, b) => a.staleness - b.staleness)
    .map(({ day, targets: dayTargets }) => ({ day, targets: dayTargets }));
}

export async function orderLeaguesByStaleness(targets: LeagueTarget[]): Promise<LeagueTarget[]> {
  const existing = await prisma.leagueEnrichmentCache.findMany({
    where: { leagueApiId: { in: targets.map((t) => t.leagueApiId) } },
    select: { leagueApiId: true, lastAttemptAt: true },
  });
  const attemptMap = new Map(existing.map((r) => [r.leagueApiId, r.lastAttemptAt?.getTime() ?? -Infinity]));
  return [...targets].sort((a, b) => (attemptMap.get(a.leagueApiId) ?? -Infinity) - (attemptMap.get(b.leagueApiId) ?? -Infinity));
}

// ---------------------------------------------------------------------------
// Bookmaker odds (FixtureOddsCache) — backs Bet of the Day.
// ---------------------------------------------------------------------------

export type OddsTarget = {
  matchKey: string;
  fixtureApiId: number;
  kickoff: Date;
  /**
   * "published" = a live pick a reader can see, so its price is re-checked
   * hourly near kickoff. "candidate" = an un-generated fixture priced once, so
   * price-first Bet of the Day targeting can decide whether it is worth
   * generating a bolder pick for. The distinction is what keeps the widened
   * scope cheap: candidates outnumber published picks and none of their prices
   * are ever shown to anyone.
   */
  kind: "published" | "candidate";
};

/**
 * Fixtures eligible for an odds refresh: TODAY's published predictions only,
 * still ahead of kickoff, whose fixture id FixtureDetailCache has already
 * resolved.
 *
 * Three deliberate narrowings, each one saving calls:
 *
 *   - Today only. Bet of the Day is a daily slot, so odds for a fixture three
 *     days out buy nothing, and the research measured coverage cratering past
 *     7 days anyway (13% hit rate) — those calls would mostly return nothing.
 *   - Not yet kicked off. A price for a match in progress is not actionable
 *     and settlement, not odds, is what a finished fixture needs.
 *   - Requires a cached fixtureApiId. /odds takes api-football's fixture id and
 *     nothing else; FixtureDetailCache already resolves that id from the day's
 *     slate, so reading it here keeps this workload at ONE call per fixture.
 *     A fixture the detail refresh hasn't reached yet is simply skipped — it
 *     will be eligible on the next cycle, which is cheaper than resolving the
 *     same id twice.
 */
export async function getScopedOddsTargets(now: Date = new Date()): Promise<OddsTarget[]> {
  const published = await getPublishedOddsTargets(now);
  const candidates = await getCandidateOddsTargets(now);
  // A fixture that is both published and still queued is a published target —
  // the stricter refresh cadence wins, and it must not be priced twice.
  const seen = new Set(published.map((t) => t.matchKey));
  return [...published, ...candidates.filter((c) => !seen.has(c.matchKey))];
}

/**
 * Un-generated fixtures in the generation window, for price-first Bet of the
 * Day targeting.
 *
 * Read straight off the GenerationAttempt ledger, which already carries
 * api-football's `fixtureApiId` — so unlike the published targets below, these
 * need no FixtureDetailCache lookup at all.
 *
 * Horizon is capped at ODDS_CANDIDATE_HORIZON_MS rather than following the
 * ledger, because pricing a fixture the research says has a 13% chance of
 * carrying odds is quota spent to re-confirm an empty response.
 *
 * Measured cost before this was added: a mean of 42.5 and a peak of 88 ranked-
 * league candidates entering the ledger per day, each priced ONCE (see
 * selectStaleOddsTargets) — about 1% of the 7,500/day ceiling.
 */
export const ODDS_CANDIDATE_HORIZON_MS = 72 * 60 * 60 * 1000;

export async function getCandidateOddsTargets(now: Date = new Date()): Promise<OddsTarget[]> {
  const rows = await prisma.generationAttempt.findMany({
    where: {
      status: "PENDING",
      kickoff: { gt: now, lte: new Date(now.getTime() + ODDS_CANDIDATE_HORIZON_MS) },
      fixtureApiId: { not: null },
      leagueApiId: { not: null },
    },
    select: { matchKey: true, fixtureApiId: true, leagueApiId: true, kickoff: true },
  });
  return rows
    // Only leagues the editorial ordering ranks can ever win the slot, so
    // pricing anything else would buy a number nothing reads.
    .filter((r) => leaguePriorityRank(r.leagueApiId) < LEAGUE_PRIORITY_ORDER.length)
    .map((r) => ({ matchKey: r.matchKey, fixtureApiId: r.fixtureApiId!, kickoff: r.kickoff, kind: "candidate" as const }));
}

async function getPublishedOddsTargets(now: Date = new Date()): Promise<OddsTarget[]> {
  const { start, end } = lagosTodayBounds(now);
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      kickoff: { gte: start, lt: end },
      homeTeamApiId: { not: null },
      awayTeamApiId: { not: null },
    },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });

  const byKey = new Map<string, { matchKey: string; kickoff: Date }>();
  for (const r of rows) {
    const key = matchKey(r);
    if (!key || byKey.has(key) || !r.kickoff || r.kickoff <= now) continue;
    byKey.set(key, { matchKey: key, kickoff: r.kickoff });
  }
  if (byKey.size === 0) return [];

  const details = await prisma.fixtureDetailCache.findMany({
    where: { matchKey: { in: [...byKey.keys()] }, fixtureApiId: { not: null } },
    select: { matchKey: true, fixtureApiId: true },
  });

  const targets: OddsTarget[] = [];
  for (const d of details) {
    const base = byKey.get(d.matchKey);
    if (base) targets.push({ matchKey: d.matchKey, fixtureApiId: d.fixtureApiId!, kickoff: base.kickoff, kind: "published" });
  }
  return targets;
}

/** Refresh interval inside 24h of kickoff — prices move as the market firms up. */
export const ODDS_NEAR_KICKOFF_TTL_MS = 60 * 60 * 1000;
/**
 * Back-off before retrying a fixture whose last odds fetch failed.
 *
 * Without this, a fixture no bookmaker has priced is retried on EVERY cycle
 * forever: `!fetchedAt` alone means "never succeeded", which is permanently
 * true for a fixture that never gets priced. Measured on a live run — two such
 * fixtures re-spent a call each on eight consecutive cycles and would have gone
 * on doing so all day.
 *
 * An hour is long enough to stop the leak and short enough that a market
 * opening late is picked up the same day.
 */
export const ODDS_FAILED_RETRY_MS = 60 * 60 * 1000;
/** Inside this window of kickoff, a fixture is refreshed hourly rather than once. */
export const ODDS_NEAR_KICKOFF_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Which targets are actually due, on the cadence the research justifies:
 * hourly inside 24h of kickoff, once beyond that.
 *
 * The asymmetry is measured, not assumed. Odds density is near-total inside
 * 72h (100% of sampled fixtures carried prices, 11-14 books deep) and collapses
 * past 7 days (13%, and thin where present), so a distant fixture re-polled
 * every hour spends quota re-confirming the same sparse answer. Inside a day of
 * kickoff the opposite is true: the book is deep, prices move, and a stale
 * quote is one a reader could act on wrongly.
 *
 * "Once beyond that" means once SUCCESSFULLY — a target whose last attempt
 * failed is still due, otherwise a single bad response would freeze a fixture
 * out of the slot for the rest of the day.
 */
export async function selectStaleOddsTargets(targets: OddsTarget[], now: Date = new Date()): Promise<OddsTarget[]> {
  if (targets.length === 0) return [];
  const existing = await prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: targets.map((t) => t.matchKey) } },
    select: { matchKey: true, fetchedAt: true, lastAttemptAt: true },
  });
  const byKey = new Map(existing.map((r) => [r.matchKey, r]));

  const due = targets.filter((t) => {
    const row = byKey.get(t.matchKey);
    if (!row?.fetchedAt) {
      // Never fetched, or every attempt so far failed. New targets are due
      // immediately; ones that already failed wait out the back-off rather than
      // re-spending a call on every cycle.
      if (!row?.lastAttemptAt) return true;
      return now.getTime() - row.lastAttemptAt.getTime() >= ODDS_FAILED_RETRY_MS;
    }
    // Candidates are priced ONCE. Their price is only ever read to decide
    // whether a fixture is worth generating a bolder pick for — a decision made
    // once — and no reader ever sees it, so re-polling them would be the whole
    // cost of the widened scope multiplied by 24 for no benefit.
    if (t.kind === "candidate") return false;
    const nearKickoff = t.kickoff.getTime() - now.getTime() <= ODDS_NEAR_KICKOFF_WINDOW_MS;
    if (!nearKickoff) return false;
    return now.getTime() - row.fetchedAt.getTime() >= ODDS_NEAR_KICKOFF_TTL_MS;
  });

  // Published picks first — a stale price in front of a reader matters more
  // than an unpriced candidate — then soonest kickoff.

  return due.sort(
    (a, b) =>
      Number(a.kind === "candidate") - Number(b.kind === "candidate") || a.kickoff.getTime() - b.kickoff.getTime(),
  );
}

/**
 * Fetch and store one fixture's odds.
 *
 * Same write invariants as every other refresh here: `fetchedAt` and
 * `oddsJson` are touched only on a real hit, so a failed cycle leaves the
 * previous prices readable rather than blanking the Bet of the Day slot.
 *
 * An empty response is recorded as a FAILURE rather than as an empty success,
 * which is the opposite of the choice H2HCache makes. The reasoning differs
 * because the fact differs: "these two have never met" is a real answer about
 * the world, whereas "no bookmaker has priced this yet" is a temporary state
 * that will change before kickoff — so it should stay due for another attempt,
 * not be cached as settled.
 */
export async function refreshOddsCache(target: OddsTarget): Promise<{ matchKey: string; result: "ok" | "failed" | "error"; detail?: string }> {
  const now = new Date();
  const base = { matchKey: target.matchKey, fixtureApiId: target.fixtureApiId };

  let raw: Awaited<ReturnType<typeof getOdds>> = null;
  try {
    raw = await getOdds(target.fixtureApiId);
  } catch (err: any) {
    const lastError = err?.message ?? String(err);
    await prisma.fixtureOddsCache
      .upsert({ where: { matchKey: target.matchKey }, create: { ...base, lastAttemptAt: now, lastError }, update: { lastAttemptAt: now, lastError } })
      .catch(() => {});
    return { matchKey: target.matchKey, result: "error", detail: lastError };
  }

  const trimmed = trimOdds(raw?.[0]);
  if (!trimmed) {
    const lastError = raw === null ? "No response from api-football — see server logs" : "No bookmaker prices quoted for this fixture yet";
    await prisma.fixtureOddsCache
      .upsert({ where: { matchKey: target.matchKey }, create: { ...base, lastAttemptAt: now, lastError }, update: { lastAttemptAt: now, lastError } })
      .catch(() => {});
    return { matchKey: target.matchKey, result: "failed", detail: lastError };
  }

  const payload = {
    ...base,
    oddsJson: trimmed as unknown as Prisma.InputJsonValue,
    bookmakerCount: trimmed.bookmakerCount,
    fetchedAt: now,
    lastAttemptAt: now,
    lastError: null,
  };
  await prisma.fixtureOddsCache.upsert({ where: { matchKey: target.matchKey }, create: payload, update: payload });
  return { matchKey: target.matchKey, result: "ok", detail: `${trimmed.bookmakerCount} bookmakers, ${trimmed.markets.length} markets` };
}

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";
import { competitionPredictionsHref } from "@/lib/cupConfig";
import { leagueSlug, matchSlug } from "@/lib/slug";
import { upcomingTeamIds, type LeagueStandingRow, type LeagueUpcomingFixture, type TeamCoach, type TeamFixtureSummary, type SquadPlayer } from "@/lib/enrichment";

/**
 * Everything the team page shows beyond its predictions, built only from what
 * the site already stores: the league caches (tables, upcoming fixtures), the
 * team cache (venue, coach, form, squad) and published predictions. No
 * api-football calls are made here; a section with nothing behind it is left
 * out rather than padded.
 */

export type TeamNextMatch = {
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date;
  leagueApiId: number | null;
  leagueName: string | null;
  /** The match page when a prediction is published for it; null otherwise. */
  href: string | null;
};

export type TeamCompetition = {
  leagueApiId: number;
  name: string;
  /** Null when nothing is published in that competition yet, so the link would land on an empty page. */
  href: string | null;
};

export type TeamStanding = { leagueApiId: number; leagueName: string; row: LeagueStandingRow; size: number };

export type TeamProfile = {
  nextMatch: TeamNextMatch | null;
  competitions: TeamCompetition[];
  standing: TeamStanding | null;
  country: string | null;
  flagCode: string | null;
};

/** How far back a prediction still counts as "this season" for the competitions list. */
const SEASON_LOOKBACK_MS = 120 * 24 * 60 * 60_000;

const catalogueById = new Map<number, (typeof LEAGUE_CATALOGUE)[number]>(LEAGUE_CATALOGUE.map((l) => [l.id, l]));

export const getTeamProfile = cache(async (teamApiId: number | null): Promise<TeamProfile | null> => {
  if (teamApiId == null) return null;
  const now = new Date();

  const [leagues, nextPredicted, seasonRows] = await Promise.all([
    prisma.leagueEnrichmentCache.findMany({
      where: { fetchedAt: { not: null } },
      select: { leagueApiId: true, standingsJson: true, upcomingJson: true },
    }),
    prisma.prediction.findFirst({
      where: { status: "PUBLISHED", kickoff: { gt: now }, OR: [{ homeTeamApiId: teamApiId }, { awayTeamApiId: teamApiId }] },
      orderBy: { kickoff: "asc" },
      select: { homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, leagueApiId: true, leagueName: true },
    }),
    prisma.prediction.findMany({
      where: {
        status: "PUBLISHED",
        kickoff: { gte: new Date(now.getTime() - SEASON_LOOKBACK_MS) },
        leagueApiId: { not: null },
        OR: [{ homeTeamApiId: teamApiId }, { awayTeamApiId: teamApiId }],
      },
      distinct: ["leagueApiId"],
      select: { leagueApiId: true, leagueName: true },
    }),
  ]);

  // Tables and fixture lists that include this team.
  let standing: TeamStanding | null = null;
  const competitionIds = new Set<number>(seasonRows.map((r) => r.leagueApiId!));
  let nextListed: { f: LeagueUpcomingFixture; leagueApiId: number } | null = null;

  for (const l of leagues) {
    const table = (l.standingsJson as unknown as LeagueStandingRow[] | null) ?? [];
    const row = table.find((r) => r.teamId === teamApiId);
    if (row) {
      competitionIds.add(l.leagueApiId);
      // The domestic league's table is the one worth stating; a cup group
      // table is not "where the club sits this season".
      const domestic = catalogueById.get(l.leagueApiId)?.kind === "league";
      if (domestic && (!standing || row.played > standing.row.played)) {
        standing = { leagueApiId: l.leagueApiId, leagueName: catalogueById.get(l.leagueApiId)?.name ?? "", row, size: table.length };
      }
    }
    for (const f of (l.upcomingJson as unknown as LeagueUpcomingFixture[] | null) ?? []) {
      const ids = upcomingTeamIds(f);
      if (ids.home !== teamApiId && ids.away !== teamApiId) continue;
      if (new Date(f.date).getTime() <= now.getTime()) continue;
      competitionIds.add(l.leagueApiId);
      if (!nextListed || f.date < nextListed.f.date) nextListed = { f, leagueApiId: l.leagueApiId };
    }
  }

  // The earliest of the two: a predicted fixture links through, but a listed
  // fixture that kicks off first is the club's real next match.
  let nextMatch: TeamNextMatch | null = null;
  if (nextPredicted?.kickoff) {
    nextMatch = {
      homeTeam: nextPredicted.homeTeam ?? "",
      awayTeam: nextPredicted.awayTeam ?? "",
      homeTeamApiId: nextPredicted.homeTeamApiId,
      awayTeamApiId: nextPredicted.awayTeamApiId,
      kickoff: nextPredicted.kickoff,
      leagueApiId: nextPredicted.leagueApiId,
      leagueName: nextPredicted.leagueName,
      href: (() => {
        const slug = matchSlug({ homeTeam: nextPredicted.homeTeam, awayTeam: nextPredicted.awayTeam, kickoff: nextPredicted.kickoff });
        return slug ? `/predictions/match/${slug}` : null;
      })(),
    };
  }
  if (nextListed && (!nextMatch || new Date(nextListed.f.date).getTime() < nextMatch.kickoff.getTime() - 60_000)) {
    const ids = upcomingTeamIds(nextListed.f);
    nextMatch = {
      homeTeam: nextListed.f.homeTeam,
      awayTeam: nextListed.f.awayTeam,
      homeTeamApiId: ids.home,
      awayTeamApiId: ids.away,
      kickoff: new Date(nextListed.f.date),
      leagueApiId: nextListed.leagueApiId,
      leagueName: catalogueById.get(nextListed.leagueApiId)?.name ?? null,
      href: null,
    };
  }

  // Competition names come from published rows where there are any, because
  // the league page's slug is derived from that stored name.
  const ids = [...competitionIds];
  const named = ids.length
    ? await prisma.prediction.findMany({
        where: { status: "PUBLISHED", leagueApiId: { in: ids }, leagueName: { not: null } },
        distinct: ["leagueApiId"],
        orderBy: { publishedAt: "desc" },
        select: { leagueApiId: true, leagueName: true },
      })
    : [];
  const nameById = new Map(named.map((r) => [r.leagueApiId!, r.leagueName!]));
  const competitions: TeamCompetition[] = ids
    .map((id) => {
      const published = nameById.get(id);
      const name = catalogueById.get(id)?.name ?? published;
      if (!name) return null;
      return { leagueApiId: id, name, href: published ? competitionPredictionsHref(id, leagueSlug(published, id)) : null };
    })
    .filter((c): c is TeamCompetition => c !== null)
    // Domestic league first, then the rest alphabetically.
    .sort((a, b) => Number(b.leagueApiId === standing?.leagueApiId) - Number(a.leagueApiId === standing?.leagueApiId) || a.name.localeCompare(b.name));

  const home = standing ? catalogueById.get(standing.leagueApiId) : competitions.map((c) => catalogueById.get(c.leagueApiId)).find((l) => l?.kind === "league");
  return {
    nextMatch,
    competitions,
    standing,
    country: home && home.kind === "league" ? home.country : null,
    flagCode: home && "flagCode" in home ? (home.flagCode as string) : null,
  };
});

// ── "Know more about" ────────────────────────────────────────────────────────

const ORDINAL = (n: number) => {
  const v = n % 100;
  const s = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};

const LAGOS_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long" });
const LAGOS_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const PLAIN_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export type TeamAboutInput = {
  name: string;
  profile: TeamProfile | null;
  venue: { name: string | null; city: string | null; capacity: number | null };
  coach: TeamCoach | null;
  lastFixtures: TeamFixtureSummary[] | null;
  squad: SquadPlayer[];
  pickCount: number;
};

/**
 * The "Know more about" paragraphs: plain sentences built from stored facts.
 *
 * Every clause is conditional on its own data, so a club with only a venue
 * gets one sentence rather than a template with holes. Nothing is inferred:
 * no founding year, honours or history, because nothing the site stores
 * vouches for them. Pure, so it is unit-checked.
 */
export function buildTeamAbout(input: TeamAboutInput): string[] {
  const { name, profile, venue, coach, lastFixtures, squad, pickCount } = input;
  const paragraphs: string[] = [];

  // Identity: country, ground, coach.
  const identity: string[] = [];
  const where = profile?.country && profile.country !== "World" ? `a football club from ${profile.country}` : "a football club";
  if (venue.name) {
    const city = venue.city ? ` in ${venue.city}` : "";
    const capacity = venue.capacity ? `, which holds ${venue.capacity.toLocaleString("en-GB")} spectators` : "";
    identity.push(`${name} is ${where} that plays its home matches at ${venue.name}${city}${capacity}.`);
  } else if (profile?.country) {
    identity.push(`${name} is ${where}.`);
  }
  if (coach) {
    const since = coach.since ? `, in charge since ${new Date(coach.since).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` : "";
    identity.push(`The team is coached by ${coach.name}${coach.nationality ? ` (${coach.nationality})` : ""}${since}.`);
  }
  if (squad.length) {
    const byPos = (p: string) => squad.filter((s) => s.position === p).length;
    const parts = [
      [byPos("Goalkeeper"), "goalkeeper"],
      [byPos("Defender"), "defender"],
      [byPos("Midfielder"), "midfielder"],
      [byPos("Attacker"), "forward"],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`);
    identity.push(`The current squad lists ${squad.length} players${parts.length ? `: ${list(parts)}` : ""}.`);
  }
  if (identity.length) paragraphs.push(identity.join(" "));

  // This season: competitions and table position.
  const season: string[] = [];
  const comps = profile?.competitions.map((c) => c.name) ?? [];
  if (comps.length) season.push(`This season ${name} ${comps.length === 1 ? "competes in" : "is competing in"} ${comps.length === 1 ? comps[0] : list(comps)}.`);
  const st = profile?.standing;
  if (st && st.row.played > 0) {
    const r = st.row;
    season.push(
      `In the ${st.leagueName} they sit ${ORDINAL(r.rank)} of ${st.size} with ${r.points} point${r.points === 1 ? "" : "s"} from ${r.played} match${r.played === 1 ? "" : "es"}: ${r.win} won, ${r.draw} drawn and ${r.loss} lost, with ${r.goalsFor} scored and ${r.goalsAgainst} conceded.`,
    );
    if (r.zone) season.push(`In the table, that place is marked "${r.zone}".`);
  }
  if (season.length) paragraphs.push(season.join(" "));

  // Recent and next match.
  const matches: string[] = [];
  const last = lastFixtures?.filter((f) => f.result !== "?").sort((a, b) => b.date.localeCompare(a.date))[0];
  if (last && last.goalsFor != null && last.goalsAgainst != null) {
    const verb = last.result === "W" ? "beat" : last.result === "L" ? "lost to" : "drew with";
    matches.push(`Their most recent match was on ${PLAIN_DATE.format(new Date(last.date))}, when ${name} ${verb} ${last.opponent} ${last.goalsFor}-${last.goalsAgainst} ${last.venue === "home" ? "at home" : "away"}.`);
  }
  const results = (lastFixtures ?? []).map((f) => f.result).filter((r) => r !== "?");
  if (results.length >= 3) {
    const w = results.filter((r) => r === "W").length, d = results.filter((r) => r === "D").length, l = results.filter((r) => r === "L").length;
    matches.push(`Across their last ${results.length} matches the record is ${w} win${w === 1 ? "" : "s"}, ${d} draw${d === 1 ? "" : "s"} and ${l} defeat${l === 1 ? "" : "s"}.`);
  }
  const next = profile?.nextMatch;
  if (next) {
    matches.push(
      `Next up is ${next.homeTeam} vs ${next.awayTeam}${next.leagueName ? ` in the ${next.leagueName}` : ""}, on ${LAGOS_DATE.format(next.kickoff)} at ${LAGOS_TIME.format(next.kickoff)} (West Africa Time)${next.href ? ", and our prediction for it is already published" : ""}.`,
    );
  }
  if (matches.length) paragraphs.push(matches.join(" "));

  if (pickCount > 0) {
    paragraphs.push(
      `BetGenius has published ${pickCount} prediction${pickCount === 1 ? "" : "s"} on ${name} matches. Each one names its market and confidence and explains the reasoning, and every result is settled publicly on the track record.`,
    );
  }
  return paragraphs;
}

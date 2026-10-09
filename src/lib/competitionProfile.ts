import { matchSlug } from "@/lib/slug";
import { upcomingTeamIds, type LeagueStandingRow, type LeagueUpcomingFixture, type LeaguePlayerStat } from "@/lib/enrichment";
import { competitionInSentence, type TeamNextMatch } from "@/lib/teamProfile";

/**
 * Everything the league and cup pages show beyond fixtures, tables and picks,
 * computed from the caches the pages already read. Pure functions, so they
 * are unit-checked; the curated history lives in competitionHistory.ts.
 */

export type CompetitionStats = {
  clubs: number;
  matches: number;
  goals: number;
  goalsPerMatch: number;
  homeWinPct: number | null;
  drawPct: number | null;
  awayWinPct: number | null;
  leader: LeagueStandingRow;
  bestAttack: LeagueStandingRow;
  bestDefence: LeagueStandingRow;
  mostWins: LeagueStandingRow;
  unbeaten: LeagueStandingRow[];
};

/**
 * Season-so-far numbers from a league table. Null before a ball is kicked.
 * Matches are counted once (each appears in two rows). Home/draw/away shares
 * come from the table's home splits, so they need every row to carry one.
 */
export function competitionStats(table: LeagueStandingRow[] | null | undefined): CompetitionStats | null {
  const rows = (table ?? []).filter((r) => r.played > 0);
  if (rows.length < 2) return null;
  const matches = Math.round(rows.reduce((n, r) => n + r.played, 0) / 2);
  if (matches === 0) return null;
  const goals = rows.reduce((n, r) => n + r.goalsFor, 0);

  const withSplits = rows.every((r) => r.home && r.home.played != null);
  const homeWins = withSplits ? rows.reduce((n, r) => n + r.home!.win, 0) : 0;
  const homeDraws = withSplits ? rows.reduce((n, r) => n + r.home!.draw, 0) : 0;
  const homeLosses = withSplits ? rows.reduce((n, r) => n + r.home!.loss, 0) : 0;
  const pct = (n: number) => Math.round((100 * n) / matches);

  const by = <T>(f: (r: LeagueStandingRow) => T, cmp: (a: T, b: T) => number) => [...rows].sort((a, b) => cmp(f(a), f(b)) || a.rank - b.rank)[0];
  return {
    clubs: (table ?? []).length,
    matches,
    goals,
    goalsPerMatch: Math.round((goals / matches) * 100) / 100,
    homeWinPct: withSplits ? pct(homeWins) : null,
    drawPct: withSplits ? pct(homeDraws) : null,
    awayWinPct: withSplits ? pct(homeLosses) : null,
    leader: by((r) => r.rank, (a, b) => a - b),
    bestAttack: by((r) => r.goalsFor, (a, b) => b - a),
    bestDefence: by((r) => r.goalsAgainst / r.played, (a, b) => a - b),
    mostWins: by((r) => r.win, (a, b) => b - a),
    unbeaten: rows.filter((r) => r.loss === 0 && r.played >= 3),
  };
}

/**
 * The week's biggest fixtures (three by default): everything kicking off in
 * the next seven days, ranked by where the two clubs stand in the table, so
 * the meeting of the highest-placed pair comes first. In a break with nothing
 * that soon, the seven days from the next fixture stand in. A published
 * prediction only breaks a tie (and makes the card link through); it never
 * lifts a small match over a big one. Returned in kickoff order.
 */
export function featuredMatches(
  upcoming: LeagueUpcomingFixture[] | null | undefined,
  table: LeagueStandingRow[] | null | undefined,
  publishedSlugs: string[],
  leagueApiId: number | null,
  leagueName: string | null,
  now: Date = new Date(),
  limit = 3,
): TeamNextMatch[] {
  const future = (upcoming ?? []).filter((f) => new Date(f.date).getTime() > now.getTime()).sort((a, b) => a.date.localeCompare(b.date));
  if (!future.length) return [];
  const WEEK = 7 * 24 * 3600_000;
  const from = Math.max(now.getTime(), new Date(future[0].date).getTime() - WEEK);
  const week = future.filter((f) => new Date(f.date).getTime() <= from + WEEK);

  const rankById = new Map((table ?? []).map((r) => [r.teamId, r.rank]));
  const worst = (table?.length ?? 20) + 1;
  const published = new Set(publishedSlugs);

  return week
    .map((f) => {
      const ids = upcomingTeamIds(f);
      const slug = matchSlug({ homeTeam: f.homeTeam, awayTeam: f.awayTeam, kickoff: f.date });
      const href = slug && published.has(slug) ? `/predictions/match/${slug}` : null;
      const strength = (rankById.get(ids.home ?? -1) ?? worst) + (rankById.get(ids.away ?? -1) ?? worst);
      return {
        match: {
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          homeTeamApiId: ids.home,
          awayTeamApiId: ids.away,
          kickoff: new Date(f.date),
          leagueApiId,
          leagueName,
          href,
        } satisfies TeamNextMatch,
        strength,
      };
    })
    .sort((a, b) => a.strength - b.strength || Number(!a.match.href) - Number(!b.match.href) || a.match.kickoff.getTime() - b.match.kickoff.getTime())
    .slice(0, limit)
    .map((x) => x.match)
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
}

const ORDINAL = (n: number) => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/**
 * The "this season" paragraph of the competition profile, written from the
 * live table and leaderboards so it never goes stale. Null when there is
 * nothing to say yet.
 */
export function seasonParagraph(input: {
  name: string;
  stats: CompetitionStats | null;
  table: LeagueStandingRow[] | null | undefined;
  scorers: LeaguePlayerStat[];
  pickCount: number;
}): string | null {
  const { name, stats, table, scorers, pickCount } = input;
  const parts: string[] = [];
  const league = competitionInSentence(name);
  if (stats) {
    const l = stats.leader;
    const second = (table ?? []).find((r) => r.rank === 2);
    const gap = second ? l.points - second.points : null;
    parts.push(
      `So far this season ${stats.matches} matches have been played in ${league}, producing ${stats.goals} goals at ${stats.goalsPerMatch.toFixed(2)} a game. ${l.teamName} lead the table on ${l.points} points from ${l.played} matches${
        gap != null && second ? (gap === 0 ? `, level with ${second.teamName}` : `, ${gap} clear of ${second.teamName} in ${ORDINAL(2)}`) : ""
      }.`,
    );
    if (stats.bestAttack.teamId !== l.teamId) parts.push(`${stats.bestAttack.teamName} have the best attack, with ${stats.bestAttack.goalsFor} goals.`);
  }
  const top = scorers[0];
  if (top && top.value > 0) parts.push(`${top.name} of ${top.teamName} leads the scoring charts with ${top.value} goal${top.value === 1 ? "" : "s"}.`);
  if (pickCount > 0) parts.push(`BetGenius has published ${pickCount} prediction${pickCount === 1 ? "" : "s"} in ${league}, each with its market, confidence and reasoning, and every result is settled publicly on the track record.`);
  return parts.length ? parts.join(" ") : null;
}

// Head-to-head derivation. H2HCache stores the trimmed meeting list; every
// number on /predictions/h2h/[slug] is computed from it here rather than
// stored, so the cache stays a record of what happened and this stays the one
// place the arithmetic lives.
//
// Nothing in this module calls the football API or the database — it's pure
// functions over the cached list, which is what makes the counting rules
// below checkable in isolation.

import type { FixtureRow } from "@/lib/football/api-football";
import { classifyStatus, isIrregular } from "@/lib/matchStatus";

/** One past meeting, as stored in H2HCache.meetingsJson. Team ids are kept so home/away splits don't depend on name spelling. */
export type H2HMeeting = {
  fixtureApiId: number;
  date: string; // ISO, as returned by api-football
  leagueName: string | null;
  leagueApiId: number | null;
  homeTeamApiId: number;
  homeTeam: string;
  awayTeamApiId: number;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
};

/**
 * Trims an api-football h2h response to the stored shape, most recent first.
 *
 * Only settled meetings with a real scoreline are kept: a scheduled future
 * meeting, or an abandoned/postponed one, has no result to count and would
 * otherwise drag every average and percentage on the page toward nothing. A
 * meeting the API returns without goals is dropped for the same reason — this
 * is the "meetings the API doesn't have data for" case.
 */
export function trimH2H(rows: FixtureRow[] | null): H2HMeeting[] {
  if (!rows?.length) return [];
  return rows
    .filter(
      (f) =>
        classifyStatus(f.fixture.status.short) === "finished" &&
        !isIrregular(f.fixture.status.short) &&
        f.goals.home != null &&
        f.goals.away != null,
    )
    .map((f) => ({
      fixtureApiId: f.fixture.id,
      date: f.fixture.date,
      leagueName: f.league.name ?? null,
      leagueApiId: f.league.id ?? null,
      homeTeamApiId: f.teams.home.id,
      homeTeam: f.teams.home.name,
      awayTeamApiId: f.teams.away.id,
      awayTeam: f.teams.away.name,
      homeGoals: f.goals.home as number,
      awayGoals: f.goals.away as number,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export type H2HRecord = { played: number; teamAWins: number; teamBWins: number; draws: number };

export type H2HStats = {
  sample: number;
  overall: H2HRecord;
  /** Meetings hosted by team A, and how A did in them. */
  teamAAtHome: H2HRecord;
  /** Meetings hosted by team B, and how B did in them. */
  teamBAtHome: H2HRecord;
  avgGoals: number | null;
  bttsPct: number | null;
  over25Pct: number | null;
  mostRecent: H2HMeeting | null;
  /** Meeting with the largest winning margin; ties broken by the more recent one. */
  biggestWin: { meeting: H2HMeeting; margin: number; winnerTeamApiId: number } | null;
};

function record(meetings: H2HMeeting[], teamAApiId: number): H2HRecord {
  let teamAWins = 0;
  let teamBWins = 0;
  let draws = 0;
  for (const m of meetings) {
    if (m.homeGoals === m.awayGoals) {
      draws++;
      continue;
    }
    const homeWon = m.homeGoals > m.awayGoals;
    const winnerId = homeWon ? m.homeTeamApiId : m.awayTeamApiId;
    if (winnerId === teamAApiId) teamAWins++;
    else teamBWins++;
  }
  return { played: meetings.length, teamAWins, teamBWins, draws };
}

/**
 * Every figure the H2H page shows, over the given meetings.
 *
 * `teamAApiId` fixes which side "teamA*" refers to — the caller passes whichever
 * team the page is oriented around, so the split labels can't drift from the
 * columns they describe. Percentages are 0-100; null when the sample is empty,
 * so the page renders an em-dash rather than a confident "0%".
 */
export function computeH2HStats(meetings: H2HMeeting[], teamAApiId: number, teamBApiId: number): H2HStats {
  const sample = meetings.length;
  if (sample === 0) {
    const empty = { played: 0, teamAWins: 0, teamBWins: 0, draws: 0 };
    return {
      sample: 0,
      overall: empty,
      teamAAtHome: empty,
      teamBAtHome: empty,
      avgGoals: null,
      bttsPct: null,
      over25Pct: null,
      mostRecent: null,
      biggestWin: null,
    };
  }

  const totalGoals = meetings.reduce((n, m) => n + m.homeGoals + m.awayGoals, 0);
  const btts = meetings.filter((m) => m.homeGoals > 0 && m.awayGoals > 0).length;
  const over25 = meetings.filter((m) => m.homeGoals + m.awayGoals > 2.5).length;

  let biggestWin: H2HStats["biggestWin"] = null;
  for (const m of meetings) {
    const margin = Math.abs(m.homeGoals - m.awayGoals);
    if (margin === 0) continue;
    // Meetings are sorted most-recent-first, so a strict > keeps the most
    // recent of equally emphatic wins.
    if (!biggestWin || margin > biggestWin.margin) {
      biggestWin = { meeting: m, margin, winnerTeamApiId: m.homeGoals > m.awayGoals ? m.homeTeamApiId : m.awayTeamApiId };
    }
  }

  return {
    sample,
    overall: record(meetings, teamAApiId),
    teamAAtHome: record(
      meetings.filter((m) => m.homeTeamApiId === teamAApiId),
      teamAApiId,
    ),
    teamBAtHome: record(
      meetings.filter((m) => m.homeTeamApiId === teamBApiId),
      teamAApiId,
    ),
    avgGoals: totalGoals / sample,
    bttsPct: (btts / sample) * 100,
    over25Pct: (over25 / sample) * 100,
    mostRecent: meetings[0],
    biggestWin,
  };
}

/**
 * The "H2H trends" line.
 *
 * Deliberately template-assembled from the numbers above rather than generated
 * — it states only what the sample already says, in the same declarative
 * register as the reasoning text on a prediction card ("X have won 3 of the
 * last 5 meetings"), and it cannot say anything the table below it doesn't
 * corroborate. No model call, so it costs nothing per page and can't drift.
 *
 * Clauses are only emitted where the sample supports them: a two-meeting
 * history produces the record clause alone, not a confident percentage read.
 */
export function h2hTrendLine(stats: H2HStats, teamAName: string, teamBName: string): string | null {
  if (stats.sample === 0) return null;

  const { overall, sample } = stats;
  const clauses: string[] = [];

  const leader =
    overall.teamAWins > overall.teamBWins
      ? { name: teamAName, wins: overall.teamAWins }
      : overall.teamBWins > overall.teamAWins
        ? { name: teamBName, wins: overall.teamBWins }
        : null;

  const meetingWord = sample === 1 ? "meeting" : "meetings";
  if (leader) {
    clauses.push(`${leader.name} have won ${leader.wins} of the last ${sample} ${meetingWord}`);
  } else if (overall.draws === sample) {
    clauses.push(`all ${sample} of the last ${meetingWord} between these two ended level`);
  } else {
    clauses.push(`the last ${sample} ${meetingWord} are split ${overall.teamAWins}-${overall.teamBWins} with ${overall.draws} drawn`);
  }

  // Rate-based clauses need enough meetings to mean anything — below this a
  // single result swings a percentage by 33 points or more.
  const MIN_RATE_SAMPLE = 4;
  if (sample >= MIN_RATE_SAMPLE) {
    if (stats.avgGoals != null) clauses.push(`averaging ${stats.avgGoals.toFixed(1)} goals a game`);
    if (stats.bttsPct != null && stats.bttsPct >= 60) clauses.push(`both teams scored in ${Math.round(stats.bttsPct)}% of them`);
    else if (stats.over25Pct != null && stats.over25Pct >= 60) clauses.push(`${Math.round(stats.over25Pct)}% went over 2.5`);
    else if (stats.over25Pct != null && stats.over25Pct <= 40) clauses.push(`only ${Math.round(stats.over25Pct)}% went over 2.5`);
  }

  return `${clauses.join(", ")}.`;
}

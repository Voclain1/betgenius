import Link from "next/link";
import { computeH2HStats, h2hTrendLine, type H2HMeeting } from "@/lib/h2h";

/**
 * The head-to-head record, inline on the match page.
 *
 * Previously this page offered only a link to /predictions/h2h/[slug], which
 * meant the single most match-specific piece of evidence on the site was one
 * click away from the prediction it informs. Everything here is computed by
 * src/lib/h2h.ts — the same functions the H2H page uses, so the two can't
 * disagree — from the cron-filled H2HCache. No API call, no AI.
 *
 * The trend line is template-assembled from the same numbers rendered beneath
 * it (see h2hTrendLine), so it cannot state anything the table does not show.
 */

const MEETINGS_SHOWN = 5;

export function MatchH2HSummary({
  meetings,
  homeTeam,
  awayTeam,
  homeTeamApiId,
  awayTeamApiId,
  h2hLink,
}: {
  meetings: H2HMeeting[];
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  h2hLink: string | null;
}) {
  // Orientation needs both ids: the home/away splits and the win counts are
  // keyed on team id so they can't drift with name spelling.
  if (!meetings.length || homeTeamApiId == null || awayTeamApiId == null) return null;

  const stats = computeH2HStats(meetings, homeTeamApiId, awayTeamApiId);
  const trend = h2hTrendLine(stats, homeTeam, awayTeam);
  const recent = meetings.slice(0, MEETINGS_SHOWN);

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-heading">Head-to-head</h2>
        {h2hLink && (
          <Link href={h2hLink} className="text-[11px] text-brand hover:underline">
            Full record →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">{homeTeam}</div>
          <div className="text-sm font-semibold">{stats.overall.teamAWins}</div>
        </div>
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">Draws</div>
          <div className="text-sm font-semibold">{stats.overall.draws}</div>
        </div>
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">{awayTeam}</div>
          <div className="text-sm font-semibold">{stats.overall.teamBWins}</div>
        </div>
      </div>

      {trend && <p className="text-sm text-gray-300">{trend}</p>}

      <ul className="space-y-1">
        {recent.map((m) => (
          <li key={m.fixtureApiId} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-500 tabular-nums">{m.date.slice(0, 10)}</span>
            <span className="flex-1 truncate text-gray-300">
              {m.homeTeam} <span className="font-semibold tabular-nums">{m.homeGoals}-{m.awayGoals}</span> {m.awayTeam}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

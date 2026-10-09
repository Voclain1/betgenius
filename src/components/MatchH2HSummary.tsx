import Link from "next/link";
import { computeH2HStats, h2hTrendLine, type H2HMeeting } from "@/lib/h2h";
import { PremiumPanel } from "@/components/PremiumPanel";

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
    <PremiumPanel
      kicker="History"
      title="Head-to-head"
      id="h2h"
      aside={
        h2hLink && (
          <Link href={h2hLink} className="text-brand hover:underline">
            Full record →
          </Link>
        )
      }
    >
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-brand-border text-center">
        {[
          [homeTeam, stats.overall.teamAWins],
          ["Draws", stats.overall.draws],
          [awayTeam, stats.overall.teamBWins],
        ].map(([label, value]) => (
          <div key={String(label)} className="min-w-0 bg-brand-bg px-2 py-3">
            <dd className="text-3xl font-black tabular-nums text-gray-100">{value}</dd>
            <dt className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">{label}</dt>
          </div>
        ))}
      </dl>

      {trend && <p className="mt-4 text-sm leading-relaxed text-gray-300">{trend}</p>}

      <ul className="mt-3 divide-y divide-brand-border">
        {recent.map((m) => (
          <li key={m.fixtureApiId} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="w-20 shrink-0 text-xs tabular-nums text-gray-500">{m.date.slice(0, 10)}</span>
            <span className="min-w-0 flex-1 truncate text-right text-gray-300">{m.homeTeam}</span>
            <span className="shrink-0 rounded-lg bg-brand-bg px-2 py-0.5 font-black tabular-nums text-gray-100">
              {m.homeGoals}-{m.awayGoals}
            </span>
            <span className="min-w-0 flex-1 truncate text-gray-300">{m.awayTeam}</span>
          </li>
        ))}
      </ul>
    </PremiumPanel>
  );
}

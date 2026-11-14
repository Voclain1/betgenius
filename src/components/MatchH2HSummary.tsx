import Link from "next/link";
import { computeH2HStats, h2hTrendLine, type H2HMeeting } from "@/lib/h2h";
import { PremiumPanel } from "@/components/PremiumPanel";
import { H2HBody } from "@/components/matchcentre/H2HBody";
import { h2hWindow } from "@/lib/matchCentre";

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
 *
 * Sprint 02: the figures beneath it are now windowed (last 5 / last 10) by
 * h2hWindow in src/lib/matchCentre.ts — de-duplicated by provider fixture id,
 * restricted to meetings before this fixture's kickoff, with every rate shown
 * as a count over the real sample.
 */

export function MatchH2HSummary({
  meetings,
  homeTeam,
  awayTeam,
  homeTeamApiId,
  awayTeamApiId,
  h2hLink,
  kickoff,
  timeZone = "Africa/Lagos",
}: {
  meetings: H2HMeeting[];
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  h2hLink: string | null;
  /** Meetings at or after this instant are not part of the record (a finished fixture's own result). Omitted: no cutoff. */
  kickoff?: Date;
  timeZone?: string;
}) {
  // Orientation needs both ids: the home/away splits and the win counts are
  // keyed on team id so they can't drift with name spelling.
  if (!meetings.length || homeTeamApiId == null || awayTeamApiId == null) return null;

  const stats = computeH2HStats(meetings, homeTeamApiId, awayTeamApiId);
  const trend = h2hTrendLine(stats, homeTeam, awayTeam);
  const cutoff = kickoff ?? new Date(8.64e15);
  // Verified, de-duplicated, pre-kickoff meetings, newest first, at most 10;
  // the client derives the last-5 view from this one list.
  const ten = h2hWindow(meetings, homeTeamApiId, awayTeamApiId, 10, cutoff);
  // Every stored meeting may post-date kickoff on a finished fixture's page
  // (its own result included): nothing left to show is an honest empty panel.
  if (!ten.played) return null;

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
      {trend && <p className="mb-4 text-sm leading-relaxed text-gray-300">{trend}</p>}
      <H2HBody meetings={ten.meetings} homeTeamApiId={homeTeamApiId} awayTeamApiId={awayTeamApiId} kickoff={cutoff.toISOString()} homeTeam={homeTeam} awayTeam={awayTeam} timeZone={timeZone} />
    </PremiumPanel>
  );
}

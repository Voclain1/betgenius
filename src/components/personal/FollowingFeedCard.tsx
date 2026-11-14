import Link from "next/link";
import { kickoffInZone } from "@/lib/personalization";
import { rowStatus } from "@/lib/predictionStatus";

export type FollowingFeedRow = {
  homeTeam: string | null;
  awayTeam: string | null;
  leagueName: string | null;
  kickoff: Date | null;
  pick: string;
  outcome: string;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
};

const OUTCOME_TEXT: Record<string, string> = { WON: "text-emerald-300", LOST: "text-red-300", VOID: "text-gray-300" };

/**
 * One prediction in the reader's Following feed.
 *
 * Presentation of rows the page has already loaded and gated: `allowed` is the
 * page's own entitlement decision for this reader. The kickoff is written in
 * the reader's saved timezone (the dashboard and saved list already do; this
 * page used a fixed WAT). A recorded result is shown only when `allowed`, with
 * the final score; a match past kickoff with no result says "Kicked off" or
 * "Awaiting result", never nothing, so a finished match is not mistaken for an
 * upcoming one. A locked row shows no pick and no result.
 */
export function FollowingFeedCard({ row, allowed, reasons, href, timezone, now = new Date() }: { row: FollowingFeedRow; allowed: boolean; reasons: string[]; href: string | null; timezone: string; now?: Date }) {
  const settled = row.outcome === "WON" || row.outcome === "LOST" || row.outcome === "VOID";
  const status = rowStatus({ kickoff: row.kickoff, now });
  const score = row.finalHomeScore != null && row.finalAwayScore != null ? `${row.finalHomeScore}-${row.finalAwayScore}` : null;
  return (
    <article className="card">
      <p className="text-xs text-gray-500">Because you follow {reasons.slice(0, 2).join(" and ")}</p>
      <h3 className="font-semibold">{row.homeTeam} vs {row.awayTeam}</h3>
      <p className="text-sm text-gray-400">
        {row.leagueName}
        {row.kickoff ? ` · ${kickoffInZone(row.kickoff, timezone)}` : ""}
      </p>
      <p className="mt-2">{allowed ? row.pick : "Locked selection. Following does not change subscription access."}</p>
      {allowed && settled ? (
        <p className="mt-1 text-xs font-black uppercase tracking-[0.12em]">
          <span className={OUTCOME_TEXT[row.outcome]}>{row.outcome}</span>
          {score && <span className="ml-2 tabular-nums text-gray-400">FT {score}</span>}
        </p>
      ) : status.label ? (
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">{status.label}</p>
      ) : null}
      {href && <Link className="mt-1 inline-block text-sm text-brand" href={href}>Open match →</Link>}
    </article>
  );
}

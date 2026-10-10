import Link from "next/link";
import { TeamCrest } from "@/components/TeamCrest";
import { LeagueBadge } from "@/components/LeagueBadge";
import { matchSlug } from "@/lib/slug";

export type HeroPickData = {
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  kickoff: Date | null;
  leagueName: string | null;
  leagueApiId: number | null;
  market: string;
  pick: string;
  confidence: number;
};

/**
 * The proof beside the hero's claim: one real published pick, with its market,
 * confidence.
 *
 * No site-wide win-rate line lives here. A rolling-window rate next to a single
 * fixture reads as that pick's record, and it disagreed with the all-time
 * figure /track-record publishes — one number in two places, two different
 * answers. The record is stated once, on the page that owns it.
 *
 * Only ever shows a pick from a publicly-viewable category, so a first-time
 * visitor sees an actual prediction rather than a locked teaser — a hero whose
 * headline says "football tips" and whose only example is padlocked argues
 * against itself. Selection and gating live in the page (see pickHeroTip).
 */
export function HeroPick({ pick }: { pick: HeroPickData }) {
  const slug = matchSlug(pick);
  const href = slug ? `/predictions/match/${slug}` : null;

  const body = (
    <div className="space-y-4 rounded-3xl border border-brand-border bg-brand-bg/80 p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand">Top pick today</span>
        {pick.kickoff && (
          <span className="text-xs font-semibold tabular-nums text-gray-400" suppressHydrationWarning>
            {new Date(pick.kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <LeagueBadge leagueApiId={pick.leagueApiId} leagueName={pick.leagueName} />
        <div className="text-lg font-black leading-snug tracking-tight text-gray-100">
          <TeamCrest teamApiId={pick.homeTeamApiId} className="mr-1.5" />
          {pick.homeTeam} <span className="font-bold text-gray-500">vs</span> <TeamCrest teamApiId={pick.awayTeamApiId} className="mr-1.5" />
          {pick.awayTeam}
        </div>
      </div>

      {/* Set like the prediction cards: market small, pick large, confidence as the big figure. */}
      <div className="rounded-2xl bg-brand-card p-4 ring-1 ring-brand-border">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{pick.market}</div>
            <div className="mt-1 break-words text-xl font-black leading-tight text-brand">{pick.pick}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-black leading-none tabular-nums text-gray-100">
              {pick.confidence}
              <span className="text-sm text-gray-500">%</span>
            </div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Confidence</div>
          </div>
        </div>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-brand-border" aria-hidden>
          <div className="h-full rounded-full bg-brand" style={{ width: `${pick.confidence}%` }} />
        </div>
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block transition hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

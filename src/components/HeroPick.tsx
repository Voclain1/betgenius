import Link from "next/link";
import { LeagueBadge } from "@/components/LeagueBadge";
import { matchSlug } from "@/lib/slug";

export type HeroPickData = {
  homeTeam: string;
  awayTeam: string;
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
 * Only ever shows a pick from a publicly-viewable category, so a first-time
 * visitor sees an actual prediction rather than a locked teaser — a hero whose
 * headline says "football tips" and whose only example is padlocked argues
 * against itself. Selection and gating live in the page (see pickHeroTip).
 */
export function HeroPick({ pick, trackRecord }: { pick: HeroPickData; trackRecord: { rate: number; settled: number } | null }) {
  const slug = matchSlug(pick);
  const href = slug ? `/predictions/match/${slug}` : null;

  const body = (
    <div className="card space-y-3 border-brand/30 bg-brand-bg/70 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <LeagueBadge leagueApiId={pick.leagueApiId} leagueName={pick.leagueName} />
        {pick.kickoff && (
          <span className="text-xs text-gray-500" suppressHydrationWarning>
            {new Date(pick.kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      <div className="text-base font-semibold leading-snug">
        {pick.homeTeam} <span className="text-gray-500">vs</span> {pick.awayTeam}
      </div>

      <div>
        <div className="rounded-md bg-brand-card p-2">
          <div className="text-[10px] uppercase text-gray-500">{pick.market}</div>
          <div className="truncate text-sm font-semibold text-brand">{pick.pick}</div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-gray-400">
          <span>Confidence</span>
          <span className="tabular-nums">{pick.confidence}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-brand-border">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pick.confidence}%` }} />
        </div>
      </div>

      {/* The headline above claims picks "backed by the numbers"; this is the
          settled evidence for it. Hidden entirely below the sample gate the track-record page
          itself enforces, rather than showing a rate nobody should trust. */}
      {trackRecord && (
        <div className="flex items-baseline gap-2 border-t border-brand-border pt-2 text-xs text-gray-400">
          <span className="text-base font-bold text-brand tabular-nums">{trackRecord.rate}%</span>
          <span>win rate · {trackRecord.settled} settled</span>
          <span className="ml-auto text-brand">Track record →</span>
        </div>
      )}
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

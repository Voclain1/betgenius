import Link from "next/link";
import { getLeagueTrackRecord, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { PremiumPanel } from "@/components/PremiumPanel";

/**
 * Our verified settled record in this league.
 *
 * The one claim on a prediction page that a competitor cannot copy: what
 * actually happened to the calls we already published. It sits below the
 * verdict so a reader who has just been shown a confidence figure can see
 * whether this site's confidence has historically meant anything.
 *
 * Renders NOTHING until the league clears MIN_SETTLED_SAMPLE_SIZE settled
 * predictions. That is deliberate and load-bearing — a headline win rate over a
 * handful of results is the exact statistic tipster sites use to mislead, and
 * publishing one here would undercut the reason this section exists. Most
 * leagues will therefore show nothing for a while, which is the honest state.
 */
export async function MatchTrackRecord({ leagueApiId, leagueName }: { leagueApiId: number | null; leagueName: string | null }) {
  const stat = await getLeagueTrackRecord(leagueApiId);
  // `rate` is null when every settled pick voided — a real state, and not one
  // worth rendering a percentage for.
  if (!stat || stat.rate === null) return null;
  const pct = Math.round(stat.rate * 100);

  return (
    <PremiumPanel kicker="BetGenius" title={`Our record in ${leagueName ?? "this league"}`} id="league-record">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
        <span className="text-5xl font-black leading-none tabular-nums tracking-tight text-brand">{pct}%</span>
        <span className="pb-1 text-sm text-gray-300">
          <span className="font-bold text-gray-100">{stat.won}</span> won from <span className="font-bold text-gray-100">{stat.decided}</span> settled predictions
          {stat.void > 0 && <span className="text-gray-500"> ({stat.void} void)</span>}
        </span>
      </div>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-brand-border/60" aria-hidden>
        <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-[11px] text-gray-500">
        Settled results only — every published pick is recorded win or lose.{" "}
        <Link href="/track-record" className="text-brand hover:underline">
          Full track record →
        </Link>
      </p>
      <span className="sr-only">Based on at least {MIN_SETTLED_SAMPLE_SIZE} settled predictions.</span>
    </PremiumPanel>
  );
}

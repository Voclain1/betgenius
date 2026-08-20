import Link from "next/link";
import { getLeagueTrackRecord, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";

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
    <section className="card space-y-2">
      <h2 className="section-heading">Our record in {leagueName ?? "this league"}</h2>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-2xl font-semibold text-brand tabular-nums">{pct}%</span>
        <span className="text-sm text-gray-400">
          {stat.won} won from {stat.decided} settled predictions
          {stat.void > 0 && <span className="text-gray-500"> ({stat.void} void)</span>}
        </span>
      </div>
      <p className="text-[11px] text-gray-500">
        Settled results only — every published pick is recorded win or lose.{" "}
        <Link href="/track-record" className="text-brand hover:underline">
          Full track record →
        </Link>
      </p>
      <span className="sr-only">Based on at least {MIN_SETTLED_SAMPLE_SIZE} settled predictions.</span>
    </section>
  );
}

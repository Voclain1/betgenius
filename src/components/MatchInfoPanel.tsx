import Link from "next/link";
import { LeagueBadge } from "@/components/LeagueBadge";
import { getFixtureDetail } from "@/lib/predictionScope";
import { leagueSlug } from "@/lib/slug";
import type { FixtureDetail } from "@/lib/enrichment";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-brand-bg p-2">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      {/* Wraps rather than truncating: at 375px this grid is two columns, and
          a stadium or referee name is exactly the kind of value an ellipsis
          would eat the useful half of. */}
      <div className="break-words text-sm font-medium">{value}</div>
    </div>
  );
}

/**
 * Competition / kickoff / venue / referee for one fixture.
 *
 * Competition and kickoff come from the Prediction rows and are always
 * present, so this section always renders something — venue, city, referee and
 * round fold in only once FixtureDetailCache has a successful refresh for this
 * match (see getFixtureDetail). Before that lands the panel is simply shorter,
 * with no placeholder rows for facts we don't have.
 */
export async function MatchInfoPanel({
  matchKey,
  kickoff,
  leagueName,
  leagueApiId,
}: {
  matchKey: string | null;
  kickoff: Date;
  leagueName: string | null;
  leagueApiId: number | null;
}) {
  const row = await getFixtureDetail(matchKey);
  const detail = (row?.detailJson as unknown as FixtureDetail | null) ?? null;

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {leagueName ? (
          <Link href={`/predictions/league/${leagueSlug(leagueName, leagueApiId)}`} className="hover:underline">
            <LeagueBadge leagueApiId={leagueApiId} leagueName={leagueName} />
          </Link>
        ) : (
          <LeagueBadge leagueApiId={leagueApiId} leagueName={leagueName} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact
          label="Kickoff"
          value={kickoff.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        />
        {detail?.round && <Fact label="Round" value={detail.round} />}
        {detail?.venue && <Fact label="Venue" value={detail.city ? `${detail.venue}, ${detail.city}` : detail.venue} />}
        {detail?.referee && <Fact label="Referee" value={detail.referee} />}
      </div>
    </div>
  );
}

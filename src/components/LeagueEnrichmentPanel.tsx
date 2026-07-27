import { getLeagueEnrichment } from "@/lib/predictionScope";
import { formatRelativeTime } from "@/lib/time";
import type { LeagueStandingRow, LeagueUpcomingFixture } from "@/lib/enrichment";

/**
 * Standings + upcoming fixtures for a league page. Renders nothing at all
 * (not an empty card) when no successful cache refresh has landed yet — see
 * getLeagueEnrichment in predictionScope.ts.
 */
export async function LeagueEnrichmentPanel({ leagueApiId }: { leagueApiId: number | null }) {
  const row = await getLeagueEnrichment(leagueApiId);
  if (!row) return null;

  const standings = (row.standingsJson as unknown as LeagueStandingRow[] | null) ?? null;
  const upcoming = (row.upcomingJson as unknown as LeagueUpcomingFixture[] | null) ?? null;
  if (!standings?.length && !upcoming?.length) return null;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">Standings</span>
        {row.fetchedAt && <span className="text-xs text-gray-500">Updated {formatRelativeTime(row.fetchedAt)}</span>}
      </div>

      {standings && standings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Team</th>
                <th className="px-1 text-center">P</th>
                <th className="px-1 text-center">W</th>
                <th className="px-1 text-center">D</th>
                <th className="px-1 text-center">L</th>
                <th className="px-1 text-center">GD</th>
                <th className="px-1 text-center">Pts</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr key={s.teamId} className="border-t border-brand-border">
                  <td className="py-1 pr-2 text-gray-500">{s.rank}</td>
                  <td className="flex items-center gap-1.5 py-1 pr-2">
                    {s.teamLogo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.teamLogo} alt="" width={16} height={16} className="shrink-0 object-contain" />
                    )}
                    <span>{s.teamName}</span>
                  </td>
                  <td className="px-1 text-center">{s.played}</td>
                  <td className="px-1 text-center">{s.win}</td>
                  <td className="px-1 text-center">{s.draw}</td>
                  <td className="px-1 text-center">{s.loss}</td>
                  <td className="px-1 text-center">{s.goalsFor - s.goalsAgainst}</td>
                  <td className="px-1 text-center font-semibold">{s.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {upcoming && upcoming.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs uppercase text-gray-500">Upcoming fixtures</div>
          {upcoming.map((f) => (
            <div key={f.id} className="flex items-center justify-between text-sm">
              <span>{f.homeTeam} vs {f.awayTeam}</span>
              <span className="text-xs text-gray-500">{new Date(f.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

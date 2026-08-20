import Link from "next/link";
import { leagueSlug } from "@/lib/slug";
import type { LeagueStandingRow } from "@/lib/enrichment";

/**
 * Where these two sit in the table, and what is at stake around them.
 *
 * Renders a window of rows either side of each team rather than the whole
 * table — the same shape (and the same reasoning) as the standings
 * neighbourhood in the AI digest, so the reader sees the context the model was
 * given. Two teams at opposite ends produce two windows; two teams near each
 * other produce one merged run.
 *
 * `zone` is the competition's own label for a position ("Relegation",
 * "Promotion - Champions League"), carried through from /standings. It is not
 * inferred from rank, because the rules differ per competition and guessing
 * them would put a wrong claim on the page.
 */

/** Rows kept either side of each fixture team — matches NEIGHBOUR_RADIUS in src/lib/ai/digest.ts. */
const RADIUS = 3;

function zoneStyle(zone: string | null | undefined): string {
  if (!zone) return "";
  const z = zone.toLowerCase();
  if (z.includes("relegation")) return "text-red-300/80";
  if (z.includes("promotion") || z.includes("champions")) return "text-emerald-300/80";
  return "text-gray-500";
}

export function MatchStandingsContext({
  standings,
  homeTeamApiId,
  awayTeamApiId,
  leagueName,
  leagueApiId,
}: {
  standings: LeagueStandingRow[] | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  leagueName: string | null;
  leagueApiId: number | null;
}) {
  if (!standings?.length) return null;

  const ranked = [...standings].sort((a, b) => a.rank - b.rank);
  const ids = new Set([homeTeamApiId, awayTeamApiId].filter((id): id is number => id != null));

  // Window by INDEX, not by rank arithmetic — ranks can tie or skip. A side
  // that hasn't played yet sits at an alphabetical position on zero points, so
  // the rows around it describe nothing and its window is skipped.
  const keep = new Set<number>();
  ranked.forEach((row, i) => {
    if (!ids.has(row.teamId) || row.played === 0) return;
    for (let j = Math.max(0, i - RADIUS); j <= Math.min(ranked.length - 1, i + RADIUS); j++) keep.add(j);
  });

  const rows = [...keep].sort((a, b) => a - b).map((i) => ranked[i]);
  if (rows.length === 0) return null;

  // A gap in the sequence means two separate windows, which is worth marking so
  // consecutive lines aren't misread as consecutive positions.
  const indices = [...keep].sort((a, b) => a - b);

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-heading">Table context</h2>
        {leagueName && (
          <Link href={`/predictions/league/${leagueSlug(leagueName, leagueApiId)}`} className="text-[11px] text-brand hover:underline">
            Full table →
          </Link>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase text-gray-500">
              <th className="py-1 text-left font-normal">#</th>
              <th className="py-1 text-left font-normal">Team</th>
              <th className="py-1 text-right font-normal">P</th>
              <th className="py-1 text-right font-normal">GD</th>
              <th className="py-1 text-right font-normal">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isFixtureTeam = ids.has(r.teamId);
              const gapBefore = i > 0 && indices[i] - indices[i - 1] > 1;
              const gd = r.goalsFor - r.goalsAgainst;
              return (
                <tr key={r.teamId} className={gapBefore ? "border-t border-dashed border-brand-border" : ""}>
                  <td className="py-1 text-left text-gray-500 tabular-nums">{r.rank}</td>
                  <td className={`py-1 text-left ${isFixtureTeam ? "font-semibold text-brand" : "text-gray-300"}`}>
                    {r.teamName}
                    {r.zone && <span className={`ml-2 text-[10px] ${zoneStyle(r.zone)}`}>{r.zone}</span>}
                  </td>
                  <td className="py-1 text-right tabular-nums text-gray-400">{r.played}</td>
                  <td className="py-1 text-right tabular-nums text-gray-400">{gd > 0 ? `+${gd}` : gd}</td>
                  <td className="py-1 text-right font-medium tabular-nums">{r.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

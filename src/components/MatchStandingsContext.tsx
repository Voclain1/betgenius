import Link from "next/link";
import { leagueSlug } from "@/lib/slug";
import type { LeagueStandingRow } from "@/lib/enrichment";
import { PremiumPanel } from "@/components/PremiumPanel";
import { tableContext, tableSentence } from "@/lib/matchCentre";

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
  homeTeam,
  awayTeam,
  season,
}: {
  standings: LeagueStandingRow[] | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  leagueName: string | null;
  leagueApiId: number | null;
  homeTeam?: string;
  awayTeam?: string;
  /** The cached table's season, printed so a reader can see which table this is. */
  season?: number | null;
}) {
  if (!standings?.length) return null;
  // Sprint 02: both teams must be in THIS competition's table; anything else
  // is not shown at all rather than half-shown (see tableContext).
  const ctx = tableContext(standings, homeTeamApiId, awayTeamApiId);
  if (ctx.kind !== "table") return null;
  const sentence = homeTeam && awayTeam ? tableSentence(ctx, homeTeam, awayTeam) : null;

  const ranked = [...standings].sort((a, b) => a.rank - b.rank);
  const ids = new Set([homeTeamApiId, awayTeamApiId].filter((id): id is number => id != null));

  // Window by INDEX, not by rank arithmetic — ranks can tie or skip. A side
  // that hasn't played yet sits at an alphabetical position on zero points, so
  // the rows around it describe nothing and its window is skipped.
  const keep = new Set<number>();
  ranked.forEach((row, i) => {
    if (!ids.has(row.teamId) || row.played === 0) return;
    // A grouped table (several groups share ranks) has no meaningful
    // neighbours: show only the two teams.
    if (ctx.grouped) {
      keep.add(i);
      return;
    }
    for (let j = Math.max(0, i - RADIUS); j <= Math.min(ranked.length - 1, i + RADIUS); j++) keep.add(j);
  });

  const rows = [...keep].sort((a, b) => a - b).map((i) => ranked[i]);
  if (rows.length === 0) return null;

  // A gap in the sequence means two separate windows, which is worth marking so
  // consecutive lines aren't misread as consecutive positions.
  const indices = [...keep].sort((a, b) => a - b);

  return (
    <PremiumPanel
      kicker="Table"
      title={ctx.grouped ? "Group standings" : "Table context"}
      id="table-context"
      aside={
        leagueName && (
          <Link href={`/predictions/league/${leagueSlug(leagueName, leagueApiId)}`} className="text-brand hover:underline">
            Full table →
          </Link>
        )
      }
    >

      {(sentence || season) && (
        <p className="mb-3 text-sm text-gray-300">
          {sentence}
          {season ? <span className="ml-1 text-xs text-gray-500">{leagueName ? `${leagueName} ` : ""}{season}/{String(season + 1).slice(-2)} table.</span> : null}
        </p>
      )}
      {(ctx.home.venueRecord || ctx.away.venueRecord) && (
        <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-brand-border text-center">
          {([
            [homeTeam, ctx.home.venueRecord],
            [awayTeam, ctx.away.venueRecord],
          ] as const).map(([name, v], i) => (
            <div key={i} className="min-w-0 bg-brand-bg px-2 py-2.5">
              <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                {name ? `${name} ${v ? (v.label === "Home" ? "at home" : "away") : ""}` : v?.label}
              </dt>
              <dd className="mt-0.5 text-lg font-black tabular-nums text-gray-100">{v ? `${v.w}-${v.d}-${v.l}` : "—"}</dd>
              {v && <dd className="text-[10px] tabular-nums text-gray-500">{v.played} played · goals {v.gf}-{v.ga}</dd>}
            </div>
          ))}
        </dl>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{leagueName ?? "League"} standings around {homeTeam ?? "the home team"} and {awayTeam ?? "the away team"}; both teams are in bold.</caption>
          <thead>
            <tr className="text-[10px] uppercase text-gray-500">
              <th scope="col" className="py-1 text-left font-normal">#</th>
              <th scope="col" className="py-1 text-left font-normal">Team</th>
              <th scope="col" className="py-1 text-right font-normal">P</th>
              <th scope="col" className="hidden py-1 text-right font-normal sm:table-cell">W</th>
              <th scope="col" className="hidden py-1 text-right font-normal sm:table-cell">D</th>
              <th scope="col" className="hidden py-1 text-right font-normal sm:table-cell">L</th>
              <th scope="col" className="hidden py-1 text-right font-normal sm:table-cell">GF:GA</th>
              <th scope="col" className="py-1 text-right font-normal">GD</th>
              <th scope="col" className="py-1 text-right font-normal">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isFixtureTeam = ids.has(r.teamId);
              const gapBefore = i > 0 && indices[i] - indices[i - 1] > 1;
              const gd = r.goalsFor - r.goalsAgainst;
              return (
                <tr key={r.teamId} className={gapBefore ? "border-t border-dashed border-brand-border" : ""}>
                  <td className="py-2 text-left text-gray-500 tabular-nums">{r.rank}</td>
                  <td className={`py-2 text-left ${isFixtureTeam ? "font-black text-gray-100" : "text-gray-300"}`}>
                    {r.teamName}
                    {r.zone && <span className={`ml-2 text-[10px] ${zoneStyle(r.zone)}`}>{r.zone}</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-400">{r.played}</td>
                  <td className="hidden py-2 text-right tabular-nums text-gray-400 sm:table-cell">{r.win}</td>
                  <td className="hidden py-2 text-right tabular-nums text-gray-400 sm:table-cell">{r.draw}</td>
                  <td className="hidden py-2 text-right tabular-nums text-gray-400 sm:table-cell">{r.loss}</td>
                  <td className="hidden py-2 text-right tabular-nums text-gray-400 sm:table-cell">{r.goalsFor}:{r.goalsAgainst}</td>
                  <td className="py-2 text-right tabular-nums text-gray-400">{gd > 0 ? `+${gd}` : gd}</td>
                  <td className={`py-2 text-right tabular-nums ${isFixtureTeam ? "font-black text-brand" : "font-bold"}`}>{r.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PremiumPanel>
  );
}

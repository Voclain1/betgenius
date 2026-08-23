import Link from "next/link";
import { LeagueBadge } from "@/components/LeagueBadge";
import { MatchLink } from "@/components/MatchLink";
import { leagueSlug } from "@/lib/slug";
import { competitionPredictionsHref } from "@/lib/cupConfig";

export type PredictionTableRow = {
  id: string;
  leagueApiId?: number | null;
  leagueName?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  kickoff?: string | Date | null;
  pick: string;
  overUnder?: string | null;
  confidence: number | null;
  locked?: boolean;
  fixture?: {
    kickoff: string | Date;
    league: { name: string };
    homeTeam: { name: string };
    awayTeam: { name: string };
  } | null;
};

export function PredictionsTable({ rows }: { rows: PredictionTableRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-brand-border">
      <table className="w-full text-sm">
        <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
          <tr>
            <th className="px-3 py-2">League</th>
            <th className="px-3 py-2">Match</th>
            <th className="px-3 py-2">Pick</th>
            <th className="hidden px-3 py-2 sm:table-cell">Over/Under</th>
            <th className="hidden px-3 py-2 text-right md:table-cell">Confidence</th>
            <th className="hidden px-3 py-2 md:table-cell">Kickoff</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border">
          {rows.map((p) => {
            const home = p.homeTeam ?? p.fixture?.homeTeam.name;
            const away = p.awayTeam ?? p.fixture?.awayTeam.name;
            const kickoff = p.kickoff ?? p.fixture?.kickoff;
            const leagueName = p.leagueName ?? p.fixture?.league.name;
            return (
              <tr key={p.id} className="hover:bg-brand-card/50">
                <td className="px-3 py-2">
                  {leagueName ? (
                    <Link href={competitionPredictionsHref(p.leagueApiId, leagueSlug(leagueName, p.leagueApiId))}>
                      <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} showName={false} />
                    </Link>
                  ) : (
                    <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} showName={false} />
                  )}
                </td>
                <td className="px-3 py-2">
                  <MatchLink homeTeam={home} awayTeam={away} kickoff={kickoff} />
                </td>
                <td className="px-3 py-2 font-semibold text-brand">{p.locked ? "LOCKED" : p.pick}</td>
                <td className="hidden px-3 py-2 sm:table-cell">{p.overUnder ?? "—"}</td>
                <td className="hidden px-3 py-2 text-right md:table-cell">{p.confidence != null ? `${p.confidence}%` : "—"}</td>
                <td className="hidden px-3 py-2 text-gray-400 md:table-cell">
                  {kickoff ? new Date(kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

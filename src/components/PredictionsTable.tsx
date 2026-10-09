import { Fragment } from "react";
import Link from "next/link";
import { LeagueBadge } from "@/components/LeagueBadge";
import { MatchLink } from "@/components/MatchLink";
import { leagueSlug } from "@/lib/slug";
import { competitionPredictionsHref } from "@/lib/cupConfig";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { textTone } from "@/lib/tone";

export type PredictionTableRow = {
  id: string;
  leagueApiId?: number | null;
  leagueName?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  /** API-Football team ids; when present, each team name shows its crest. */
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  kickoff?: string | Date | null;
  pick: string;
  overUnder?: string | null;
  confidence: number | null;
  /** Settled result; populated only on the Yesterday view. See PredictionRow. */
  outcome?: string | null;
  locked?: boolean;
  fixture?: {
    kickoff: string | Date;
    league: { name: string };
    homeTeam: { name: string };
    awayTeam: { name: string };
  } | null;
};

/**
 * `ads` is OPT-IN and defaults to nothing.
 *
 * This table is rendered by the homepage's Featured excerpt and by the account
 * dashboard as well as by a category feed, and neither of those should grow an
 * ad because a feed wanted one. A caller that passes nothing gets exactly the
 * markup this component produced before in-feed ads existed.
 *
 * Each entry is placed AFTER its `after`-th row, as a single full-width row
 * spanning every column. A row is the smallest thing a table can interrupt
 * cleanly: the band sits between two complete `<tr>`s and can never land
 * inside one, which is the rule in AdPlacements.tsx expressed in table terms.
 */
export function PredictionsTable({
  rows,
  ads = [],
}: {
  rows: PredictionTableRow[];
  ads?: { after: number; node: React.ReactNode }[];
}) {
  // The column appears only when a row actually carries a result, so the
  // default (today) table renders with precisely the columns it had before.
  const showOutcome = rows.some((r) => r.outcome && r.outcome !== "PENDING");
  // Counted, not hard-coded: an ad row spanning the wrong number of columns
  // would either leave a gap or stretch the table. Six fixed columns —
  // League, Match, Pick, Over/Under, Confidence, Kickoff — plus Result when
  // it is showing.
  const columnCount = 6 + (showOutcome ? 1 : 0);
  const adAfter = new Map(ads.map((a) => [a.after, a.node]));
  return (
    <div className="overflow-x-auto rounded-3xl border border-brand-border bg-brand-card">
      <table className="w-full text-sm">
        <thead className="bg-brand-bg/60 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
          <tr>
            <th className="px-3 py-3">League</th>
            <th className="px-3 py-3">Match</th>
            <th className="px-3 py-3">Pick</th>
            {showOutcome && <th className="px-3 py-3">Result</th>}
            <th className="hidden px-3 py-3 sm:table-cell">Over/Under</th>
            <th className="hidden px-3 py-3 text-right md:table-cell">Confidence</th>
            <th className="hidden px-3 py-3 md:table-cell">Kickoff</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border">
          {rows.map((p, index) => {
            const home = p.homeTeam ?? p.fixture?.homeTeam.name;
            const away = p.awayTeam ?? p.fixture?.awayTeam.name;
            const kickoff = p.kickoff ?? p.fixture?.kickoff;
            const leagueName = p.leagueName ?? p.fixture?.league.name;
            const ad = adAfter.get(index + 1);
            return (
              <Fragment key={p.id}>
              <tr className="transition hover:bg-brand-bg/40">
                <td className="px-3 py-3">
                  {leagueName ? (
                    <Link href={competitionPredictionsHref(p.leagueApiId, leagueSlug(leagueName, p.leagueApiId))}>
                      <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} showName={false} />
                    </Link>
                  ) : (
                    <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} showName={false} />
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className="font-bold text-gray-100"><MatchLink homeTeam={home} awayTeam={away} kickoff={kickoff} homeTeamApiId={p.homeTeamApiId} awayTeamApiId={p.awayTeamApiId} /></span>
                </td>
                <td className="px-3 py-3 font-black text-brand">{p.locked ? "LOCKED" : p.pick}</td>
                {showOutcome && (
                  <td className="px-3 py-3">
                    {p.outcome && p.outcome !== "PENDING" ? (
                      <span className={`text-[11px] font-black uppercase tracking-[0.1em] ${textTone(OUTCOME_STYLES[p.outcome] ?? "text-gray-400")}`}>{p.outcome}</span>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                )}
                {/* Masked with the pick: the line is generated from the pick
                    itself ("Over 2.5"), so showing it on a locked row would
                    hand over the tip the lock is withholding. */}
                <td className="hidden px-3 py-3 sm:table-cell">{p.locked ? "—" : p.overUnder ?? "—"}</td>
                <td className="hidden px-3 py-3 text-right font-black tabular-nums text-gray-100 md:table-cell">{p.confidence != null ? `${p.confidence}%` : "—"}</td>
                <td className="hidden px-3 py-3 text-gray-400 md:table-cell">
                  {kickoff ? new Date(kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                </td>
              </tr>
              {/* p-0 so the band's own padding is the only padding — a cell's
                  px-3 py-2 would inset the rule lines and stop it reading as a
                  full-width break in the table. */}
              {ad && (
                <tr>
                  <td colSpan={columnCount} className="p-0">
                    {ad}
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

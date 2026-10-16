import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LeagueBadge } from "@/components/LeagueBadge";
import { MatchLink } from "@/components/MatchLink";
import { TeamCrest } from "@/components/TeamCrest";
import { getLeagueVisual } from "@/lib/leagues";
import { ScoreCell } from "@/components/LiveScores";
import { leagueSlug, matchSlug } from "@/lib/slug";
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
  /** The match's final score, stored when the tip settles. */
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
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
  linkRows = false,
}: {
  rows: PredictionTableRow[];
  ads?: { after: number; node: React.ReactNode }[];
  /**
   * Opt-in: the pick links to the match's prediction page and each row ends in
   * an arrow button to it, so the compact row is the way in to the full tip.
   * Off by default, so every other caller keeps its markup.
   */
  linkRows?: boolean;
}) {
  // The column appears only when a row actually carries a result, so the
  // default (today) table renders with precisely the columns it had before.
  const showOutcome = rows.some((r) => r.outcome && r.outcome !== "PENDING");
  // Counted, not hard-coded: an ad row spanning the wrong number of columns
  // would either leave a gap or stretch the table. Seven fixed columns —
  // League, Match, Pick, Score, Over/Under, Confidence, Kickoff — plus Result
  // when it is showing and the open arrow when rows link.
  const columnCount = 7 + (showOutcome ? 1 : 0) + (linkRows ? 1 : 0);
  const adAfter = new Map(ads.map((a) => [a.after, a.node]));
  // PHONES (below sm) get the same table, re-flowed: every row is a grid
  //
  //   [flag] Competition · Sat 15:00        74%   >
  //   [crest] Home team                  (score)
  //   [crest] Away team
  //   TIP  Home team or Draw              (result)
  //
  // so team names and the pick each keep a full line instead of breaking over
  // four squeezed columns. One table, not a second phone-only list: a second
  // copy would also render every in-feed ad twice, one of them hidden.
  return (
    <div className="overflow-x-auto rounded-3xl border border-brand-border bg-brand-card">
      <table className="block w-full text-sm sm:table">
        <thead className="hidden bg-brand-bg/60 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 sm:table-header-group">
          <tr>
            <th className="px-3 py-3">League</th>
            <th className="px-3 py-3">Match</th>
            <th className="px-3 py-3">Pick</th>
            <th className="px-3 py-3">Score</th>
            {showOutcome && <th className="px-3 py-3">Result</th>}
            <th className="hidden px-3 py-3 sm:table-cell">Over/Under</th>
            <th className="hidden px-3 py-3 text-right md:table-cell">Confidence</th>
            <th className="hidden px-3 py-3 md:table-cell">Kickoff</th>
            {linkRows && <th className="px-3 py-3"><span className="sr-only">Open</span></th>}
          </tr>
        </thead>
        <tbody className="block divide-y divide-brand-border sm:table-row-group">
          {rows.map((p, index) => {
            const home = p.homeTeam ?? p.fixture?.homeTeam.name;
            const away = p.awayTeam ?? p.fixture?.awayTeam.name;
            const kickoff = p.kickoff ?? p.fixture?.kickoff;
            const leagueName = p.leagueName ?? p.fixture?.league.name;
            const ad = adAfter.get(index + 1);
            const slug = linkRows && home ? matchSlug({ homeTeam: home, awayTeam: away, kickoff }) : null;
            const matchHref = slug ? `/predictions/match/${slug}` : null;
            const visual = getLeagueVisual(p.leagueApiId);
            const when = kickoff ? new Date(kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : null;
            return (
              <Fragment key={p.id}>
              <tr className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 transition hover:bg-brand-bg/40 sm:table-row sm:p-0">
                {/* Phone: competition and kickoff on the row's top line. */}
                <td className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-gray-500 sm:hidden">
                  {visual && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={visual.src} alt="" width={14} height={14} loading="lazy" className="shrink-0 rounded-sm object-contain" />
                  )}
                  <span className="truncate">{visual?.name ?? leagueName ?? "—"}</span>
                  {when && <span className="shrink-0">· {when}</span>}
                </td>
                <td className="hidden px-3 py-3 sm:table-cell">
                  {leagueName ? (
                    <Link href={competitionPredictionsHref(p.leagueApiId, leagueSlug(leagueName, p.leagueApiId))}>
                      <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} showName={false} />
                    </Link>
                  ) : (
                    <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} showName={false} />
                  )}
                </td>
                {/* Phone: one line per team, never broken mid-name. */}
                <td className="col-start-1 row-start-2 min-w-0 space-y-1 sm:hidden">
                  {[
                    { name: home, id: p.homeTeamApiId },
                    { name: away, id: p.awayTeamApiId },
                  ].map((t, i) => (
                    <div key={i} className="flex min-w-0 items-center gap-2">
                      <TeamCrest teamApiId={t.id} size={16} />
                      <span className="truncate text-[15px] font-bold text-gray-100">{t.name ?? "—"}</span>
                    </div>
                  ))}
                </td>
                <td className="hidden px-3 py-3 sm:table-cell">
                  <span className="font-bold text-gray-100"><MatchLink homeTeam={home} awayTeam={away} kickoff={kickoff} homeTeamApiId={p.homeTeamApiId} awayTeamApiId={p.awayTeamApiId} /></span>
                </td>
                <td className="col-start-1 row-start-3 min-w-0 font-black text-brand sm:px-3 sm:py-3">
                  <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 sm:hidden">Tip</span>
                  {matchHref ? (
                    <Link href={matchHref} className="hover:underline">{p.locked ? "LOCKED" : p.pick}</Link>
                  ) : p.locked ? "LOCKED" : p.pick}
                </td>
                <td className="col-start-2 row-start-2 whitespace-nowrap text-right sm:px-3 sm:py-3 sm:text-left">
                  <ScoreCell
                    homeTeamApiId={p.homeTeamApiId}
                    awayTeamApiId={p.awayTeamApiId}
                    kickoff={kickoff}
                    finalHomeScore={p.finalHomeScore}
                    finalAwayScore={p.finalAwayScore}
                    emptyClassName="hidden sm:inline"
                  />
                </td>
                {showOutcome && (
                  <td className="col-start-2 row-start-3 text-right sm:px-3 sm:py-3 sm:text-left">
                    {p.outcome && p.outcome !== "PENDING" ? (
                      <span className={`text-[11px] font-black uppercase tracking-[0.1em] ${textTone(OUTCOME_STYLES[p.outcome] ?? "text-gray-400")}`}>{p.outcome}</span>
                    ) : (
                      <span className="hidden text-xs text-gray-500 sm:inline">—</span>
                    )}
                  </td>
                )}
                {/* Masked with the pick: the line is generated from the pick
                    itself ("Over 2.5"), so showing it on a locked row would
                    hand over the tip the lock is withholding. */}
                <td className="hidden px-3 py-3 sm:table-cell">{p.locked ? "—" : p.overUnder ?? "—"}</td>
                <td className="col-start-2 row-start-1 text-right text-[11px] font-black tabular-nums text-gray-300 sm:hidden md:table-cell md:px-3 md:py-3 md:text-sm md:text-gray-100">{p.confidence != null ? `${p.confidence}%` : "—"}</td>
                <td className="hidden px-3 py-3 text-gray-400 md:table-cell">
                  {kickoff ? new Date(kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                </td>
                {linkRows && (
                  <td className="col-start-3 row-span-3 row-start-1 text-right sm:px-3 sm:py-3">
                    {matchHref && (
                      <Link
                        href={matchHref}
                        aria-label={`Open the prediction for ${home} vs ${away}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-brand-border text-gray-300 transition hover:border-brand hover:text-brand"
                      >
                        <ChevronRight aria-hidden className="h-4 w-4" />
                      </Link>
                    )}
                  </td>
                )}
              </tr>
              {/* p-0 so the band's own padding is the only padding — a cell's
                  px-3 py-2 would inset the rule lines and stop it reading as a
                  full-width break in the table. */}
              {ad && (
                <tr className="block sm:table-row">
                  <td colSpan={columnCount} className="block p-0 sm:table-cell">
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

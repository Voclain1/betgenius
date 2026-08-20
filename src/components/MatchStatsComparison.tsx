import { buildMatchFacts, isMatchFactsEmpty, MIN_RATE_SAMPLE, type VenueProfile, type MatchFacts } from "@/lib/matchFacts";
import type { TeamDigest } from "@/lib/ai/digest";

/**
 * Venue-split statistics for this fixture.
 *
 * The comparison is deliberately home-record vs away-record, not season vs
 * season: the home side's home form against the away side's away form is what
 * bears on the match, and it is the one cut neither team page currently shows.
 *
 * Every figure is computed in src/lib/matchFacts.ts from the cached TeamDigest.
 * Rates below MIN_RATE_SAMPLE matches are withheld there rather than shown with
 * a hedge, so a dash here means "not enough matches to say", never "zero".
 */

function Row({ label, home, away, hint }: { label: string; home: React.ReactNode; away: React.ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
      <div className="text-right text-sm font-medium tabular-nums">{home}</div>
      <div className="px-2 text-center text-[10px] uppercase leading-tight text-gray-500" title={hint}>
        {label}
      </div>
      <div className="text-left text-sm font-medium tabular-nums">{away}</div>
    </div>
  );
}

const val = (v: number | null | undefined, suffix = "") => (v == null ? <span className="text-gray-600">—</span> : `${v}${suffix}`);

function record(p: VenueProfile | null) {
  if (!p) return <span className="text-gray-600">—</span>;
  return `${p.win}-${p.draw}-${p.loss}`;
}

export function MatchStatsComparison({
  homeTeam,
  awayTeam,
  homeDigest,
  awayDigest,
}: {
  homeTeam: string;
  awayTeam: string;
  homeDigest: TeamDigest | null;
  awayDigest: TeamDigest | null;
}) {
  const facts: MatchFacts = buildMatchFacts(homeDigest, awayDigest);
  if (isMatchFactsEmpty(facts)) return null;

  const { home, away, homeRecent, awayRecent } = facts;

  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-heading">Statistical comparison</h2>
        <span className="text-[11px] text-gray-500">
          {homeTeam} at home vs {awayTeam} away
        </span>
      </div>

      <div className="divide-y divide-brand-border">
        <Row
          label="Played"
          hint="Matches at this venue this season"
          home={val(home?.played)}
          away={val(away?.played)}
        />
        <Row label="W-D-L" hint="Record at this venue" home={record(home)} away={record(away)} />
        <Row
          label="Scored /game"
          hint="Goals scored per match at this venue"
          home={val(home?.scoredPerGame)}
          away={val(away?.scoredPerGame)}
        />
        <Row
          label="Conceded /game"
          hint="Goals conceded per match at this venue"
          home={val(home?.concededPerGame)}
          away={val(away?.concededPerGame)}
        />
        <Row
          label="Clean sheets"
          hint={`Share of matches at this venue without conceding (needs ${MIN_RATE_SAMPLE}+ matches)`}
          home={val(home?.cleanSheetPct, "%")}
          away={val(away?.cleanSheetPct, "%")}
        />
        <Row
          label="Failed to score"
          hint={`Share of matches at this venue without scoring (needs ${MIN_RATE_SAMPLE}+ matches)`}
          home={val(home?.failedToScorePct, "%")}
          away={val(away?.failedToScorePct, "%")}
        />
        <Row
          label="BTTS (last 5)"
          hint="Both teams scored, across the team's last matches"
          home={val(homeRecent.btts?.pct, "%")}
          away={val(awayRecent.btts?.pct, "%")}
        />
        <Row
          label="Over 2.5 (last 5)"
          hint="Matches with 3+ total goals, across the team's last matches"
          home={val(homeRecent.over25?.pct, "%")}
          away={val(awayRecent.over25?.pct, "%")}
        />
      </div>

      {/* Stated as the addition it is, not dressed up as a projection. */}
      {facts.combinedGoalRate != null && (
        <p className="text-[11px] text-gray-500">
          Combined scoring rate: {facts.combinedGoalRate} goals per game ({homeTeam} at home plus {awayTeam} away).
        </p>
      )}
    </section>
  );
}

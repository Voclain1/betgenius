import Link from "next/link";

/** Observed fixture counts only: never imply an unlisted fixture or prediction exists. */
export function CompetitionFixtureSummary({
  competition, season, scope, fixtureCount, roundCount, finishedCount, upcomingCount,
}: {
  competition: string;
  season: number;
  scope: string;
  fixtureCount: number;
  roundCount: number;
  finishedCount: number;
  upcomingCount: number;
}) {
  return (
    <section className="max-w-3xl space-y-3" aria-labelledby="cup-fixture-summary">
      <h2 id="cup-fixture-summary" className="text-lg font-semibold">{competition} fixtures, results and predictions</h2>
      <p className="text-sm leading-7 text-gray-300">
        The displayed {season}/{String(season + 1).slice(-2)} competition data currently includes {fixtureCount} {fixtureCount === 1 ? "fixture" : "fixtures"} across {roundCount} {roundCount === 1 ? "round" : "rounds"}.
        {" "}Of these, {finishedCount} {finishedCount === 1 ? "match is" : "matches are"} finished and {upcomingCount} {upcomingCount === 1 ? "fixture has" : "fixtures have"} yet to kick off.
        {" "}The configured coverage scope is {scope.toLowerCase()}; counts reflect the current fixture feed, not a guarantee that every match is represented.
      </p>
      <p className="text-sm leading-7 text-gray-300">
        Browse the rounds below for scheduled matches and scores. Only fixtures with published BetGenius predictions link to a match page; other fixtures remain listed without invented picks.
        {" "}<a href="#rounds" className="font-semibold text-brand hover:underline">Browse rounds</a> or <Link href="/predictions/today" className="font-semibold text-brand hover:underline">see today's football predictions</Link>.
      </p>
    </section>
  );
}

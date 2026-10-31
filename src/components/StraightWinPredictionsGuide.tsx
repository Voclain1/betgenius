import Link from "next/link";

/** Closed by default, like the Banker and Today guides: the picks come first. */
export function StraightWinPredictionsGuide() {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold marker:hidden sm:text-lg">
        <h2 className="text-base font-semibold sm:text-lg">What is a straight win prediction?</h2>
        <span aria-hidden="true" className="shrink-0 text-sm font-normal text-brand group-open:hidden">Read guide +</span>
        <span aria-hidden="true" className="hidden shrink-0 text-sm font-normal text-brand group-open:inline">Close −</span>
      </summary>
      <div className="mt-4 space-y-3 border-t border-brand-border pt-4">
        <p className="text-sm leading-6 text-gray-300">
          A straight win backs one team to win the match outright in regulation time: a home win or an away win.
          A draw loses the pick, so compare its price with Double Chance on the same team.
        </p>
        <p className="text-sm leading-6 text-gray-300">
          This page collects every published home-win and away-win tip for the selected day from the free feeds, whatever
          category it first appeared in. Each pick shows its confidence rating and the reasoning behind it.
        </p>
      </div>
    </details>
  );
}

export function StraightWinPredictionsEvidence() {
  return (
    <section className="card" aria-labelledby="straight-win-evidence-heading">
      <h2 id="straight-win-evidence-heading" className="text-lg font-semibold">How to assess a straight win prediction</h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Look past the league table: recent form home and away, how often each side draws, the strength of the
        teams they have beaten, and team news close to kickoff. Frequent draws deserve attention even when the selected team is the favourite.
      </p>
      <h3 className="mt-5 text-base font-semibold">Home win and away win predictions need different context</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Compare the home side’s home performances with the visitor’s away record, rather than relying only
        on overall standings. Check who each team has faced, how often it takes the lead and whether it
        turns promising performances into wins. A run against struggling opponents may provide less useful
        evidence for the next fixture than the headline number of victories suggests.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Give the draw its own attention. A team can be unbeaten across five matches while winning only one.
        Avoid treating an unbeaten sequence as a winning sequence: draws preserve the former but lose a
        straight win selection. Review the sample size and match circumstances before assuming that a
        recent pattern will continue.
      </p>
      <h3 className="mt-5 text-base font-semibold">A likely winner and an attractive price are separate questions</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Short odds indicate a relatively small return for each unit staked, not a certain result. Compare
        the current price for the exact home-win or away-win selection with your assessment of the match.
        A confidence rating ranks the available evidence; it is not a calibrated probability that can
        automatically be converted into a profitable betting decision.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Revisit team news before kick-off. Confirmed absences, rotation and the starting eleven may change
        the situation described in an earlier preview. Where the match page provides supporting statistics
        or line-ups, check their dates and status. Missing information adds uncertainty, and skipping a
        match is reasonable when the available evidence does not support a clear decision.
      </p>
      <h3 className="mt-5 text-base font-semibold">Straight win versus double chance: a practical example</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        If the home team wins 2–1, both a home-win pick and home-or-draw double chance win. At 1–1, the
        home-win pick loses while home-or-draw wins. At 0–1, both lose. The extra draw coverage changes
        the selection and its price; it does not make double chance certain. A draw-no-bet market is
        different again because a draw normally returns the stake under that market’s rules.
      </p>
      <h3 className="mt-5 text-base font-semibold">Questions about straight win football predictions</h3>
      <div className="mt-2 divide-y divide-brand-border">
        {[
          ["What do 1 and 2 mean in a match-result market?", "In a standard 1X2 market, 1 means a home win, X means a draw and 2 means an away win. Straight win predictions on this page select a home or away winner. Check the named teams as well as the market symbols."],
          ["Does a team qualifying in a cup count as a straight win?", "Not necessarily. A regulation-time match-result selection is settled on the score after 90 minutes plus stoppage time. A team can draw that match and then progress through extra time, penalties or an aggregate score. Qualification is a separate market."],
          ["Are straight win predictions guaranteed?", "No. Favourites and high-confidence selections can draw or lose. Neither team reputation nor short odds removes that risk. Do not increase a stake to recover earlier losses or assume a winning run must continue."],
          ["Does the match-result win rate show profit?", "No. A win rate counts outcomes without accounting for their odds or the amount staked. Check the reporting period, the number of decided picks and the market grouping before comparing results. A combined match-result record is not automatically a separate home-win or away-win record."],
        ].map(([question, answer]) => (
          <details key={question} className="py-4">
            <summary className="cursor-pointer font-semibold">{question}</summary>
            <p className="mt-3 text-sm leading-6 text-gray-300">{answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        For other selections, browse <Link href="/predictions/today" className="text-brand hover:underline">today’s football predictions</Link>.
        Read our <Link href="/methodology" className="text-brand hover:underline">prediction methodology</Link> and
        check match status before treating a listed game as an upcoming tip. Betting is for adults aged
        18 or older; only risk money you can afford to lose.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record#market-match-winner" className="text-brand hover:underline">Check the match result record</Link>
        <Link href="/predictions/double-chance" className="text-brand hover:underline">Double Chance predictions</Link>
        <Link href="/guides/football-odds-and-implied-probability" className="text-brand hover:underline">Reading odds and probability</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
  );
}

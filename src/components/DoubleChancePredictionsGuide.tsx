import Link from "next/link";

export function DoubleChancePredictionsGuide() {
  return (
    <section className="card" aria-labelledby="double-chance-definition-heading">
      <h2 id="double-chance-definition-heading" className="text-lg font-semibold">What is a Double Chance prediction?</h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Double Chance covers two of the three possible regulation-time results. Home or Draw wins when the home
        team avoids defeat; Away or Draw wins when the away team avoids defeat; Home or Away wins when the match
        does not finish level.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Covering two results removes one failure outcome, but it does not make the pick certain. Each card names
        the exact pair of results covered and shows the supporting reasoning and confidence where available.
      </p>
    </section>
  );
}

export function DoubleChancePredictionsEvidence() {
  return (
    <section className="card" aria-labelledby="double-chance-evidence-heading">
      <h2 id="double-chance-evidence-heading" className="text-lg font-semibold">How to assess a Double Chance prediction</h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Review each team&apos;s recent results, home and away record, draw frequency, strength of opposition,
        standings and relevant team news. The useful question is whether the evidence supports the two covered outcomes and the risk of the one
        uncovered result, rather than simply which team looks stronger.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Settled Double Chance predictions remain in the public market record. A percentage is hidden until at
        least 20 results have been decided, and past results never guarantee a future outcome.
      </p>
      <h3 className="mt-5 text-base font-semibold">1X, X2 and 12: which result is left out?</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-300">
          <caption className="mb-2 text-left">Standard regulation-time Double Chance selections</caption>
          <thead><tr className="border-b border-brand-border"><th scope="col" className="p-2">Selection</th><th scope="col" className="p-2">Covered results</th><th scope="col" className="p-2">Losing result</th></tr></thead>
          <tbody>{[
            ["1X", "Home win or draw", "Away win"],
            ["X2", "Draw or away win", "Home win"],
            ["12", "Home win or away win", "Draw"],
          ].map(([selection, covered, losing]) => (
            <tr key={selection} className="border-b border-brand-border"><th scope="row" className="p-2 font-medium">{selection}</th><td className="p-2">{covered}</td><td className="p-2">{losing}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        At 1–1, both 1X and X2 win, while 12 loses. At 2–0, 1X and 12 win, while X2 loses. The 12 selection
        therefore needs a decisive result, rather than protecting either team against a draw. Read the full
        selection on the card before assuming which outcome is covered.
      </p>
      <h3 className="mt-5 text-base font-semibold">Assess the uncovered outcome with current evidence</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        For 1X, examine the possibility of an away win; for X2, consider the home side’s route to victory.
        Compare home and away records against relevant opponents, rather than treating an unbeaten run as
        conclusive. A side that avoided defeat against weaker opposition may face a different test next time.
        Check the sample size and whether recent team changes make older results less representative.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        For 12, focus on draw risk for both teams. Frequent draws are relevant context, but do not establish
        that the next game will be level. Look at the available match analysis, scoring patterns and team news.
        Where line-ups are provided, check whether they are confirmed and when they were updated. Missing
        information adds uncertainty to every version of the market.
      </p>
      <h3 className="mt-5 text-base font-semibold">Double chance versus straight win and draw no bet</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        A home-win pick requires a home victory. A home-or-draw pick also wins at a draw, while home draw no
        bet normally returns the stake if the match finishes level. Those are different settlements, so compare
        the exact selection and current price. Double chance generally offers a smaller return than the
        corresponding straight win because it covers an additional outcome; that extra coverage still leaves
        a losing result.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Combining several double chance picks into an accumulator creates a separate risk: every leg normally
        needs to win under the bookmaker’s rules. Covering two outcomes per match does not make the combined
        coupon certain. Confidence compares the available evidence and is not a calibrated probability or a
        promise of profit. Review prices and your own limits before making a decision.
      </p>
      <h3 className="mt-5 text-base font-semibold">Questions about double chance football predictions</h3>
      <div className="mt-2 divide-y divide-brand-border">
        {[
          ["Does double chance mean I can win twice on one match?", "No. It is one selection covering two possible results, settled once at the offered odds. A home win and a draw cannot both be the final regulation-time result."],
          ["Does Home or Away cover the draw?", "No. Home or Away, usually written 12, loses if the regulation-time score is level. Home or Draw (1X) and Away or Draw (X2) are the versions that cover a draw."],
          ["Does extra time count for double chance?", "The standard market covers regulation time including stoppage time. Extra time and penalty shoot-outs do not change that result. Check the exact market rules with your bookmaker, especially for cup fixtures and any specially labelled markets."],
          ["Is double chance guaranteed to win because it covers two results?", "No. The uncovered outcome can still occur. Short odds, a high confidence rating and a strong team name do not remove that possibility. Review settled losses as well as wins when evaluating past performance."],
        ].map(([question, answer]) => (
          <details key={question} className="py-4">
            <summary className="cursor-pointer font-semibold">{question}</summary>
            <p className="mt-3 text-sm leading-6 text-gray-300">{answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Compare <Link href="/predictions/straight-wins" className="text-brand hover:underline">straight win predictions</Link> or
        explore <Link href="/predictions/today" className="text-brand hover:underline">today’s football predictions</Link> for
        the broader card. Check the selected day and match status before treating a pick as upcoming.
        Betting is for adults aged 18 or older; only risk money you can afford to lose.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record#market-double-chance" className="text-brand hover:underline">Check the Double Chance record</Link>
        <Link href="/guides/double-chance-explained" className="text-brand hover:underline">How double chance works</Link>
        <Link href="/methodology" className="text-brand hover:underline">Read the methodology</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
  );
}

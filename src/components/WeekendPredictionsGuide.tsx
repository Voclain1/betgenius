import Link from "next/link";
import { PERIOD_BANKER_FLOOR, PERIOD_MAX_BANKERS, PERIOD_MAX_GAMES, PERIOD_PICK_FLOOR } from "@/lib/periodPredictions";

export function WeekendPredictionsGuide() {
  return (
    <div className="space-y-6 [&_[id]]:scroll-mt-36">
      <section className="card space-y-4" aria-labelledby="weekend-football-guide">
        <h2 id="weekend-football-guide" className="text-xl font-semibold">Weekend football predictions: reading the Friday to Sunday shortlist</h2>
        <p className="text-sm leading-6 text-gray-300">
          A busy weekend can offer more fixtures than you have time to assess. This page narrows the published
          football predictions to a shortlist across Friday, Saturday and Sunday, using West Africa Time.
          It is a starting point for comparing matches, rather than a recommendation to back every listed game.
          Start with the dated sections above and open an individual match to read the available reasoning.
        </p>
        <p className="text-sm leading-6 text-gray-300">
          The main selection requires at least {PERIOD_PICK_FLOOR}% confidence and keeps the strongest qualifying
          selection per match, with at most {PERIOD_MAX_GAMES} matches across the period. The Weekend Banker uses
          a higher threshold of {PERIOD_BANKER_FLOOR}% and includes up to {PERIOD_MAX_BANKERS} matches.
          These ratings compare the assessment behind each pick; they are not guaranteed win probabilities.
          Fewer qualifying matches means a shorter list.
        </p>
      </section>

      <section className="card space-y-4" aria-labelledby="weekend-team-news">
        <h2 id="weekend-team-news" className="text-xl font-semibold">What to check before choosing Saturday and Sunday football tips</h2>
        <div className="space-y-4 text-sm leading-6 text-gray-300">
          <div>
            <h3 className="font-semibold text-white">Recovery time after midweek matches</h3>
            <p className="mt-2">Check when each team last played, whether extra time was involved and how much travel followed. A Thursday away fixture may leave a different preparation window from a Tuesday home game. A short turnaround is a reason to investigate the likely team and match approach, rather than automatic evidence that a side will lose.</p>
          </div>
          <div>
            <h3 className="font-semibold text-white">Rotation and confirmed line-ups</h3>
            <p className="mt-2">An early weekend assessment may precede the final team announcement. Revisit the match page near kick-off for available line-ups and check their status and timestamp. A predicted line-up is different from a confirmed starting eleven. If important information is missing, allow for that uncertainty when evaluating the original selection.</p>
          </div>
          <div>
            <h3 className="font-semibold text-white">The competition and the market</h3>
            <p className="mt-2">Confirm whether the fixture is a league match or a cup tie. A team can progress in a cup competition without winning in regulation time. Check whether your selection concerns the match result, goals or qualification, and read the bookmaker’s rules for extra time, penalties and postponements.</p>
          </div>
          <div>
            <h3 className="font-semibold text-white">Price changes between publication and kick-off</h3>
            <p className="mt-2">A Friday price may differ from the price available on Sunday. Compare the current odds for the exact selection, rather than assuming an earlier quote is still offered. Short odds and a familiar team name do not make a pick certain. It is reasonable to leave a match out when the price or evidence no longer supports your assessment.</p>
          </div>
        </div>
      </section>

      <section className="card space-y-4" aria-labelledby="weekend-single-or-combo">
        <h2 id="weekend-single-or-combo" className="text-xl font-semibold">Weekend banker tips and accumulators: assess each match separately</h2>
        <p className="text-sm leading-6 text-gray-300">
          The Weekend Banker is a ranked group of individual selections, rather than one accumulator.
          Combining every pick creates a different bet: an accumulator normally needs every leg to win,
          subject to the bookmaker’s settlement rules. Adding selections increases the number of outcomes
          that must go your way. A longer coupon does not inherit the confidence rating of its strongest leg.
        </p>
        <p className="text-sm leading-6 text-gray-300">
          Match the market to the evidence. A <Link href="/predictions/straight-wins" className="text-brand hover:underline">straight win prediction</Link> requires
          the selected side to win; <Link href="/predictions/double-chance" className="text-brand hover:underline">double chance tips</Link> cover
          two match results. <Link href="/predictions/btts" className="text-brand hover:underline">Both teams to score</Link> and
          <Link href="/predictions/over-2-5-goals" className="text-brand hover:underline"> Over 2.5 goals predictions</Link> answer
          different scoring questions. Review the selection itself before comparing ratings across those markets.
        </p>
      </section>

      <section className="card space-y-4" aria-labelledby="weekend-predictions-faq">
        <h2 id="weekend-predictions-faq" className="text-xl font-semibold">Weekend football predictions: common questions</h2>
        <div className="divide-y divide-brand-border">
          {[
            ["When are weekend predictions added?", "Each day’s picks can appear as fixtures come within two days of kick-off. Friday, Saturday and Sunday therefore fill at different times. The dates above identify the period currently shown; a sparse Sunday list early in the week is not a complete Sunday fixture schedule."],
            ["Why is a match missing from the weekend shortlist?", `This page selects qualifying published predictions rather than every scheduled game. It keeps one selection per match, applies a ${PERIOD_PICK_FLOOR}% confidence threshold and caps the period at ${PERIOD_MAX_GAMES} matches. Banker matches appear in their own section instead of being repeated in the day lists.`],
            ["Is the Weekend Banker free to view?", "Visitors can browse the public weekend shortlist. The Weekend Banker requires a free account to unlock its selections and reasoning. The page shows a registration prompt when you are signed out."],
            ["Can I use a completed weekend match as a new tip?", "A completed selection is useful for reviewing the original assessment and its outcome. It is not an upcoming pre-match tip. Check both the displayed period and the individual kick-off time; the previous weekend can remain visible between periods."],
          ].map(([question, answer]) => (
            <details key={question} className="py-4">
              <summary className="cursor-pointer font-semibold">{question}</summary>
              <p className="mt-3 text-sm leading-6 text-gray-300">{answer}</p>
            </details>
          ))}
        </div>
        <p className="text-sm leading-6 text-gray-300">
          For a broader daily view, visit <Link href="/predictions/today" className="text-brand hover:underline">today’s football predictions</Link>.
          Review our <Link href="/methodology" className="text-brand hover:underline">methodology</Link> and
          <Link href="/track-record" className="text-brand hover:underline"> settled prediction record</Link>, including losses,
          before relying on any selection. Betting is for adults aged 18 or older. Set a limit you can afford
          to lose and read our <Link href="/responsible-gambling" className="text-brand hover:underline">responsible gambling guidance</Link>.
        </p>
      </section>
    </div>
  );
}

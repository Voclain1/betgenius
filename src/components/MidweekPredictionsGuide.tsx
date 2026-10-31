import Link from "next/link";
import { PERIOD_BANKER_FLOOR, PERIOD_MAX_BANKERS, PERIOD_MAX_GAMES, PERIOD_PICK_FLOOR } from "@/lib/periodPredictions";

export function MidweekPredictionsGuide() {
  return (
    <div className="space-y-6 [&_[id]]:scroll-mt-36">
      <section className="card space-y-4" aria-labelledby="midweek-football-guide">
        <h2 id="midweek-football-guide" className="text-xl font-semibold">Midweek football predictions for Tuesday, Wednesday and Thursday</h2>
        <p className="text-sm leading-6 text-gray-300">
          Midweek football can bring European competition, domestic cup ties and league fixtures into the same
          schedule. This page groups qualifying published predictions by their Tuesday, Wednesday or Thursday
          kick-off date in West Africa Time. Check the dated sections above before opening a match: the list
          is a selected card, rather than a complete schedule of every game being played.
        </p>
        <p className="text-sm leading-6 text-gray-300">
          Each selection must meet the {PERIOD_PICK_FLOOR}% confidence threshold. The list keeps one selection
          per match and at most {PERIOD_MAX_GAMES} matches in total. The Midweek Banker contains up to
          {" "}{PERIOD_MAX_BANKERS} of those matches at {PERIOD_BANKER_FLOOR}% confidence or higher, displayed
          separately from the daily sections. Confidence describes the strength of the assessment; it does
          not guarantee a result or measure a certain chance of winning.
        </p>
      </section>

      <section className="card space-y-4" aria-labelledby="european-match-context">
        <h2 id="european-match-context" className="text-xl font-semibold">European football predictions: identify the format before the favourite</h2>
        <p className="text-sm leading-6 text-gray-300">
          For Champions League, Europa League or Conference League fixtures, establish the competition stage
          before interpreting the match. A league-phase game and a knockout second leg create different
          situations. Do not assume that every European fixture is an elimination match or that a club needs
          to win on the night to progress.
        </p>
        <div className="space-y-4 text-sm leading-6 text-gray-300">
          <div>
            <h3 className="font-semibold text-white">League-phase and domestic league matches</h3>
            <p className="mt-2">Consider the current table and remaining schedule where verified information is available. A recent run against weaker domestic opponents may not translate directly to a different level of opposition. Compare the actual teams and the proposed market rather than treating league position as a complete explanation.</p>
          </div>
          <div>
            <h3 className="font-semibold text-white">Knockout ties and aggregate scores</h3>
            <p className="mt-2">Check whether there is a previous leg and confirm its score. A team leading on aggregate may approach the return differently from a team chasing a deficit. Winning the match and qualifying for the next round are separate outcomes; a match-result pick can lose even when the selected club progresses.</p>
          </div>
          <div>
            <h3 className="font-semibold text-white">Extra time and penalties</h3>
            <p className="mt-2">Read the exact market rules. Regulation-time match results and goals markets usually exclude extra time and penalty shoot-outs, while qualification markets address progression. A 1–1 score after 90 minutes remains a draw for a regulation-time result bet even if one side later wins the tie.</p>
          </div>
        </div>
      </section>

      <section className="card space-y-4" aria-labelledby="midweek-squad-checks">
        <h2 id="midweek-squad-checks" className="text-xl font-semibold">Travel, recovery and rotation before midweek betting tips</h2>
        <p className="text-sm leading-6 text-gray-300">
          Look at the interval since each team’s weekend fixture, the travel involved and the next scheduled
          match. A Sunday evening game followed by a Tuesday away trip offers a different recovery window
          from a Saturday home game followed by a Thursday fixture. These details raise questions about
          preparation and selection; they do not prove that a team will struggle.
        </p>
        <p className="text-sm leading-6 text-gray-300">
          Rotation also needs evidence. Avoid assuming that every cup favourite will rest its strongest
          players or that a changed line-up is necessarily weaker. Where available, check the match page’s
          team information and line-up timestamp near kick-off. Distinguish an expected eleven from confirmed
          starters, and allow for uncertainty when information is missing or older than the prediction.
        </p>
        <p className="text-sm leading-6 text-gray-300">
          Choose a market that fits the reasoning. A <Link href="/predictions/double-chance" className="text-brand hover:underline">double chance selection</Link> can
          cover a draw, while a <Link href="/predictions/straight-wins" className="text-brand hover:underline">straight win tip</Link> cannot.
          <Link href="/predictions/btts" className="text-brand hover:underline"> Both teams to score predictions</Link> require
          a goal from each team; <Link href="/predictions/over-2-5-goals" className="text-brand hover:underline">Over 2.5 goals tips</Link> require
          three goals in total. Check current odds for the exact selection before making your own decision.
        </p>
      </section>

      <section className="card space-y-4" aria-labelledby="midweek-predictions-faq">
        <h2 id="midweek-predictions-faq" className="text-xl font-semibold">Midweek predictions: common questions</h2>
        <div className="divide-y divide-brand-border">
          {[
            ["Does the midweek page only cover European competitions?", "No. The shortlist can include qualifying published selections from domestic leagues and cups as well as European fixtures. Coverage follows the fixtures and assessments available for the displayed Tuesday-to-Thursday period."],
            ["Why are Thursday’s predictions not all available on Tuesday?", "Picks for each day can appear as matches come within two days of kick-off. Later sections can fill as the period approaches. A short or empty section does not mean there are no fixtures; no selection is added simply to reach a target count."],
            ["Is the Midweek Banker one accumulator?", "No. It is a shortlist of individual selections. Combining them creates a separate bet that normally requires every leg to win, subject to the bookmaker’s rules. The confidence attached to one selection does not become the confidence of the combined coupon."],
            ["Why does the page sometimes show the previous midweek period?", "The previous period can remain visible after it finishes, until the next period opens. Read the date range and each match’s kick-off time before treating a selection as upcoming. Completed games provide context for reviewing outcomes."],
          ].map(([question, answer]) => (
            <details key={question} className="py-4">
              <summary className="cursor-pointer font-semibold">{question}</summary>
              <p className="mt-3 text-sm leading-6 text-gray-300">{answer}</p>
            </details>
          ))}
        </div>
        <p className="text-sm leading-6 text-gray-300">
          Browse <Link href="/predictions/today" className="text-brand hover:underline">today’s football predictions</Link> for
          the daily card or <Link href="/predictions/weekend" className="text-brand hover:underline">weekend football predictions</Link> for
          Friday to Sunday. Read our <Link href="/methodology" className="text-brand hover:underline">methodology</Link> and
          <Link href="/track-record" className="text-brand hover:underline"> settled prediction record</Link>, including losses.
          Betting is for adults aged 18 or older; only risk money you can afford to lose and follow our
          <Link href="/responsible-gambling" className="text-brand hover:underline"> responsible gambling guidance</Link>.
        </p>
      </section>
    </div>
  );
}

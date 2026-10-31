import Link from "next/link";

export function TodayPredictionsGuide({ dateLabel, day = "today" }: { dateLabel: string; day?: "yesterday" | "today" | "tomorrow" }) {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold marker:hidden sm:text-lg">
        <span>How to use football predictions for {day}</span>
        <span aria-hidden="true" className="shrink-0 text-sm font-normal text-brand group-open:hidden">Read guide +</span>
        <span aria-hidden="true" className="hidden shrink-0 text-sm font-normal text-brand group-open:inline">Close −</span>
      </summary>
      <div className="mt-4 space-y-3 border-t border-brand-border pt-4">
        <p className="text-sm leading-6 text-gray-300">
          The card is limited to fixtures scheduled for {dateLabel} in West Africa Time. Picks appear as matches are assessed, so the list can change during the day. Start with the market and selection, then read the confidence rating and reasoning before making your own decision.
        </p>
        <p className="text-sm leading-6 text-gray-300">
          Confidence compares the strength of the available evidence; it is not a guaranteed probability of winning. Team news, line-ups and other late information can still change after a prediction is published.
        </p>
      </div>
    </details>
  );
}

export function TodayPredictionsEvidence({ day = "today" }: { day?: "yesterday" | "today" | "tomorrow" }) {
  return (
    <div className="space-y-6 [&_[id]]:scroll-mt-36">
      <section className="card space-y-4" aria-labelledby="daily-football-guide">
        <h2 id="daily-football-guide" className="text-xl font-semibold">Football predictions for {day}: choosing a market that fits the match</h2>
        <p className="text-sm leading-6 text-gray-300">
          A football prediction is a view about a particular outcome, rather than a promise about the whole match.
          A team can avoid defeat without winning, and a match can produce three goals without both teams scoring.
          Before comparing tips, identify exactly what each selection needs to happen. Open the match page for the
          available analysis and check that the reasoning supports the named market.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <h3 className="font-semibold"><Link href="/predictions/straight-wins" className="text-brand hover:underline">Straight win predictions</Link></h3>
            <p className="text-sm leading-6 text-gray-300">A straight win requires the selected team to win in regulation time, including stoppage time. A draw loses a home-win or away-win selection. Compare recent opponents and home or away performances before treating a favourite as the stronger choice.</p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold"><Link href="/predictions/double-chance" className="text-brand hover:underline">Double chance predictions</Link></h3>
            <p className="text-sm leading-6 text-gray-300">Double chance covers two match outcomes: home or draw, away or draw, or either team to win. Home or away excludes the draw; it does not cover every result. The extra coverage usually comes with lower odds than a single match-result selection.</p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold"><Link href="/predictions/btts" className="text-brand hover:underline">Both teams to score predictions</Link></h3>
            <p className="text-sm leading-6 text-gray-300">BTTS Yes needs each side to score at least once. A 1–1 result meets that condition, while 3–0 does not. Consider both teams’ scoring and conceding records, rather than relying only on the attacking strength of the favourite.</p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold"><Link href="/predictions/over-2-5-goals" className="text-brand hover:underline">Over 2.5 goals predictions</Link></h3>
            <p className="text-sm leading-6 text-gray-300">Over 2.5 goals requires at least three goals in total during regulation time. Scores such as 2–1 and 3–0 qualify; 1–1 does not. This market concerns the combined score, so it should not be confused with BTTS or a team to score two goals.</p>
          </div>
        </div>
      </section>

      <section className="card space-y-4" aria-labelledby="compare-daily-picks">
        <h2 id="compare-daily-picks" className="text-xl font-semibold">How to compare football betting tips before kick-off</h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-gray-300">
          <li><strong className="text-white">Check the date and match status.</strong> This feed uses West Africa Time, the same time zone as Nigeria. A completed match is a result to review, rather than a new pre-match opportunity. Use the day tabs to distinguish the current card from yesterday’s results and tomorrow’s published tips.</li>
          <li><strong className="text-white">Read beyond the last result.</strong> Look at the strength of recent opponents, home and away form, scoring patterns and the size of the sample. One large win or an old head-to-head meeting may give a misleading picture of the current teams.</li>
          <li><strong className="text-white">Check what evidence is available.</strong> Match pages can include team statistics, head-to-head meetings and line-ups where supplied. Check their dates and whether line-ups are confirmed. Missing information adds uncertainty; it should not be treated as evidence that a player is available.</li>
          <li><strong className="text-white">Compare confidence with the actual selection.</strong> A confidence rating helps compare the assessment behind a pick. It is not a measured guarantee of the result. Two selections with similar ratings may cover different outcomes and carry different odds.</li>
          <li><strong className="text-white">Review the price and your own limits.</strong> Available bookmaker odds can change after publication. Check the current market and settlement rules with your bookmaker. Choosing to skip a match is reasonable when the evidence is unclear or the price does not suit your assessment.</li>
        </ol>
        <p className="text-sm leading-6 text-gray-300">For the process behind the analysis, read our <Link href="/methodology" className="text-brand hover:underline">football prediction methodology</Link>. Use the <Link href="/track-record" className="text-brand hover:underline">settled prediction record</Link> to review outcomes across a sample that includes losses, rather than judging the service from a single winning day.</p>
      </section>

      <section className="card space-y-4" aria-labelledby="daily-predictions-questions">
        <h2 id="daily-predictions-questions" className="text-xl font-semibold">Questions about daily football predictions</h2>
        <div className="divide-y divide-brand-border">
          {[
            ["Does this page include every football match today?", "No. It shows published predictions for fixtures on the selected WAT date, rather than a complete worldwide fixture list. Several selections can relate to the same match, so the pick count is not necessarily the number of different games."],
            ["Why are finished matches still on today’s page?", "The daily card also provides context for reviewing the day’s selections. Where results are available, settled outcomes help distinguish completed picks from upcoming fixtures. Check the kick-off time and match status before considering a selection."],
            ["Are there guaranteed football predictions or sure wins?", "No football result is guaranteed. A high confidence score cannot remove the possibility of a draw, an upset, a red card or other unexpected events. Treat claims of guaranteed returns with caution and never stake money needed for essentials."],
            ["What is the difference between a single tip and an accumulator?", "A single tip is one selection. An accumulator combines selections and normally requires every leg to win, subject to the bookmaker’s void and settlement rules. Combining several high-confidence picks does not preserve the confidence of each individual pick."],
            ["When are tomorrow’s football predictions available?", "Tomorrow’s tab shows predictions that have already been published for the next WAT date. Coverage depends on the fixtures and available assessment, so an empty list does not mean there are no matches. There is no need to interpret it as a fixed publication deadline."],
          ].map(([question, answer]) => (
            <details key={question} className="group py-4">
              <summary className="cursor-pointer font-semibold">{question}</summary>
              <p className="mt-3 text-sm leading-6 text-gray-300">{answer}</p>
            </details>
          ))}
        </div>
        <p className="text-sm leading-6 text-gray-300">Planning beyond the daily card? Browse <Link href="/predictions/weekend" className="text-brand hover:underline">weekend football predictions</Link> or <Link href="/predictions/midweek" className="text-brand hover:underline">midweek football tips</Link>. For the broader schedule, visit the <Link href="/fixtures" className="text-brand hover:underline">football fixtures page</Link>.</p>
      </section>

    <section aria-labelledby="today-evidence" className="card space-y-3">
      <h2 id="today-evidence" className="text-xl font-semibold">Check the evidence</h2>
      <p className="text-sm leading-6 text-gray-300">
        Review the method and settled results—including losses—before relying on any pick. Betting is for adults aged 18 or older and should never involve money you cannot afford to lose.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/methodology" className="text-brand hover:underline">Methodology</Link>
        <Link href="/track-record" className="text-brand hover:underline">Track record</Link>
        <Link href="/guides" className="text-brand hover:underline">Betting guides</Link>
        <Link href="/fixtures" className="text-brand hover:underline">Fixtures</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
    </div>
  );
}

import Link from "next/link";

export function Over25PredictionsGuide() {
  return (
    <section className="card" aria-labelledby="over-25-definition-heading">
      <h2 id="over-25-definition-heading" className="text-lg font-semibold">What does Over 2.5 Goals mean?</h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        An Over 2.5 Goals pick needs at least three total goals across both teams in regulation time. Scores such
        as 2–1, 3–0 and 2–2 win; 0–0, 1–0 and 1–1 lose. The half-goal line means there is no draw or refund.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Each listed match has been assessed for its scoring evidence. Confidence compares the strength of that
        evidence and is not a guaranteed probability of three or more goals.
      </p>
    </section>
  );
}

export function Over25PredictionsEvidence() {
  return (
    <section className="card" aria-labelledby="over-25-evidence-heading">
      <h2 id="over-25-evidence-heading" className="text-lg font-semibold">How to assess an Over 2.5 prediction</h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Read the match reasoning for recent scoring and conceding patterns, home and away performance,
        competition context, head-to-head evidence where the sample is useful, and relevant team news. Late
        line-up changes can alter the outlook after publication.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Settled Over 2.5 results stay in the public record. Percentages remain hidden until the selection has at
        least 20 decided results, so a short streak is not presented as reliable evidence.
      </p>
      <h3 className="mt-5 text-base font-semibold">Look at the goal distribution, not just the average</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        A high goals average can be driven by one unusually large score. Across five matches, totals of
        0, 1, 1, 2 and 11 average three goals per game, but only one match exceeds 2.5. Compare how often
        the three-goal threshold was actually reached alongside the average, sample size and opponents.
        Neither figure alone establishes what will happen in the next match.
      </p>
      <h3 className="mt-5 text-base font-semibold">Separate home and away evidence</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Review the home team’s scoring and conceding at home and the visiting team’s record away. A side
        can play open matches at home while creating much less away. Consider both attacks and both
        defences, including whether recent clean sheets came against comparable opposition. A prolific
        favourite may supply all three goals, but expecting it to do so needs more support than its name
        or league position.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Check the dates behind the statistics and any relevant changes in personnel. Injuries, rotation and
        confirmed line-ups can affect the assessment; a missing line-up does not confirm that usual starters
        will play. Older head-to-head meetings may offer limited context when the current squads and match
        circumstances differ. Use the available match analysis rather than assuming every fixture has the
        same depth of evidence.
      </p>
      <h3 className="mt-5 text-base font-semibold">Over 1.5, Over 2.5 and Over 3.5 are different selections</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-300">
        <li>A 1–1 score wins Over 1.5 but loses Over 2.5 and Over 3.5.</li>
        <li>A 2–1 score wins Over 1.5 and Over 2.5, but loses Over 3.5.</li>
        <li>A 3–1 score wins all three of those total-goals selections.</li>
      </ul>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        The line refers to the combined regulation-time score, rather than one team’s goals. A team to score
        Over 2.5 needs that team alone to score at least three. Likewise,
        <Link href="/predictions/btts" className="text-brand hover:underline"> both teams to score predictions</Link> require
        each side to contribute a goal: 3–0 wins Over 2.5 but loses BTTS Yes. Read the complete market name
        before comparing odds or adding a selection to a coupon.
      </p>
      <h3 className="mt-5 text-base font-semibold">Questions about Over 2.5 goals predictions</h3>
      <div className="mt-2 divide-y divide-brand-border">
        {[
          ["Does exactly two goals win Over 2.5?", "No. Two goals is below the line, so 2–0 and 1–1 lose. At least three regulation-time goals are needed. There is no possible final score of exactly 2.5, so this half-goal line has no push for equalling the line; other void rules can still apply."],
          ["Does extra time count towards Over 2.5 goals?", "Standard match total-goals markets cover regulation time including stoppage time. Extra time and penalty shoot-outs are excluded unless the market explicitly says otherwise. Check your bookmaker’s exact settlement rules."],
          ["Is Over 2.5 safer when both teams have high scoring averages?", "High averages are relevant context, but do not establish certainty. Check the distribution of scores, home and away records, opponents and current team information. A high confidence rating also remains an assessment rather than a guaranteed outcome."],
          ["Can I use the pre-match prediction after a game has started?", "A published pre-match assessment is not a live betting recommendation. The score, time remaining, line-ups and match events can change the situation substantially. Check match status and distinguish upcoming fixtures from completed selections when browsing the feed."],
        ].map(([question, answer]) => (
          <details key={question} className="py-4">
            <summary className="cursor-pointer font-semibold">{question}</summary>
            <p className="mt-3 text-sm leading-6 text-gray-300">{answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Explore <Link href="/predictions/today" className="text-brand hover:underline">today’s football predictions</Link> for
        the broader card. Review settled wins and losses across a meaningful sample; win rate alone does
        not show profit because returns depend on odds and stakes. Betting is for adults aged 18 or older.
        Only risk money you can afford to lose.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record#market-over-25" className="text-brand hover:underline">Check the Over 2.5 record</Link>
        <Link href="/guides/over-under-goals-explained" className="text-brand hover:underline">How goals markets settle</Link>
        <Link href="/methodology" className="text-brand hover:underline">Read the methodology</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
  );
}

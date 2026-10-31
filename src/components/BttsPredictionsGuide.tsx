import Link from "next/link";

export function BttsPredictionsGuide() {
  return (
    <section className="card" aria-labelledby="btts-definition-heading">
      <h2 id="btts-definition-heading" className="text-lg font-semibold">What does BTTS mean?</h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        BTTS means Both Teams to Score in regulation time. A “Yes” pick wins when each team scores at least one
        goal. A “No” pick wins when either team—or both teams—finishes without scoring. The final winner of the
        match does not decide this market.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Every card states whether the prediction is Yes or No. Its confidence rating compares the available
        evidence; it does not guarantee that the scoring pattern will occur.
      </p>
    </section>
  );
}

export function BttsPredictionsEvidence() {
  return (
    <section className="card" aria-labelledby="btts-evidence-heading">
      <h2 id="btts-evidence-heading" className="text-lg font-semibold">How to assess a BTTS prediction</h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Review how often each side scores and concedes, its home or away record, clean sheets, failures to score,
        recent opposition and relevant team news. A strong attack alone is not enough for BTTS Yes: both sides
        must contribute a goal.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Settled BTTS Yes and No predictions remain together in the public market record. Percentages are hidden
        until the market has at least 20 decided results, preventing a short streak from being presented as a
        dependable rate.
      </p>
      <h3 className="mt-5 text-base font-semibold">Compare home and away scoring patterns</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Assess the home team’s home matches alongside the visiting team’s away matches. An overall scoring
        average can hide a team that creates chances regularly at home but rarely scores away. Look at how
        often each side scores at least once, concedes at least once and finishes without scoring. Check the
        number of matches behind each figure before comparing percentages from different samples.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Opponent strength also matters. Scoring against several struggling defences does not establish how a
        team will perform against a stronger opponent. Recent form can be useful context, but a short run
        should be considered alongside a broader record and any meaningful changes in players or approach.
      </p>
      <h3 className="mt-5 text-base font-semibold">Clean sheets and team news: evidence for both sides of the market</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        For BTTS Yes, ask whether both teams have a credible route to a goal. For BTTS No, consider which side
        might fail to score and why. A clean-sheet run is relevant, but its opponents and match conditions
        matter. The absence of an important forward or defender can change the assessment; missing team news
        should be treated as uncertainty rather than proof that the usual starting eleven is available.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Open the match page for the available reasoning and supporting information. Where line-ups are shown,
        check their status and timestamp. Head-to-head results can add context, but older meetings may involve
        different players and coaches. They should not outweigh more relevant evidence about the current teams.
      </p>
      <h3 className="mt-5 text-base font-semibold">BTTS versus Over 2.5 goals: score examples</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-300">
          <caption className="mb-2 text-left">How the same regulation-time score settles three different selections</caption>
          <thead><tr className="border-b border-brand-border">
            <th scope="col" className="p-2">Score</th><th scope="col" className="p-2">BTTS Yes</th><th scope="col" className="p-2">BTTS No</th><th scope="col" className="p-2">Over 2.5</th>
          </tr></thead>
          <tbody>{[
            ["0–0", "Loses", "Wins", "Loses"],
            ["1–1", "Wins", "Loses", "Loses"],
            ["3–0", "Loses", "Wins", "Wins"],
            ["2–1", "Wins", "Loses", "Wins"],
          ].map(([score, yes, no, over]) => (
            <tr key={score} className="border-b border-brand-border"><th scope="row" className="p-2 font-medium">{score}</th><td className="p-2">{yes}</td><td className="p-2">{no}</td><td className="p-2">{over}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        BTTS asks whether each team scores; <Link href="/predictions/over-2-5-goals" className="text-brand hover:underline">Over 2.5 goals predictions</Link> concern
        the combined total. If a selection combines BTTS with a result or goals condition, both conditions
        must be met. Read the full market name and your bookmaker’s settlement rules before comparing prices.
      </p>
      <h3 className="mt-5 text-base font-semibold">Questions about both teams to score predictions</h3>
      <div className="mt-2 divide-y divide-brand-border">
        {[
          ["Does BTTS No mean neither team can score?", "No. BTTS No wins when at least one team finishes without a goal. That includes 0–0, 1–0 and 0–3 in regulation time. It does not require a goalless match."],
          ["Do extra-time goals count for BTTS?", "The standard market concerns regulation time including stoppage time, so extra time and penalty shoot-outs are excluded. Check the exact rules with your bookmaker, especially if the market is explicitly labelled as including extra time."],
          ["Does a high confidence rating guarantee both teams will score?", "No. Confidence compares the evidence supporting a selection, rather than guaranteeing its outcome. Also check whether the actual pick is BTTS Yes or BTTS No: a high rating can apply to either side of the market."],
          ["Why might no BTTS predictions be listed?", "The page shows published selections for the chosen day, not every scheduled fixture. An empty list does not establish that no games are being played or that BTTS is unsuitable for every match. Use the day tabs or the broader daily predictions page to explore available coverage."],
        ].map(([question, answer]) => (
          <details key={question} className="py-4">
            <summary className="cursor-pointer font-semibold">{question}</summary>
            <p className="mt-3 text-sm leading-6 text-gray-300">{answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Browse <Link href="/predictions/today" className="text-brand hover:underline">today’s football predictions</Link> for
        other markets. Review settled wins and losses across a meaningful sample rather than judging a
        prediction from one result. Betting is for adults aged 18 or older; only risk money you can afford to lose.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record#market-btts" className="text-brand hover:underline">Check the BTTS record</Link>
        <Link href="/guides/both-teams-to-score-explained" className="text-brand hover:underline">How BTTS settles</Link>
        <Link href="/methodology" className="text-brand hover:underline">Read the methodology</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
  );
}

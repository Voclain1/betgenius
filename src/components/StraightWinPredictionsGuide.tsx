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
          A draw loses the pick, which is why straight wins pay more than Double Chance on the same team.
        </p>
        <p className="text-sm leading-6 text-gray-300">
          This page collects every published home-win and away-win tip of the day from the free feeds, whatever
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
        teams they have beaten, and team news close to kickoff. A favourite that draws often is a weaker straight
        win than its price suggests.
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

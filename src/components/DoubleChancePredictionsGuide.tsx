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
        standings and relevant team news. The useful question is whether the selected side can avoid the one
        uncovered result—not merely which team looks stronger.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Settled Double Chance predictions remain in the public market record. A percentage is hidden until at
        least 20 results have been decided, and past results never guarantee a future outcome.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record#market-double-chance" className="text-brand hover:underline">Check the Double Chance record</Link>
        <Link href="/methodology" className="text-brand hover:underline">Read the methodology</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
  );
}

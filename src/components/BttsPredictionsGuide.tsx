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
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record#market-btts" className="text-brand hover:underline">Check the BTTS record</Link>
        <Link href="/methodology" className="text-brand hover:underline">Read the methodology</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
  );
}

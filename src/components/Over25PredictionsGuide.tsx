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
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record#market-over-25" className="text-brand hover:underline">Check the Over 2.5 record</Link>
        <Link href="/methodology" className="text-brand hover:underline">Read the methodology</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
  );
}

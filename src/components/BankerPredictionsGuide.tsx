import Link from "next/link";

export function BankerPredictionsIntro() {
  return (
    <section className="card" aria-labelledby="banker-definition-heading">
      <h2 id="banker-definition-heading" className="text-lg font-semibold">
        What is a Banker prediction?
      </h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Banker predictions are a short list of higher-conviction football picks selected from the day&apos;s
        fixture card. Up to seven may be published in a day, fewer on a thin card, and some days will have none when the available
        evidence is not strong enough.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        A Banker label is not a guarantee. Check the market, confidence rating and reasoning, then consider
        late team news before making your own decision. The full pick and reasoning are available after free
        registration.
      </p>
    </section>
  );
}

export function BankerPredictionsEvidence() {
  return (
    <section className="card" aria-labelledby="banker-method-heading">
      <h2 id="banker-method-heading" className="text-lg font-semibold">
        How Banker picks are selected
      </h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Bankers are the highest-confidence picks on the day&apos;s card, from any competition, including the
        Champions League and Europa League. A pick needs a confidence rating of at least 75 to qualify, each match
        can supply only one, and the list is capped at seven rather than filled to a target. Confidence compares
        the strength of the available evidence; it is not a guaranteed probability of winning.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Every Banker result is listed day by day at the foot of this page, and the public track record shows the
        category&apos;s win rate for the current month; a percentage stays hidden until there are at least 20 decided results.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record#category-banker" className="text-brand hover:underline">
          Check the Banker track record
        </Link>
        <Link href="/guides/what-is-a-banker-bet" className="text-brand hover:underline">
          What a banker bet is
        </Link>
        <Link href="/methodology" className="text-brand hover:underline">
          Read the methodology
        </Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">
          Responsible gambling
        </Link>
      </div>
    </section>
  );
}

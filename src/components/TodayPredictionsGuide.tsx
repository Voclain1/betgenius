import Link from "next/link";

export function TodayPredictionsGuide({ dateLabel }: { dateLabel: string }) {
  return (
    <section aria-labelledby="today-guide" className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
      <div className="card space-y-3">
        <h2 id="today-guide" className="text-xl font-semibold">How to use today&apos;s football predictions</h2>
        <p className="text-sm leading-6 text-gray-300">
          The card is limited to fixtures scheduled for {dateLabel} in West Africa Time. Picks appear as matches are assessed, so the list can change during the day. Start with the market and selection, then read the confidence rating and reasoning before making your own decision.
        </p>
        <p className="text-sm leading-6 text-gray-300">
          Confidence compares the strength of the available evidence; it is not a guaranteed probability of winning. Team news, line-ups and other late information can still change after a prediction is published.
        </p>
      </div>
      <div className="card space-y-3">
        <h2 className="text-xl font-semibold">Check the evidence</h2>
        <p className="text-sm leading-6 text-gray-300">
          Review the method and settled results—including losses—before relying on any pick. Betting is for adults aged 18 or older and should never involve money you cannot afford to lose.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link href="/methodology" className="text-brand hover:underline">Methodology</Link>
          <Link href="/track-record" className="text-brand hover:underline">Track record</Link>
          <Link href="/fixtures" className="text-brand hover:underline">Fixtures</Link>
          <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
        </div>
      </div>
    </section>
  );
}

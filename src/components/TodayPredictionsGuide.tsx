import Link from "next/link";

export function TodayPredictionsGuide({ dateLabel }: { dateLabel: string }) {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold marker:hidden sm:text-lg">
        <span>How to use today&apos;s football predictions</span>
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

export function TodayPredictionsEvidence() {
  return (
    <section aria-labelledby="today-evidence" className="card space-y-3">
      <h2 id="today-evidence" className="text-xl font-semibold">Check the evidence</h2>
      <p className="text-sm leading-6 text-gray-300">
        Review the method and settled results—including losses—before relying on any pick. Betting is for adults aged 18 or older and should never involve money you cannot afford to lose.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/methodology" className="text-brand hover:underline">Methodology</Link>
        <Link href="/track-record" className="text-brand hover:underline">Track record</Link>
        <Link href="/fixtures" className="text-brand hover:underline">Fixtures</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
  );
}

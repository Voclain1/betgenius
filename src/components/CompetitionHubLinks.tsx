import Link from "next/link";

export function CompetitionHubLinks({ competition }: { competition: string }) {
  return (
    <section className="card" aria-labelledby="competition-evidence-heading">
      <h2 id="competition-evidence-heading" className="text-lg font-semibold">How to verify these {competition} predictions</h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Compare the pick and confidence rating with the current table, fixture context, recent results and the
        reasoning on each match. Confidence describes the strength of the assessment, not a guaranteed chance of winning.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record" className="text-brand hover:underline">Check the public track record</Link>
        <Link href="/methodology" className="text-brand hover:underline">Read the methodology</Link>
        <Link href="/predictions/today" className="text-brand hover:underline">Today&apos;s football predictions</Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">Responsible gambling</Link>
      </div>
    </section>
  );
}

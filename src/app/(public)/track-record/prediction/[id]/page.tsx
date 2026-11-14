import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { loadPerformanceRecord } from "@/lib/performanceData";
import {
  historyPrice,
  settlementVerified,
} from "@/lib/performanceTransparency";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Published prediction record",
  description:
    "Inspect an accessible published prediction and its recorded evidence.",
  robots: { index: false, follow: true },
};
const stamp = (d: Date | null) =>
  d
    ? d.toLocaleString("en-GB", {
        timeZone: "Africa/Lagos",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " WAT"
    : "Unavailable";
export default async function PredictionHistory({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await getViewerEntitlement(),
    row = await loadPerformanceRecord(params.id, viewer);
  if (!row) notFound();
  const quote = historyPrice(row),
    verified = settlementVerified(row);
  return (
    <article className="space-y-6">
      <Link
        href="/track-record#history"
        className="inline-flex min-h-11 items-center text-sm text-brand"
      >
        ← Historical results
      </Link>
      <header>
        <p className="text-xs text-gray-400">
          {row.leagueName ?? "Competition unavailable"} · {stamp(row.kickoff)}
        </p>
        <h1 className="mt-2 break-words text-2xl font-black sm:text-4xl">
          {row.homeTeam ?? "Home"} vs {row.awayTeam ?? "Away"}
        </h1>
      </header>
      <section className="border-y border-brand-border py-4">
        <p className="text-xs text-gray-400">
          Recorded published selection · {row.market}
        </p>
        <h2 className="mt-1 text-xl font-bold text-brand">{row.pick}</h2>
        <p className="mt-2 text-sm">
          {row.outcome} ·{" "}
          {verified
            ? "Publication-selection and final-score verification agree"
            : "Independent settlement verification unavailable"}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {row.finalHomeScore != null && row.finalAwayScore != null
            ? `Recorded final score ${row.finalHomeScore}–${row.finalAwayScore}`
            : "Final score unavailable"}
        </p>
      </section>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        {[
          ["Published", stamp(row.publishedAt)],
          ["Settlement recorded", stamp(row.settledAt)],
          ["Primary category", row.category],
          [
            "Publication-price observation",
            quote ? quote.median.toFixed(2) : "Unavailable",
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-gray-400">{label}</dt>
            <dd className="mt-1 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="border-y border-brand-border py-2">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
          Publication evidence & version history
        </summary>
        <div className="space-y-3 pb-3 text-sm leading-relaxed text-gray-400">
          <p>
            This is the currently stored published record. A complete immutable
            original selection and publication-version ledger are not available.
            No earlier selection is reconstructed.
          </p>
          <p>
            {row.rewriteCount} recorded draft rewrites. Drafts are not published
            versions. A complete settlement-correction ledger is unavailable;
            the settlement above is the latest stored outcome, not a claim that
            no correction occurred.
          </p>
          {quote ? (
            <p>
              Verified matching publication-price observation at{" "}
              {stamp(quote.at)}. Indicative median, not an executed offer. Named
              sources:{" "}
              {quote.sources
                .map((q) => `${q.bookmaker} ${q.odd.toFixed(2)}`)
                .join("; ")}
              .
            </p>
          ) : (
            <p>
              No qualifying historical publication price is available. Current
              odds and legacy display odds are not substituted.
            </p>
          )}
          <p>
            Historical counts and returns are separate from prospective
            reliability snapshots. Missing evidence does not establish that an
            originally published selection remained unchanged.
          </p>
        </div>
      </details>
      {row.matchSlugKey && (
        <Link
          href={`/predictions/match/${row.matchSlugKey}`}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
        >
          Match reference and published reasoning →
        </Link>
      )}
    </article>
  );
}

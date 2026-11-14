import { resultLabel } from "@/lib/performanceCopy";
import { CATEGORY_LABELS } from "@/lib/performanceLabels";
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
  title: "Past Prediction",
  description:
    "See the prediction, match result, publication time and any available past odds.",
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
        ← Past Predictions
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
        <p className="text-xs text-gray-400">Our prediction · {row.market}</p>
        <h2 className="mt-1 text-xl font-bold text-brand">{row.pick}</h2>
        <p className="mt-2 text-base font-semibold">
          {resultLabel(row.outcome)}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {verified
            ? "Published prediction and final score checked"
            : "Not fully checked"}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {row.finalHomeScore != null && row.finalAwayScore != null
            ? `Final score ${row.finalHomeScore}–${row.finalAwayScore}`
            : "Final score unavailable"}
        </p>
      </section>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        {[
          ["Published", stamp(row.publishedAt)],
          ["Result updated", stamp(row.settledAt)],
          ["Category", CATEGORY_LABELS[row.category] ?? "Other category"],
          [
            "Odds at Publication",
            quote ? quote.median.toFixed(2) : "Not available",
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
          About this prediction record
        </summary>
        <div className="space-y-3 pb-3 text-sm leading-relaxed text-gray-400">
          <p>
            This page shows the prediction and result currently on file. A
            complete copy of every earlier published choice is not available, so
            we cannot show a full history of changes.
          </p>
          <p>
            {row.rewriteCount} changes were made while preparing this
            prediction. Those changes do not tell us how many published versions
            there were. The result shown is the latest one we have; we cannot
            confirm whether it was corrected earlier.
          </p>
          {quote ? (
            <p>
              Odds recorded at {stamp(quote.at)}. These match the published
              choice. The figure is the middle price from the named bookmakers
              below, not proof of an accepted bet. Bookmakers:{" "}
              {quote.sources
                .map((q) => `${q.bookmaker} ${q.odd.toFixed(2)}`)
                .join("; ")}
              .
            </p>
          ) : (
            <p>
              We do not have confirmed odds from publication for this
              prediction. We do not replace them with today’s odds.
            </p>
          )}
          <p>
            Without a complete history, we cannot confirm that every part of the
            published prediction stayed unchanged. Past results do not guarantee
            future wins.
          </p>
        </div>
      </details>
      {row.matchSlugKey && (
        <Link
          href={`/predictions/match/${row.matchSlugKey}`}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
        >
          Match details and analysis →
        </Link>
      )}
    </article>
  );
}

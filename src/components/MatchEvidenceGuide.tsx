import Link from "next/link";
import { PremiumPanel } from "./PremiumPanel";
import {
  MARKET_MEANINGS,
  selectionObservations,
} from "@/lib/predictionExplanation";
import type { TeamDigest } from "@/lib/ai/digest";

export function MatchEvidenceGuide({
  marketType,
  selection,
  market,
  pick,
  kickoff,
  home,
  away,
  recordedAt,
  homeFetchedAt,
  awayFetchedAt,
  now = new Date(),
}: {
  marketType: string;
  selection: unknown;
  market: string;
  pick: string;
  kickoff: Date;
  home: TeamDigest | null;
  away: TeamDigest | null;
  recordedAt: Date | null;
  homeFetchedAt: Date | null;
  awayFetchedAt: Date | null;
  now?: Date;
}) {
  const observations = selectionObservations({
    marketType,
    selection,
    kickoff,
    home,
    away,
    now,
  });
  const stamp = (v: Date) =>
    v.toLocaleString("en-GB", {
      timeZone: "Africa/Lagos",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " WAT";
  const freshness = (v: Date | null) =>
    !v || !Number.isFinite(+v) || v > now
      ? "Unavailable"
      : `${+now - +v > 86400000 ? "Older cached context" : "Recently fetched context"} · ${stamp(v)}`;
  return (
    <PremiumPanel
      kicker="Understand the pick"
      title="Evidence guide"
      id="evidence-guide"
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-brand">{market}</p>
          <h3 className="mt-1 break-words text-lg font-bold">{pick}</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-300">
            {MARKET_MEANINGS[marketType] ??
              "Review the published market and its specific settlement terms. A supported standard-market explanation is unavailable."}
          </p>
        </div>
        <p className="text-xs leading-relaxed text-gray-400">
          {recordedAt
            ? `Original prediction context recorded ${stamp(recordedAt)}.`
            : "Original prediction context is unavailable. These observations come from the latest cached context and do not reconstruct the evidence used to publish this pick."}{" "}
          Only scored recent matches dated before kickoff are counted. Samples
          cover different opponents and competitions.
        </p>
        {observations.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {observations.map((o) => (
              <div
                key={o.team}
                className="min-w-0 rounded-xl border border-brand-border p-4"
              >
                <h4 className="break-words text-sm font-semibold">
                  {o.team} · {o.sample} recent matches
                </h4>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-400">Matched this market</dt>
                    <dd className="font-semibold text-brand">
                      {o.support} / {o.sample}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-400">Went against it</dt>
                    <dd className="font-semibold text-gray-200">
                      {o.against} / {o.sample}
                    </dd>
                  </div>
                  {o.neutral > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-400">Stake-return results</dt>
                      <dd>{o.neutral}</dd>
                    </div>
                  )}
                </dl>
                <p className="mt-3 text-xs text-gray-500">
                  Latest sampled match: {stamp(new Date(o.latest))}. Counts
                  describe past matches, not the probability of this fixture.
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-brand-border p-4 text-sm text-gray-400">
            Insufficient verified recent scores for a market-specific
            comparison. Read the published reasoning and available match context
            below; no supporting statistic is inferred.
          </p>
        )}
        <details className="rounded-xl border border-brand-border p-3 text-sm text-gray-400">
          <summary className="cursor-pointer py-1 font-semibold text-gray-300">
            Data limitations & freshness
          </summary>
          <ul className="mt-3 space-y-2">
            <li>
              Small samples do not account for every opponent, lineup or change
              in circumstances. A past result matching the market is not proof
              that the next one will.
            </li>
            <li>Home team cache: {freshness(homeFetchedAt)}.</li>
            <li>Away team cache: {freshness(awayFetchedAt)}.</li>
            <li>
              Cache fetch times are separate from original prediction context
              and provider quote times. Missing data is never treated as zero.
            </li>
          </ul>
        </details>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link
            href="#markets"
            className="inline-flex min-h-11 items-center font-semibold text-brand"
          >
            Read published reasoning ↓
          </Link>
          <Link
            href="#market-comparison"
            className="inline-flex min-h-11 items-center font-semibold text-brand"
          >
            Compare published markets ↓
          </Link>
          <Link
            href="#form"
            className="inline-flex min-h-11 items-center text-gray-400 underline"
          >
            Recent results
          </Link>
        </div>
      </div>
    </PremiumPanel>
  );
}

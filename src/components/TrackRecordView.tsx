"use client";
import Link from "next/link";
import { useState } from "react";
import {
  MIN_SETTLED_SAMPLE_SIZE,
  WINDOW_OPTIONS,
  TRACK_RECORD_CATEGORIES,
  TRACK_RECORD_MARKET_TYPES,
  type TrackRecordData,
  type WindowDays,
  type WinRateStat,
} from "@/lib/trackRecord";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { MatchLink } from "@/components/MatchLink";

const CATEGORY_LABELS: Record<string, string> = {
  FEATURED: "Featured",
  GENIUS: "Genius",
  TODAY: "Today",
  BANKER: "Banker",
  VIP: "VIP",
  PREMIUM: "Premium",
  BET_OF_THE_DAY: "Bet of the Day",
};

const MARKET_LABELS: Record<string, string> = {
  MATCH_WINNER: "Match Winner",
  DOUBLE_CHANCE: "Double Chance",
  OVER_UNDER: "Total Goals",
  BTTS: "Both Teams to Score",
  CORRECT_SCORE: "Correct Score",
};


/** Exported for reuse by the league/team scoped pages, which show the same win-rate-card shape for a single scoped stat. */
export function RateCard({ stat, label, big }: { stat: WinRateStat; label: string; big?: boolean }) {
  const enough = stat.decided >= MIN_SETTLED_SAMPLE_SIZE;
  return (
    <div className="card">
      <div className="text-xs uppercase text-gray-400">{label}</div>
      {stat.total === 0 ? (
        <div className="mt-2 text-sm text-gray-500">No settled tips yet</div>
      ) : enough ? (
        <>
          <div className={big ? "mt-1 text-4xl font-bold text-brand" : "mt-1 text-2xl font-bold text-brand"}>
            {Math.round((stat.rate ?? 0) * 100)}%
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {stat.won}W – {stat.lost}L{stat.void ? ` – ${stat.void} void` : ""} ({stat.decided} decided)
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 text-sm text-amber-300">Not enough data yet</div>
          <div className="mt-1 text-xs text-gray-400">{stat.decided} of {MIN_SETTLED_SAMPLE_SIZE} decided so far</div>
        </>
      )}
    </div>
  );
}

export function TrackRecordView({ data }: { data: TrackRecordData }) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const stats = data.windows[windowDays];
  const formatDate = (value: string | null) => value
    ? new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(value))
    : "Not available";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Football prediction track record</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">
          This is the public record of BetGenius predictions after the matches have finished. Wins and losses remain visible, and void selections stay in the sample even though they are excluded from the win-rate calculation.
        </p>
        <p className="mt-2 text-xs text-gray-400">
          {data.firstPublishedAt ? <>Record begins {formatDate(data.firstPublishedAt)}. </> : null}
          Last settlement update: <time dateTime={data.lastSettledAt ?? undefined}>{formatDate(data.lastSettledAt)}</time>.
        </p>
      </div>

      <section aria-labelledby="all-time-heading">
        <h2 id="all-time-heading" className="mb-3 text-lg font-semibold">All-time published record</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RateCard stat={data.allTime} label="All-time win rate" big />
          <div className="card"><div className="text-xs uppercase text-gray-400">Settled tips</div><div className="mt-1 text-3xl font-bold">{data.allTime.total}</div><div className="mt-1 text-xs text-gray-400">Wins, losses and voids</div></div>
          <div className="card"><div className="text-xs uppercase text-gray-400">Won</div><div className="mt-1 text-3xl font-bold text-emerald-400">{data.allTime.won}</div><div className="mt-1 text-xs text-gray-400">Decided as successful</div></div>
          <div className="card"><div className="text-xs uppercase text-gray-400">Lost / void</div><div className="mt-1 text-3xl font-bold">{data.allTime.lost} / {data.allTime.void}</div><div className="mt-1 text-xs text-gray-400">Void is not a loss</div></div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2" aria-label="Track-record period">
        {WINDOW_OPTIONS.map((d) => (
          <button
            key={d}
            onClick={() => setWindowDays(d)}
            className={`btn text-sm ${windowDays === d ? "btn-primary" : "btn-ghost"}`}
          >
            Last {d} days
          </button>
        ))}
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Performance by publication window</h2>
        <p className="mb-3 max-w-3xl text-sm text-gray-400">Each window groups predictions by the date they were published, then counts only those that have since been settled. Using publication date prevents a late-settled match from being presented as a newly issued tip.</p>
        <div className="max-w-xs">
          <RateCard stat={stats.headline} label={`Last ${windowDays} days`} big />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">By category</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRACK_RECORD_CATEGORIES.map((cat) => (
            <RateCard key={cat} stat={stats.byCategory[cat]} label={CATEGORY_LABELS[cat] ?? cat} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">By market type</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRACK_RECORD_MARKET_TYPES.map((mt) => (
            <RateCard key={mt} stat={stats.byMarketType[mt]} label={MARKET_LABELS[mt] ?? mt} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent tips</h2>
        <div className="overflow-x-auto rounded-xl border border-brand-border">
          <table className="w-full text-sm">
            <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
              <tr>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Pick</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Settled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {data.recentTips.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2">
                    <MatchLink homeTeam={t.homeTeam} awayTeam={t.awayTeam} kickoff={t.kickoff} />
                  </td>
                  <td className="px-3 py-2 text-gray-400">{CATEGORY_LABELS[t.category] ?? t.category}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{t.pick}</div>
                    <div className="text-xs text-gray-400">{t.market}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`chip ${OUTCOME_STYLES[t.outcome] ?? "bg-brand-border"}`}>{t.outcome}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-400">{formatDate(t.settledAt)}</td>
                </tr>
              ))}
              {data.recentTips.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-400">No settled tips yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="calculation-heading">
        <h2 id="calculation-heading" className="text-lg font-semibold">How these figures are calculated</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-300">
          <li>Only predictions that were published and later settled are included.</li>
          <li>Win rate is wins divided by wins plus losses. Void outcomes are shown but excluded from that denominator.</li>
          <li>A percentage is hidden until its category, market or period has at least {MIN_SETTLED_SAMPLE_SIZE} decided results.</li>
          <li>Past results describe historical performance; they do not guarantee the outcome of a future match.</li>
        </ul>
        <p className="mt-4 text-sm text-gray-400">
          Read the <Link href="/methodology" className="text-brand hover:underline">prediction methodology</Link> for the evidence used before publication, or browse <Link href="/predictions" className="text-brand hover:underline">today&apos;s football predictions</Link>.
        </p>
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TrendCard } from "@/components/TrendCard";
import type { TrendCard as TrendCardData } from "@/lib/topTrends";
import { TREND_PERIODS, TREND_PERIOD_LABELS, TREND_PERIOD_POSSESSIVE, type TrendPeriod } from "@/lib/trendCards";

type Trends = Record<TrendPeriod, TrendCardData[]>;

/**
 * The "Top trends" panel beside every prediction page: the strongest trend per
 * fixture for today, tomorrow and the weekend. All three lists arrive in one
 * request, so switching tabs is instant.
 */
export function TopTrendsPanel() {
  const [trends, setTrends] = useState<Trends | null>(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<TrendPeriod | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/top-trends")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((x: { trends: Trends }) => {
        if (!active) return;
        setTrends(x.trends);
        // Open on the first period that has something to show.
        setPeriod(TREND_PERIODS.find((p) => x.trends[p]?.length) ?? "today");
      })
      .catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null;
  const current = period ?? "today";
  const cards = trends?.[current] ?? [];

  return (
    <section aria-labelledby="top-trends-heading" className="overflow-hidden rounded-lg border border-brand-border bg-brand-card/30">
      <h2 id="top-trends-heading" className="bg-gray-700 px-3 py-2 text-lg font-bold text-white">Top trends</h2>
      <div role="tablist" aria-label="Trend period" className="flex gap-2 p-3">
        {TREND_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === current}
            disabled={!trends}
            onClick={() => setPeriod(p)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm transition-colors ${
              p === current ? "bg-gray-700 text-white" : "bg-brand-bg text-gray-400 hover:text-brand"
            }`}
          >
            {TREND_PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="space-y-2 px-3 pb-3">
        {!trends ? (
          Array.from({ length: 4 }, (_, i) => <div key={i} aria-hidden className="h-32 animate-pulse rounded-lg bg-brand-card/60" />)
        ) : cards.length ? (
          cards.map((card) => <TrendCard key={card.id} card={card} />)
        ) : (
          <p className="rounded-lg bg-brand-bg px-3 py-4 text-sm text-gray-400">No verified trends for {TREND_PERIOD_POSSESSIVE[current]} fixtures yet.</p>
        )}
        <Link href={`/match-insights?period=${current}`} prefetch={false} className="block rounded-md py-2 text-center text-sm font-semibold text-brand hover:underline">
          See all {TREND_PERIOD_POSSESSIVE[current]} trends →
        </Link>
      </div>
    </section>
  );
}

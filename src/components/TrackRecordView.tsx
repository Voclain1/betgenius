"use client";
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

const CATEGORY_LABELS: Record<string, string> = {
  FEATURED: "Featured",
  GENIUS: "Genius",
  TODAY: "Today",
  BANKER: "Banker",
  VIP: "VIP",
  PREMIUM: "Premium",
};

const MARKET_LABELS: Record<string, string> = {
  MATCH_WINNER: "Match Winner",
  DOUBLE_CHANCE: "Double Chance",
  OVER_UNDER: "Total Goals",
  BTTS: "Both Teams to Score",
  CORRECT_SCORE: "Correct Score",
};

const OUTCOME_STYLES: Record<string, string> = {
  WON: "bg-emerald-500/20 text-emerald-300",
  LOST: "bg-red-500/20 text-red-300",
  VOID: "bg-gray-500/20 text-gray-300",
};

function RateCard({ stat, label, big }: { stat: WinRateStat; label: string; big?: boolean }) {
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Track record</h1>
        <p className="text-sm text-gray-400">
          Every settled tip counts here, win or lose — {data.totalSettledAllTime} settled all-time. Void pushes are excluded from win rate.
        </p>
      </div>

      <div className="flex gap-2">
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
        <h2 className="mb-3 text-lg font-semibold">Overall</h2>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {data.recentTips.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2">{t.homeTeam ? `${t.homeTeam} vs ${t.awayTeam}` : "—"}</td>
                  <td className="px-3 py-2 text-gray-400">{CATEGORY_LABELS[t.category] ?? t.category}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{t.pick}</div>
                    <div className="text-xs text-gray-400">{t.market}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`chip ${OUTCOME_STYLES[t.outcome] ?? "bg-brand-border"}`}>{t.outcome}</span>
                  </td>
                </tr>
              ))}
              {data.recentTips.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-gray-400">No settled tips yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

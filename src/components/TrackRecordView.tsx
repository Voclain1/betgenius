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
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { PremiumPanel } from "@/components/PremiumPanel";
import { MatchLink } from "@/components/MatchLink";

const CATEGORY_LABELS: Record<string, string> = {
  FEATURED: "Featured",
  GENIUS: "Genius",
  TODAY: "Today",
  BANKER: "Banker",
  VIP: "VIP",
  PREMIUM: "Premium",
  BET_OF_THE_DAY: "Bet of the Day",
  GOALS: "Goals",
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
    <div className="h-full rounded-3xl border border-brand-border bg-brand-card p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">{label}</div>
      {stat.total === 0 ? (
        <div className="mt-2 text-sm text-gray-500">No settled tips yet</div>
      ) : enough ? (
        <>
          <div className={`mt-1.5 font-black leading-none tabular-nums tracking-tight text-brand ${big ? "text-5xl" : "text-3xl"}`}>
            {Math.round((stat.rate ?? 0) * 100)}
            <span className={big ? "text-2xl text-gray-500" : "text-lg text-gray-500"}>%</span>
          </div>
          <div className="mt-2 text-xs font-semibold tabular-nums text-gray-400">
            {stat.won}W – {stat.lost}L{stat.void ? ` – ${stat.void} void` : ""} ({stat.decided} decided)
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 text-sm font-bold text-amber-300">Not enough data yet</div>
          <div className="mt-1 text-xs text-gray-400">{stat.decided} of {MIN_SETTLED_SAMPLE_SIZE} decided so far</div>
        </>
      )}
    </div>
  );
}

const OUTCOME_TEXT: Record<string, string> = { WON: "text-emerald-400", LOST: "text-red-400", VOID: "text-gray-400" };

export function TrackRecordView({ data }: { data: TrackRecordData }) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const stats = data.windows[windowDays];
  const formatDate = (value: string | null) => value
    ? new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(value))
    : "Not available";
  const allTimeEnough = data.allTime.decided >= MIN_SETTLED_SAMPLE_SIZE && data.allTime.rate != null;

  return (
    <div className="space-y-10">
      <CategoryMasthead
        kicker="Public record"
        title="Football prediction track record"
        blurb="This is the public record of BetGenius predictions after the matches have finished. Wins and losses remain visible, and void selections stay in the sample even though they are excluded from the win-rate calculation."
        dateLabel={`${data.firstPublishedAt ? `Record begins ${formatDate(data.firstPublishedAt)} · ` : ""}Last settlement update ${formatDate(data.lastSettledAt)}`}
        stats={[
          ...(allTimeEnough ? [{ label: "All-time win rate", value: `${Math.round(data.allTime.rate! * 100)}%`, accent: true }] : []),
          { label: "Settled tips", value: String(data.allTime.total) },
          { label: "Won", value: String(data.allTime.won) },
          { label: "Lost / void", value: `${data.allTime.lost} / ${data.allTime.void}` },
        ]}
      />

      <PremiumPanel kicker="Recent form" title="Performance by publication window" id="window-heading" bare>
        <p className="-mt-2 mb-5 max-w-3xl text-sm leading-relaxed text-gray-400">Each window groups predictions by the date they were published, then counts only those that have since been settled. Using publication date prevents a late-settled match from being presented as a newly issued tip.</p>
        <div className="mb-5 inline-flex rounded-2xl border border-brand-border bg-brand-card p-1" aria-label="Track-record period" role="group">
          {WINDOW_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              aria-pressed={windowDays === d}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${windowDays === d ? "bg-brand text-on-brand" : "text-gray-400 hover:text-gray-100"}`}
            >
              Last {d} days
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RateCard stat={stats.headline} label={`Last ${windowDays} days`} big />
        </div>
      </PremiumPanel>

      <PremiumPanel kicker={`Last ${windowDays} days`} title="By category" id="category-heading" bare>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRACK_RECORD_CATEGORIES.map((cat) => (
            <div key={cat} id={`category-${cat.toLowerCase().replaceAll("_", "-")}`} className="scroll-mt-24">
              <RateCard stat={stats.byCategory[cat]} label={CATEGORY_LABELS[cat] ?? cat} />
            </div>
          ))}
        </div>
      </PremiumPanel>

      <PremiumPanel kicker={`Last ${windowDays} days`} title="By market type" id="market-heading" bare>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div id="market-over-25" className="scroll-mt-24">
            <RateCard stat={stats.over25} label="Over 2.5 Goals" />
          </div>
          {TRACK_RECORD_MARKET_TYPES.map((mt) => (
            <div key={mt} id={`market-${mt.toLowerCase().replaceAll("_", "-")}`} className="scroll-mt-24">
              <RateCard stat={stats.byMarketType[mt]} label={MARKET_LABELS[mt] ?? mt} />
            </div>
          ))}
        </div>
      </PremiumPanel>

      <PremiumPanel kicker="Latest settled" title="Recent tips" id="recent-heading" bare>
        <div className="overflow-x-auto rounded-3xl border border-brand-border bg-brand-card">
          <table className="w-full text-sm">
            <thead className="border-b border-brand-border text-left text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
              <tr>
                <th className="px-4 py-3">Match</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Pick</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Settled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {data.recentTips.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-semibold text-gray-100">
                    <MatchLink homeTeam={t.homeTeam} awayTeam={t.awayTeam} kickoff={t.kickoff} />
                  </td>
                  <td className="px-4 py-3 text-gray-400">{CATEGORY_LABELS[t.category] ?? t.category}</td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-gray-100">{t.pick}</div>
                    <div className="text-xs text-gray-400">{t.market}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-black uppercase tracking-[0.14em] ${OUTCOME_TEXT[t.outcome] ?? "text-gray-400"}`}>{t.outcome}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-400">{formatDate(t.settledAt)}</td>
                </tr>
              ))}
              {data.recentTips.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400">No settled tips yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PremiumPanel>

      <PremiumPanel kicker="Method" title="How these figures are calculated" id="calculation-heading">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-gray-300 marker:text-brand">
          <li>Only predictions that were published and later settled are included.</li>
          <li>Win rate is wins divided by wins plus losses. Void outcomes are shown but excluded from that denominator.</li>
          <li>A percentage is hidden until its category, market or period has at least {MIN_SETTLED_SAMPLE_SIZE} decided results.</li>
          <li>Past results describe historical performance; they do not guarantee the outcome of a future match.</li>
        </ul>
        <p className="mt-4 text-sm text-gray-400">
          Read the <Link href="/methodology" className="font-semibold text-brand hover:underline">prediction methodology</Link> for the evidence used before publication, or browse <Link href="/predictions" className="font-semibold text-brand hover:underline">today&apos;s football predictions</Link>.
        </p>
      </PremiumPanel>
    </div>
  );
}

import Link from "next/link";
import {
  MIN_SETTLED_SAMPLE_SIZE,
  TRACK_RECORD_CATEGORIES,
  TRACK_RECORD_MARKET_TYPES,
  type MonthTrackRecord,
  type WinRateStat,
} from "@/lib/trackRecord";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { PremiumPanel } from "@/components/PremiumPanel";
import { MatchLink } from "@/components/MatchLink";

export const CATEGORY_LABELS: Record<string, string> = {
  FEATURED: "Featured",
  GENIUS: "Genius",
  TODAY: "Today",
  BANKER: "Banker",
  VIP: "VIP",
  PREMIUM: "Premium",
  BET_OF_THE_DAY: "Bet of the Day",
  GOALS: "Goals",
};

export const MARKET_LABELS: Record<string, string> = {
  MATCH_WINNER: "Match Winner",
  DOUBLE_CHANCE: "Double Chance",
  OVER_UNDER: "Total Goals",
  BTTS: "Both Teams to Score",
  CORRECT_SCORE: "Correct Score",
};


/** Exported for reuse by the league/team scoped pages, which show the same win-rate-card shape for a single scoped stat. */
export function RateCard({ stat, label, big, counts = true }: {
  stat: WinRateStat;
  label: string;
  big?: boolean;
  /** False on /track-record, which reports rates only: no win/loss or sample counts. */
  counts?: boolean;
}) {
  const enough = stat.decided >= MIN_SETTLED_SAMPLE_SIZE;
  return (
    <div className="h-full rounded-3xl border border-brand-border bg-brand-card p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">{label}</div>
      {stat.total === 0 ? (
        <div className="mt-2 text-sm text-gray-500">{counts ? "No settled tips yet" : "No results yet"}</div>
      ) : enough ? (
        <>
          <div className={`mt-1.5 font-black leading-none tabular-nums tracking-tight text-brand ${big ? "text-5xl" : "text-3xl"}`}>
            {Math.round((stat.rate ?? 0) * 100)}
            <span className={big ? "text-2xl text-gray-500" : "text-lg text-gray-500"}>%</span>
          </div>
          {counts && (
            <div className="mt-2 text-xs font-semibold tabular-nums text-gray-400">
              {stat.won}W – {stat.lost}L{stat.void ? ` – ${stat.void} void` : ""} ({stat.decided} decided)
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mt-2 text-sm font-bold text-amber-300">Not enough data yet</div>
          <div className="mt-1 text-xs text-gray-400">{counts ? `${stat.decided} of ${MIN_SETTLED_SAMPLE_SIZE} decided so far` : "Too few results yet for a fair rate"}</div>
        </>
      )}
    </div>
  );
}

const OUTCOME_TEXT: Record<string, string> = { WON: "text-emerald-400", LOST: "text-red-400", VOID: "text-gray-400" };

/** Links to the closed months' reports (SEO-304), newest first. */
export function PastMonths({ months }: { months: Array<{ key: string; label: string }> }) {
  if (!months.length) return null;
  return (
    <PremiumPanel kicker="Archive" title="Past months" id="archive-heading" bare>
      <p className="-mt-2 mb-4 max-w-3xl text-sm leading-relaxed text-gray-400">Each closed month keeps its own report: the final rates by category and market, worked out from the published picks themselves.</p>
      <ul className="flex flex-wrap gap-3">
        {months.map((m) => (
          <li key={m.key}>
            <Link href={`/track-record/${m.key}`} className="inline-flex rounded-2xl border border-brand-border bg-brand-card px-4 py-2.5 text-sm font-bold text-gray-100 transition hover:border-brand hover:text-brand">
              {m.label}
            </Link>
          </li>
        ))}
      </ul>
    </PremiumPanel>
  );
}

export function TrackRecordView({ data, pastMonths = [] }: { data: MonthTrackRecord; pastMonths?: Array<{ key: string; label: string }> }) {
  const formatDate = (value: string | null) => value
    ? new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(value))
    : "Not available";
  const rate = (stat: WinRateStat) => stat.decided >= MIN_SETTLED_SAMPLE_SIZE && stat.rate != null ? `${Math.round(stat.rate * 100)}%` : null;
  const monthRate = rate(data.headline);
  const month = data.monthLabel;

  return (
    <div className="space-y-10">
      <CategoryMasthead
        kicker="Public record"
        title={`Track record: ${month}`}
        blurb="Every BetGenius prediction settled this month, wins and losses alike. The record runs for the calendar month and starts again on the 1st, so it always describes how the picks are doing now."
        dateLabel={`${month} · Last settlement update ${formatDate(data.lastSettledAt)}`}
        stats={[
          { label: `${month.split(" ")[0]} win rate`, value: monthRate ?? "Building", accent: !!monthRate },
          ...(data.previousMonth ? [{ label: `${data.previousMonth.label.split(" ")[0]} closed at`, value: `${Math.round(data.previousMonth.rate * 100)}%` }] : []),
        ]}
      />

      <PremiumPanel kicker={month} title="By category" id="category-heading" bare>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRACK_RECORD_CATEGORIES.map((cat) => (
            <div key={cat} id={`category-${cat.toLowerCase().replaceAll("_", "-")}`} className="scroll-mt-24">
              <RateCard stat={data.byCategory[cat]} label={CATEGORY_LABELS[cat] ?? cat} counts={false} />
            </div>
          ))}
        </div>
      </PremiumPanel>

      <PremiumPanel kicker={month} title="By market type" id="market-heading" bare>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div id="market-over-25" className="scroll-mt-24">
            <RateCard stat={data.over25} label="Over 2.5 Goals" counts={false} />
          </div>
          {TRACK_RECORD_MARKET_TYPES.map((mt) => (
            <div key={mt} id={`market-${mt.toLowerCase().replaceAll("_", "-")}`} className="scroll-mt-24">
              <RateCard stat={data.byMarketType[mt]} label={MARKET_LABELS[mt] ?? mt} counts={false} />
            </div>
          ))}
        </div>
      </PremiumPanel>

      <PremiumPanel kicker="Latest settled" title="Recent results" id="recent-heading" bare>
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
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400">No results settled yet this month</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PremiumPanel>

      <PastMonths months={pastMonths} />

      <PremiumPanel kicker="Method" title="How these figures are calculated" id="calculation-heading">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-gray-300 marker:text-brand">
          <li>The record covers one calendar month, West Africa Time: every published prediction whose match kicked off this month and has since been settled. It starts again on the 1st.</li>
          <li>Win rate is wins divided by wins plus losses. Void outcomes are excluded from that denominator.</li>
          <li>A rate is shown only once its category, market or month has at least {MIN_SETTLED_SAMPLE_SIZE} decided results; early in the month it says so instead.</li>
          <li>VIP, Premium and Banker each keep a day-by-day results list at the foot of their own page.</li>
          <li>Past results describe historical performance; they do not guarantee the outcome of a future match.</li>
        </ul>
        <p className="mt-4 text-sm text-gray-400">
          Read the <Link href="/methodology" className="font-semibold text-brand hover:underline">prediction methodology</Link> for the evidence used before publication, or browse <Link href="/predictions" className="font-semibold text-brand hover:underline">today&apos;s football predictions</Link>.
        </p>
      </PremiumPanel>
    </div>
  );
}

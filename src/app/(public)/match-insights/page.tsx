import type { Metadata } from "next";
import Link from "next/link";
import { TrendCard } from "@/components/TrendCard";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { loadTrendPage } from "@/lib/topTrends";
import { TREND_PERIODS, TREND_PERIOD_LABELS, TREND_PERIOD_POSSESSIVE, isTrendPeriod } from "@/lib/trendCards";

export const metadata: Metadata = {
  title: "Match Insights — verified football trends",
  description: "Verified team streaks and recent-match trends for today's, tomorrow's and this weekend's fixtures, calculated from completed matches.",
  alternates: { canonical: "/match-insights" },
};

const PAGE_SIZE = 24;

export default async function MatchInsightsPage({ searchParams }: { searchParams: { period?: string; page?: string } }) {
  const period = isTrendPeriod(searchParams.period) ? searchParams.period : "today";
  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);
  const { cards, total } = await loadTrendPage(period, page, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: string, n = 1) => `/match-insights?period=${p}${n > 1 ? `&page=${n}` : ""}`;

  return (
    <div className="space-y-6 sm:space-y-8">
      <CategoryMasthead
        kicker="Insights"
        title="Match Insights"
        blurb="Streaks and trends for teams with an upcoming tip, from their most recent completed competitive matches. Results are 90-minute scores, the basis bookmakers settle on, and friendlies are excluded. Trends describe what has happened, not what will."
        dateLabel={`For ${TREND_PERIOD_POSSESSIVE[period]} fixtures`}
        stats={[{ label: total === 1 ? "Verified trend" : "Verified trends", value: String(total) }]}
      />

      <nav aria-label="Trend period" className="inline-flex rounded-2xl border border-brand-border bg-brand-card p-1">
        {TREND_PERIODS.map((p) => (
          <Link
            key={p}
            href={href(p)}
            prefetch={false}
            aria-current={p === period ? "page" : undefined}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${p === period ? "bg-brand text-on-brand" : "text-gray-400 hover:text-gray-100"}`}
          >
            {TREND_PERIOD_LABELS[p]}
          </Link>
        ))}
      </nav>

      {cards.length === 0 ? (
        <div className="rounded-3xl border border-brand-border bg-brand-card p-5">
          <h2 className="font-black text-gray-100">No verified trends for {TREND_PERIOD_POSSESSIVE[period]} fixtures yet</h2>
          <p className="mt-1 text-sm text-gray-400">
            A trend appears once a team has at least five verified recent matches and its history was checked within the
            last twelve hours. Check back closer to kickoff.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => <TrendCard key={card.id} card={card} />)}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center gap-4 text-sm font-bold">
          {page > 1 && <Link className="text-brand" prefetch={false} href={href(period, page - 1)}>← Previous</Link>}
          <span className="text-gray-500">Page {page} of {pages}</span>
          {page < pages && <Link className="text-brand" prefetch={false} href={href(period, page + 1)}>Next →</Link>}
        </div>
      )}
    </div>
  );
}

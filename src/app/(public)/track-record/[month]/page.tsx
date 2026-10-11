import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MIN_SETTLED_SAMPLE_SIZE,
  TRACK_RECORD_CATEGORIES,
  TRACK_RECORD_MARKET_TYPES,
  closedMonthKey,
  closedMonthsSince,
  getRecordStartKey,
  getTrackRecordForMonth,
  monthHighlights,
  monthLabel,
} from "@/lib/trackRecord";
import { CATEGORY_LABELS, MARKET_LABELS, PastMonths, RateCard } from "@/components/TrackRecordView";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { PremiumPanel } from "@/components/PremiumPanel";
import { JsonLd, breadcrumbJsonLd } from "@/lib/seo";

// A closed month changes only if a settlement is corrected; six hours keeps a
// correction visible within the day without rebuilding the report per visit.
export const revalidate = 21600;

/** The month's key if it has a report: closed, and not before the record starts. */
async function resolve(param: string): Promise<string | null> {
  const key = closedMonthKey(param);
  if (!key) return null;
  const start = await getRecordStartKey();
  return start && key >= start ? key : null;
}

export async function generateMetadata({ params }: { params: { month: string } }): Promise<Metadata> {
  const key = await resolve(params.month);
  if (!key) return { title: "Track record", robots: { index: false, follow: true } };
  const data = await getTrackRecordForMonth(key);
  const enough = data.headline.decided >= MIN_SETTLED_SAMPLE_SIZE && data.headline.rate != null;
  return {
    title: `Football Prediction Results: ${data.monthLabel}`,
    description: enough
      ? `BetGenius predictions won ${Math.round(data.headline.rate! * 100)}% of settled picks in ${data.monthLabel}. Final rates by category and market, wins and losses alike.`
      : `The BetGenius record for ${data.monthLabel}, by category and market.`,
    alternates: { canonical: `/track-record/${key}` },
    // A month too thin to state a rate is kept for readers but not offered to search.
    robots: enough ? undefined : { index: false, follow: true },
  };
}

export default async function MonthReportPage({ params }: { params: { month: string } }) {
  const key = await resolve(params.month);
  if (!key) notFound();
  const [data, start] = await Promise.all([getTrackRecordForMonth(key), getRecordStartKey()]);
  const enough = data.headline.decided >= MIN_SETTLED_SAMPLE_SIZE && data.headline.rate != null;
  const findings = monthHighlights(data, { category: CATEGORY_LABELS, market: MARKET_LABELS });
  const others = closedMonthsSince(start).filter((k) => k !== key).map((k) => ({ key: k, label: monthLabel(k) }));
  const month = data.monthLabel.split(" ")[0];

  return (
    <div className="space-y-10">
      <JsonLd data={[breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Track record", path: "/track-record" }, { name: data.monthLabel, path: `/track-record/${key}` }])]} />
      <CategoryMasthead
        kicker="Monthly report"
        title={`Results: ${data.monthLabel}`}
        blurb={`How every BetGenius prediction settled in ${data.monthLabel}, wins and losses alike: the final rates for the month, by category and by market.`}
        dateLabel={`${data.monthLabel} · closed`}
        stats={[
          { label: `${month} win rate`, value: enough ? `${Math.round(data.headline.rate! * 100)}%` : "Too few results", accent: enough },
          ...(data.previousMonth ? [{ label: `${data.previousMonth.label.split(" ")[0]} for comparison`, value: `${Math.round(data.previousMonth.rate * 100)}%` }] : []),
        ]}
      />

      {findings.length > 0 && (
        <PremiumPanel kicker={data.monthLabel} title="What the month showed" id="findings-heading">
          <ul className="space-y-2 text-[15px] leading-7 text-gray-200">
            {findings.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </PremiumPanel>
      )}

      <PremiumPanel kicker={data.monthLabel} title="By category" id="category-heading" bare>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRACK_RECORD_CATEGORIES.map((cat) => (
            <RateCard key={cat} stat={data.byCategory[cat]} label={CATEGORY_LABELS[cat] ?? cat} counts={false} />
          ))}
        </div>
      </PremiumPanel>

      <PremiumPanel kicker={data.monthLabel} title="By market type" id="market-heading" bare>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RateCard stat={data.over25} label="Over 2.5 Goals" counts={false} />
          {TRACK_RECORD_MARKET_TYPES.map((mt) => (
            <RateCard key={mt} stat={data.byMarketType[mt]} label={MARKET_LABELS[mt] ?? mt} counts={false} />
          ))}
        </div>
      </PremiumPanel>

      <PremiumPanel kicker="Method" title="How this report is kept" id="method-heading">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-gray-300 marker:text-brand">
          <li>Every published prediction whose match kicked off in {data.monthLabel} (West Africa Time) and has been settled is included. Nothing is left out for having lost.</li>
          <li>Win rate is wins divided by wins plus losses; void results are excluded from that figure.</li>
          <li>The report is worked out from the published picks each time it is built, not stored separately. If a result is corrected after the month closes, the correction shows here.</li>
          <li>A rate is shown only once there are at least {MIN_SETTLED_SAMPLE_SIZE} decided results behind it.</li>
          <li>Past results describe what happened; they do not guarantee future outcomes.</li>
        </ul>
        <p className="mt-4 text-sm text-gray-400">
          See <Link href="/track-record" className="font-semibold text-brand hover:underline">this month&apos;s live record</Link> or the{" "}
          <Link href="/methodology" className="font-semibold text-brand hover:underline">prediction methodology</Link>.
        </p>
      </PremiumPanel>

      <PastMonths months={others} />
    </div>
  );
}

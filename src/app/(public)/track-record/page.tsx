import type { Metadata } from "next";
import { closedMonthsSince, getMonthTrackRecord, getRecordStartKey, getSettledTotals, monthLabel, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { TrackRecordView } from "@/components/TrackRecordView";
import { CategoryMasthead } from "@/components/CategoryMasthead";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  // Indexability follows the all-time sample (a grouped count, never shown),
  // so the page does not drop out of the index every time a month begins.
  const totals = await getSettledTotals();
  if (totals.total < MIN_SETTLED_SAMPLE_SIZE) {
    return {
      title: "Football Prediction Track Record",
      description: "Our real settled prediction results, published transparently once there's a fair sample size to judge.",
      alternates: { canonical: "/track-record" },
      robots: { index: false, follow: true },
    };
  }

  const data = await getMonthTrackRecord();
  const rate = data.headline.decided >= MIN_SETTLED_SAMPLE_SIZE && data.headline.rate != null
    ? `${Math.round(data.headline.rate * 100)}% win rate in ${data.monthLabel}. `
    : "";
  return {
    title: "Football Prediction Track Record",
    description: `${rate}Every settled BetGenius prediction this month, win or lose, by category and market.`,
    alternates: { canonical: "/track-record" },
  };
}

export default async function TrackRecordPage() {
  const totals = await getSettledTotals();

  if (totals.total < MIN_SETTLED_SAMPLE_SIZE) {
    return (
      <div className="space-y-8">
        <CategoryMasthead kicker="Public record" title="Track record" blurb="Every settled prediction, wins and losses alike, published once there is a fair sample to judge." stats={[]} />
        <div className="rounded-3xl border border-brand-border bg-brand-card p-6">
          <p className="text-lg font-black text-gray-100">Not enough data yet</p>
          <p className="mt-2 text-sm text-gray-400">We only publish real numbers once there&apos;s a meaningful sample to judge fairly. Check back soon.</p>
        </div>
      </div>
    );
  }

  const [data, startKey] = await Promise.all([getMonthTrackRecord(), getRecordStartKey()]);
  const pastMonths = closedMonthsSince(startKey).map((key) => ({ key, label: monthLabel(key) }));
  return <TrackRecordView data={data} pastMonths={pastMonths} />;
}

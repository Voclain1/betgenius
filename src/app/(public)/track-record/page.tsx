import type { Metadata } from "next";
import { getTrackRecordData, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { TrackRecordView } from "@/components/TrackRecordView";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const data = await getTrackRecordData();

  if (data.totalSettledAllTime < MIN_SETTLED_SAMPLE_SIZE) {
    return {
      title: "Track Record",
      description: "Our real settled prediction results, published transparently once there's a fair sample size to judge.",
      robots: { index: false, follow: true },
    };
  }

  const rate30 = data.windows[30].headline.rate;
  const rateText = rate30 != null ? `${Math.round(rate30 * 100)}% win rate over the last 30 days, ` : "";
  return {
    title: "Track Record",
    description: `${rateText}${data.totalSettledAllTime} settled tips all-time — every result, win or lose, published transparently.`,
  };
}

export default async function TrackRecordPage() {
  const data = await getTrackRecordData();

  if (data.totalSettledAllTime < MIN_SETTLED_SAMPLE_SIZE) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Track record</h1>
        <div className="card">
          <p className="text-lg font-semibold">Not enough data yet</p>
          <p className="mt-2 text-sm text-gray-400">
            We only publish real numbers once there's a meaningful sample to judge fairly — {data.totalSettledAllTime} of{" "}
            {MIN_SETTLED_SAMPLE_SIZE} settled tips so far. Check back soon.
          </p>
        </div>
      </div>
    );
  }

  return <TrackRecordView data={data} />;
}

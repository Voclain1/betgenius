import type { Metadata } from "next";
import { getTrackRecordData, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { TrackRecordView } from "@/components/TrackRecordView";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const data = await getTrackRecordData();

  if (data.totalSettledAllTime < MIN_SETTLED_SAMPLE_SIZE) {
    return {
      title: "Football Prediction Track Record",
      description: "Our real settled prediction results, published transparently once there's a fair sample size to judge.",
      alternates: { canonical: "/track-record" },
      robots: { index: false, follow: true },
    };
  }

  const last30 = data.windows[30].headline;
  const rateText = last30.decided >= MIN_SETTLED_SAMPLE_SIZE && last30.rate != null
    ? `${Math.round(last30.rate * 100)}% win rate over the last 30 days, `
    : "";
  return {
    title: "Football Prediction Track Record",
    description: `${rateText}${data.totalSettledAllTime} settled tips all-time — every result, win or lose, published transparently.`,
    alternates: { canonical: "/track-record" },
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

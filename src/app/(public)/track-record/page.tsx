import { getTrackRecordData, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { TrackRecordView } from "@/components/TrackRecordView";

export const revalidate = 300;

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

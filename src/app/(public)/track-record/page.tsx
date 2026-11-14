import { JsonLd, breadcrumbJsonLd } from "@/lib/seo";
import {
  getSettledTotals,
  getRecordStartKey,
  closedMonthsSince,
  monthLabel,
} from "@/lib/trackRecord";
import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { ANONYMOUS } from "@/lib/entitlement";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { loadPerformance } from "@/lib/performanceData";
import {
  performanceFilter,
  performanceSummary,
} from "@/lib/performanceTransparency";
import { PerformanceDashboard } from "@/components/PerformanceDashboard";
export const dynamic = "force-dynamic";
const publicRecord = cache(async () =>
  loadPerformance(performanceFilter({}), ANONYMOUS),
);
export async function generateMetadata({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<Metadata> {
  const totals = await getSettledTotals();
  const viewer = await getViewerEntitlement();
  return {
    title: "Prediction Results & Win Rate",
    description:
      "Browse past football predictions, wins, losses and monthly results. See how win rates and estimated returns are calculated.",
    alternates: { canonical: "/track-record" },
    robots:
      viewer.userId || Object.keys(searchParams).length || totals.total < 20
        ? { index: false, follow: true }
        : undefined,
  };
}
export default async function TrackRecordPage({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const viewer = await getViewerEntitlement(),
    filter = performanceFilter(searchParams);
  const data =
    !viewer.userId && Object.keys(searchParams).length === 0
      ? await publicRecord()
      : await loadPerformance(filter, viewer);
  const archive = closedMonthsSince(await getRecordStartKey()).slice(0, 12);
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Track record", path: "/track-record" },
        ])}
      />
      <PerformanceDashboard
        rows={data.rows}
        filter={filter}
        truncated={data.truncated}
        start={data.bounds.start}
        end={data.bounds.end}
        signedIn={!!viewer.userId}
      />
      <details className="mt-8 border-t border-brand-border pt-2">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
          Previous Monthly Results
        </summary>
        <nav aria-label="Monthly reports" className="flex flex-wrap gap-3">
          {archive.map((key) => (
            <Link
              key={key}
              href={`/track-record/${key}`}
              className="inline-flex min-h-11 items-center text-xs text-brand"
            >
              {monthLabel(key)}
            </Link>
          ))}
        </nav>
        <Link
          href="/methodology"
          className="inline-flex min-h-11 items-center text-xs text-gray-400"
        >
          How our predictions work →
        </Link>
      </details>
    </>
  );
}

import Link from "next/link";
import { FEED_DAYS, dayHref, feedDayTabLabel, feedDayOffset, type FeedDay } from "@/lib/feedDays";
import { lagosDayLabel } from "@/lib/lagosDate";

/**
 * Shared nine-day navigation for the homepage, category and market feeds.
 * One route/DB day per click, no scroll-only hidden dates on mobile.
 */
export function FeedDayTabs({ basePath, active }: { basePath: string; active: FeedDay }) {
  const anchor = new Date();
  return (
    <nav aria-label="Select day" className="grid w-full grid-cols-3 gap-1 rounded-2xl border border-brand-border bg-brand-card p-1 sm:grid-cols-5 lg:grid-cols-9">
      {FEED_DAYS.map((day) => (
        <Link
          key={day}
          href={dayHref(basePath, day)}
          aria-current={day === active ? "page" : undefined}
          title={lagosDayLabel(feedDayOffset(day), anchor)}
          className={`inline-flex min-h-10 min-w-0 items-center justify-center rounded-xl px-1.5 py-2 text-center text-xs font-bold leading-tight transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-sm ${
            day === active ? "bg-brand text-on-brand" : "text-gray-400 hover:bg-white/5 hover:text-gray-100"
          }`}
        >
          {feedDayTabLabel(day, anchor)}
        </Link>
      ))}
    </nav>
  );
}

import Link from "next/link";
import { FEED_DAYS, feedDayHref, type FeedDay } from "@/lib/categoryPredictions";

const LABELS: Record<FeedDay, string> = {
  yesterday: "Yesterday",
  today: "Today",
  tomorrow: "Tomorrow",
};

/**
 * Day switcher for a category feed.
 *
 * Deliberately links, not buttons, and therefore a SERVER component. PillTabs
 * in MatchList.tsx is the visual reference, but it is a client component that
 * pushes router state — appropriate for Fixtures, where the data is fetched in
 * the browser. Here the whole page is server-rendered per day, so a link gives
 * the same result with no client bundle, and the selected day is shareable,
 * bookmarkable and reload-safe because it IS the URL.
 *
 * "Today" is the bare path rather than ?date=today, so the default view keeps
 * one canonical URL instead of two that render identically.
 */
export function FeedDayTabs({ slug, active }: { slug: string; active: FeedDay }) {
  return (
    <nav aria-label="Select day" className="inline-flex rounded-lg border border-brand-border bg-brand-card p-1">
      {FEED_DAYS.map((day) => {
        const isActive = day === active;
        return (
          <Link
            key={day}
            href={feedDayHref(slug, day)}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              isActive ? "bg-brand text-on-brand" : "text-gray-400 hover:text-gray-100"
            }`}
          >
            {LABELS[day]}
          </Link>
        );
      })}
    </nav>
  );
}

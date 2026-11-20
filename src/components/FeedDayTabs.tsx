import { VISIBLE_FEED_DAYS, dayHref, feedDayTile, type FeedDay } from "@/lib/feedDays";
import { FeedDayScroller } from "./FeedDayScroller";

/**
 * Server-render the date labels once, so the initial mobile and client views
 * cannot disagree across midnight in Lagos. The tiny client wrapper only
 * handles the scroll position; predictions and access controls stay server-side.
 */
export function FeedDayTabs({ basePath, active }: { basePath: string; active: FeedDay }) {
  const anchor = new Date();
  const items = VISIBLE_FEED_DAYS.map(day => ({
    day,
    href: dayHref(basePath, day),
    ...feedDayTile(day, anchor),
  }));
  return <FeedDayScroller items={items} active={active} />;
}

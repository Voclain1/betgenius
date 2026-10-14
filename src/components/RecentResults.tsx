"use client";
import { useMemo, useState } from "react";
import { GroupedMatches, groupByLeague, type MatchLinkIndex } from "@/components/MatchList";
import type { FixtureRow } from "@/lib/football/api-football";

// Smaller than the Fixtures page's 10: a homepage block sitting above the
// Genius/Featured tables, so it shouldn't push them off-screen on mobile. More
// competitions open with "Show more".
const GROUP_PAGE_SIZE = 3;

/**
 * Recently finished matches on the homepage, rendered with the same MatchList
 * primitives as Fixtures and Livescores.
 *
 * The rows arrive from the server (getRecentResults in
 * src/lib/recentResultsSnapshot.ts): every men's top and mid-tier competition,
 * best competitions first, from one shared copy. Nothing is fetched here, and
 * the homepage does not render this block at all when `rows` is empty.
 *
 * `linkIndex` (from getPublishedMatchIndex) makes the rows we have published
 * predictions for link through to their match page; the rest stay plain text.
 */
export function RecentResults({ rows, linkIndex }: { rows: FixtureRow[]; linkIndex?: MatchLinkIndex }) {
  const [visibleGroupCount, setVisibleGroupCount] = useState(GROUP_PAGE_SIZE);
  const groups = useMemo(() => groupByLeague(rows), [rows]);
  return (
    <div className="space-y-3">
      <GroupedMatches
        groups={groups}
        visibleCount={visibleGroupCount}
        onShowMore={() => setVisibleGroupCount((c) => c + GROUP_PAGE_SIZE)}
        pageSize={GROUP_PAGE_SIZE}
        linkIndex={linkIndex}
      />
    </div>
  );
}

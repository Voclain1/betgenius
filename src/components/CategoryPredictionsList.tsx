import { Fragment } from "react";
import { PredictionCard, type PredictionRow } from "@/components/PredictionCard";
import { PredictionsTable, type PredictionTableRow } from "@/components/PredictionsTable";
import { AdInFeed } from "@/components/ads/AdPlacements";
import { feedAdPositions } from "@/lib/ads";
import type { PredictionCategory } from "@/lib/enums";
import type { PredictionView } from "@/lib/predictionView";

/**
 * Rendering shared between /predictions/[category] and the account dashboard
 * once each has already resolved which rows a viewer is allowed to see —
 * TODAY renders as a table, every other category as a card grid.
 *
 * `view` lets a non-TODAY feed render as the same table instead ("compact"):
 * no reasoning, one row per pick, same rows in the same order and the same
 * in-feed ad positions. TODAY ignores it and is always the table. The default
 * is "detailed", so callers that pass nothing — the dashboard included — get
 * exactly the markup they had before the option existed.
 *
 * `withAds` IS OPT-IN AND MUST STAY THAT WAY. The account dashboard renders
 * this same component, and /dashboard is one of the routes that carries no
 * advertising at all. Defaulting this to true would put ads there through a
 * shared component rather than through the route's own file, which is exactly
 * the shape of mistake scripts/check-ad-placement.ts now walks the import
 * graph to catch.
 */
export function CategoryPredictionsList({
  category,
  rows,
  withAds = false,
  view = "detailed",
  reasoningExcerpt = false,
  linkRows = false,
}: {
  /** The feed's category. Omitted on team, league and cup pages, which mix categories. */
  category?: PredictionCategory;
  rows: (PredictionRow & PredictionTableRow)[];
  withAds?: boolean;
  view?: PredictionView;
  /** Detailed cards show a short reasoning excerpt with "Show full reasoning" (team pages). */
  reasoningExcerpt?: boolean;
  /** Compact rows link to the match's prediction page (see PredictionsTable). */
  linkRows?: boolean;
}) {
  if (rows.length === 0) {
    return <div className="card text-gray-400">{emptyFeedMessage(category)}</div>;
  }

  // Empty on the dashboard. A feed too short to interrupt (Banker, VIP,
  // Premium on most days) gets one band after its last pick instead of none.
  const between = withAds ? feedAdPositions(rows.length) : [];
  const positions = withAds && between.length === 0 ? [rows.length] : between;

  if (category === "TODAY" || view === "compact") {
    return (
      <PredictionsTable
        rows={rows}
        linkRows={linkRows}
        ads={positions.map((after, i) => ({ after, node: <AdInFeed index={i} /> }))}
      />
    );
  }

  // No insertions: the original single grid, unchanged, rather than a
  // one-chunk wrapper that would alter the markup for no reason.
  if (positions.length === 0) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => (
          <PredictionCard key={p.id} p={p} reasoningExcerpt={reasoningExcerpt} />
        ))}
      </div>
    );
  }

  // Each group is its own complete grid, so a band sits BETWEEN two grids
  // rather than inside one. That is what guarantees a card is never split:
  // there is no arrangement of columns in which a full-width sibling of the
  // grid can land in the middle of a card.
  const groups: (PredictionRow & PredictionTableRow)[][] = [];
  let cursor = 0;
  for (const position of positions) {
    groups.push(rows.slice(cursor, position));
    cursor = position;
  }
  groups.push(rows.slice(cursor));

  return (
    <div className="space-y-4">
      {groups.map((group, i) => (
        <Fragment key={i}>
          {group.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {group.map((p) => (
                <PredictionCard key={p.id} p={p} reasoningExcerpt={reasoningExcerpt} />
              ))}
            </div>
          )}
          {i < groups.length - 1 && <AdInFeed index={i} />}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * What an empty feed says. The paid tiers explain their bar instead of looking
 * broken: a day with no qualifying pick is a normal day for them (the floors
 * are hard and never relaxed to fill the feed), and readers paying for the
 * tier deserve to know that is why, not to wonder whether it stopped working.
 * The numbers are VIP_CONFIDENCE_FLOOR and PREMIUM_CONFIDENCE_FLOOR (src/lib/geniusCuration.ts).
 */
export function emptyFeedMessage(category?: PredictionCategory): string {
  if (category === "VIP" || category === "PREMIUM") {
    const name = category === "PREMIUM" ? "Premium" : "VIP";
    return `No ${name} tips for this day yet. New ${name} predictions are added through the day as bookmakers open their markets.`;
  }
  return "No published tips in this category yet.";
}

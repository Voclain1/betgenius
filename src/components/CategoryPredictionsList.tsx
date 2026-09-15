import { Fragment } from "react";
import { PredictionCard, type PredictionRow } from "@/components/PredictionCard";
import { PredictionsTable, type PredictionTableRow } from "@/components/PredictionsTable";
import { AdInFeed } from "@/components/ads/AdPlacements";
import { feedAdPositions } from "@/lib/ads";
import type { PredictionCategory } from "@/lib/enums";

/**
 * Rendering shared between /predictions/[category] and the account dashboard
 * once each has already resolved which rows a viewer is allowed to see —
 * TODAY renders as a table, every other category as a card grid.
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
}: {
  category: PredictionCategory;
  rows: (PredictionRow & PredictionTableRow)[];
  withAds?: boolean;
}) {
  if (rows.length === 0) {
    return <div className="card text-gray-400">No published tips in this category yet.</div>;
  }

  // Empty on the dashboard, and on any feed too short to interrupt.
  const positions = withAds ? feedAdPositions(rows.length) : [];

  if (category === "TODAY") {
    return (
      <PredictionsTable
        rows={rows}
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
          <PredictionCard key={p.id} p={p} />
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {group.map((p) => (
              <PredictionCard key={p.id} p={p} />
            ))}
          </div>
          {i < groups.length - 1 && <AdInFeed index={i} />}
        </Fragment>
      ))}
    </div>
  );
}

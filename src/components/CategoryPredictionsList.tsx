import { PredictionCard, type PredictionRow } from "@/components/PredictionCard";
import { PredictionsTable, type PredictionTableRow } from "@/components/PredictionsTable";
import type { PredictionCategory } from "@/lib/enums";

// Rendering shared between /predictions/[category] and the account dashboard
// once each has already resolved which rows a viewer is allowed to see —
// TODAY renders as a table, every other category as a card grid.
export function CategoryPredictionsList({
  category,
  rows,
}: {
  category: PredictionCategory;
  rows: (PredictionRow & PredictionTableRow)[];
}) {
  if (rows.length === 0) {
    return <div className="card text-gray-400">No published tips in this category yet.</div>;
  }
  if (category === "TODAY") {
    return <PredictionsTable rows={rows} />;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {rows.map((p) => (
        <PredictionCard key={p.id} p={p} />
      ))}
    </div>
  );
}

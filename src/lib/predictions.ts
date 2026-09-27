import { prisma } from "@/lib/prisma";
import { PREDICTION_CATEGORIES, type PredictionCategory } from "@/lib/enums";
import { withGoalsCategory, type GoalsMarket } from "@/lib/goalsCategory";
import { recordPredictionEvents } from "@/lib/notifications";

export const CATEGORY_VALUES = PREDICTION_CATEGORIES;

export function applyCategoryChanges(
  current: readonly string[],
  add: readonly PredictionCategory[],
  remove: readonly PredictionCategory[],
): PredictionCategory[] {
  const valid = new Set<string>(CATEGORY_VALUES);
  const next = new Set(current.filter((c): c is PredictionCategory => valid.has(c)));
  for (const category of remove) next.delete(category);
  for (const category of add) next.add(category);
  if (next.size === 0) throw new Error("At least one category is required");
  return [...next];
}

/**
 * Replaces a prediction's category assignments with `categories`, and keeps
 * the legacy `category` column in sync as the first entry (primary category)
 * for display/back-compat. `categories` must be non-empty.
 *
 * GOALS is recomputed here from the row's market, whatever `categories` says
 * (see src/lib/goalsCategory.ts). Every writer of category tags goes through
 * this function, so this is the one place that keeps the tag deterministic.
 * Pass `market` when the caller holds the row's market already, or is about to
 * change it and has not written it yet; otherwise the stored market is read.
 */
export async function setPredictionCategories(predictionId: string, categories: string[], market?: GoalsMarket) {
  const resolvedMarket =
    market ??
    (await prisma.prediction.findUnique({ where: { id: predictionId }, select: { marketType: true, selection: true } })) ??
    { marketType: null, selection: null };
  const unique = withGoalsCategory(categories, resolvedMarket);
  if (unique.length === 0) throw new Error("At least one category is required");

  await prisma.$transaction([
    prisma.predictionCategoryLink.deleteMany({ where: { predictionId } }),
    prisma.predictionCategoryLink.createMany({
      data: unique.map((category) => ({ predictionId, category })),
    }),
    prisma.prediction.update({ where: { id: predictionId }, data: { category: unique[0] } }),
  ]);
}

/** Review actions that only move a prediction's status. SETTLE and EDIT carry extra payload and stay on the single-row route. */
export type ReviewAction = "APPROVE" | "PUBLISH" | "ARCHIVE";

/**
 * The fields a review action writes.
 *
 * Extracted so the single-row PATCH and the bulk endpoint apply byte-identical
 * transitions. Publishing without a prior approval records the publisher as the
 * approver, which is what keeps the audit trail complete when a reviewer goes
 * straight from PENDING_REVIEW to PUBLISHED — the common path.
 */
export function reviewTransition(
  action: ReviewAction,
  adminId: string,
  current: { approvedById: string | null },
): Record<string, unknown> {
  if (action === "APPROVE") {
    return { status: "APPROVED", approvedById: adminId, approvedAt: new Date() };
  }
  if (action === "PUBLISH") {
    return {
      status: "PUBLISHED",
      publishedAt: new Date(),
      ...(current.approvedById ? {} : { approvedById: adminId, approvedAt: new Date() }),
    };
  }
  return { status: "ARCHIVED" };
}

/**
 * Apply a status-only review action to one row, with its notification events,
 * in one transaction.
 *
 * The one shared path for a review transition that carries no field edits: the
 * bulk endpoint uses it for every row, and the Goals pass uses it to publish a
 * pick that cleared its gate (src/lib/goalsPipeline.ts) — so an automatic
 * publish writes the same approval/publish audit fields and fires the same
 * NEW_PREDICTION event as a human one, attributed to `actorId`. The single-row
 * PATCH keeps its own transaction only because it merges field edits into the
 * same update.
 */
export async function applyReviewAction(
  row: Parameters<typeof recordPredictionEvents>[1] & { approvedById: string | null },
  action: ReviewAction,
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.prediction.update({
      where: { id: row.id },
      data: reviewTransition(action, actorId, row),
      include: { categories: true },
    });
    await recordPredictionEvents(tx, row, updated, action);
    return updated;
  });
}

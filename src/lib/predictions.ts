import { prisma } from "@/lib/prisma";
import { PREDICTION_CATEGORIES, type PredictionCategory } from "@/lib/enums";

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
 */
export async function setPredictionCategories(predictionId: string, categories: string[]) {
  const unique = Array.from(new Set(categories));
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

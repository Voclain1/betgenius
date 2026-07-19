import { prisma } from "@/lib/prisma";

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

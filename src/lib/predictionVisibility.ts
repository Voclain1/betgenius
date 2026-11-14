import type { Prisma } from "@prisma/client";
import { PREDICTION_CATEGORIES } from "./enums";
import type { Entitlement } from "./entitlement";
import { canViewCategory } from "./access";
import { PAID_ONLY_PROVENANCES } from "./paidOnly";

export function discoveryAccessWhere(
  viewer: Entitlement,
): Prisma.PredictionWhereInput {
  const allowed = PREDICTION_CATEGORIES.filter((c) =>
    canViewCategory(c, viewer.tier, viewer.status, viewer.role),
  );
  const paid = allowed.filter((c) => c === "VIP" || c === "PREMIUM");
  return {
    OR: [
      {
        provenance: { notIn: [...PAID_ONLY_PROVENANCES] },
        OR: [
          { category: { in: allowed } },
          {
            category: { in: ["VIP", "PREMIUM"] },
            categories: {
              some: {
                category: {
                  in: allowed.filter((c) => c !== "VIP" && c !== "PREMIUM"),
                },
              },
            },
          },
        ],
      },
      {
        provenance: { in: [...PAID_ONLY_PROVENANCES] },
        categories: { some: { category: { in: paid } } },
      },
    ],
  };
}

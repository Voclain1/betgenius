/** Shared server-side public hold policy for published prediction browsing.
 * FREE rows under an active material-change hold are hidden from all
 * recommendation lists. VIP/Premium remain in their existing paid flows.
 */
import type { Prisma } from "@prisma/client";
import { PAID_ONLY_PROVENANCES } from "@/lib/paidOnly";

export const FREE_REASSESSMENT_VISIBLE: Prisma.PredictionWhereInput = {
  NOT: { reassessment: { is: { publicHold: true } } },
};

// Browsing league/team/match lists mixes paid and free predictions. Preserve
// all tagged VIP/Premium picks for existing entitlement and review controls.
export const MIXED_REASSESSMENT_VISIBLE: Prisma.PredictionWhereInput = {
  NOT: {
    AND: [
      { reassessment: { is: { publicHold: true } } },
      { provenance: { notIn: [...PAID_ONLY_PROVENANCES] } },
      { categories: { none: { category: { in: ["VIP", "PREMIUM"] } } } },
    ],
  },
};

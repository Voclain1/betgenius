/** Reassessment changes are admin-only metadata. A published prediction must
 * remain in all its original feeds until an administrator explicitly withdraws
 * it. These shared predicates are intentionally neutral for older hold rows.
 */
import type { Prisma } from "@prisma/client";

export const FREE_REASSESSMENT_VISIBLE: Prisma.PredictionWhereInput = {};
export const MIXED_REASSESSMENT_VISIBLE: Prisma.PredictionWhereInput = {};

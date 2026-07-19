// String-literal types that mirror the "enum" values used in the DB.
// SQLite doesn't support Prisma enums, so we store these as strings and
// keep the type safety on the TypeScript side only.

export type Role = "USER" | "ADMIN_PENDING" | "ADMIN" | "SUPER_ADMIN";
export type SubscriptionTier = "FREE" | "VIP" | "PREMIUM";
export type SubscriptionStatus = "PENDING" | "ACTIVE" | "CANCELED" | "EXPIRED";
export type PredictionCategory =
  | "FEATURED"
  | "GENIUS"
  | "TODAY"
  | "BANKER"
  | "VIP"
  | "PREMIUM";
export type PredictionStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "ARCHIVED";
export type Outcome = "PENDING" | "WON" | "LOST" | "VOID";
export type TaskStatus = "OPEN" | "IN_PROGRESS" | "DONE";

export const PREDICTION_CATEGORIES = [
  "FEATURED",
  "GENIUS",
  "TODAY",
  "BANKER",
  "VIP",
  "PREMIUM",
] as const satisfies readonly PredictionCategory[];

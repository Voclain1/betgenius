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
  | "PREMIUM"
  | "BET_OF_THE_DAY"
  | "SAME_GAME_DOUBLE";
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
  // Single-slot: at most one prediction carries this tag at a time, enforced
  // transactionally in src/lib/betOfTheDay.ts rather than by the schema —
  // PredictionCategoryLink's unique key is (prediction, category), which can
  // stop a duplicate tag on ONE row but cannot express "one row site-wide".
  "BET_OF_THE_DAY",
  // Two picks on ONE fixture, published as a single compound pick. Named a
  // "double" rather than a "combo" because /combos is already the multi-FIXTURE
  // accumulator builder, and the two would be impossible to tell apart in the
  // admin nav. Deliberately free rather than VIP/PREMIUM: both legs must land,
  // so a double is higher-variance than either leg alone, which is the opposite
  // of what those tiers promise.
  "SAME_GAME_DOUBLE",
] as const satisfies readonly PredictionCategory[];

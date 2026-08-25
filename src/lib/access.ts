import type { PredictionCategory, Role, SubscriptionStatus, SubscriptionTier } from "@/lib/enums";

export function isAdmin(role?: Role | null) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function isSuperAdmin(role?: Role | null) {
  return role === "SUPER_ADMIN";
}

export function hasActiveTier(tier?: SubscriptionTier | null, status?: SubscriptionStatus | null) {
  return status === "ACTIVE" && (tier === "VIP" || tier === "PREMIUM");
}

/** True if the user can view the full prediction for `category`. */
export function canViewCategory(
  category: PredictionCategory,
  tier?: SubscriptionTier | null,
  status?: SubscriptionStatus | null,
  role?: Role | null,
): boolean {
  if (isAdmin(role)) return true;
  switch (category) {
    case "FEATURED":
    case "GENIUS":
    case "TODAY":
    // Public. Bet of the Day is the homepage's shop window — the one pick a
    // visitor is shown to judge the product by — so padlocking it would defeat
    // the reason the slot exists.
    case "BET_OF_THE_DAY":
      return true;
    case "BANKER":
      // Free to view once registered — no active subscription required, just a login.
      return role != null;
    case "VIP":
      return status === "ACTIVE" && (tier === "VIP" || tier === "PREMIUM");
    case "PREMIUM":
      return status === "ACTIVE" && tier === "PREMIUM";
    default:
      return false;
  }
}

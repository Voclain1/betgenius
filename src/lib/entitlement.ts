import { canViewCategory } from "@/lib/access";
import type { PredictionCategory, Role, SubscriptionStatus, SubscriptionTier } from "@/lib/enums";

/**
 * The one place paid access is resolved.
 *
 * WHY THIS EXISTS. Every gate in the app used to read `session.user.tier` and
 * `session.user.subStatus`. Those are JWT claims, and the `jwt` callback only
 * computes them when `user` is passed — i.e. at sign-in and nowhere else. So a
 * customer who paid got the webhook, got an ACTIVE row in the database, and
 * still saw padlocks: their token kept saying FREE/PENDING until they signed
 * out and back in, or until the 30-day token aged out. The money moved and the
 * product did not unlock.
 *
 * The fix is not to refresh the token harder. It is to stop authorizing from a
 * snapshot at all. Entitlement is read from the Subscription row, per request,
 * and `canViewCategory` remains the single rule — this module only decides what
 * tier/status to feed it, so there is one rule and one resolver rather than a
 * second set of divergent checks.
 *
 * The token still carries tier/subStatus for DISPLAY (the account banner), and
 * `auth.ts` refreshes those on an explicit session update. Nothing authorizes
 * from them.
 */

export type SubscriptionRecord = {
  tier: string;
  status: string;
  currentPeriodEnd: Date | null;
} | null;

export type Entitlement = {
  tier: SubscriptionTier | undefined;
  status: SubscriptionStatus | undefined;
  role: Role | undefined;
};

export const ANONYMOUS: Entitlement = { tier: undefined, status: undefined, role: undefined };

export function isPaidTier(tier: string | null | undefined): tier is "VIP" | "PREMIUM" {
  return tier === "VIP" || tier === "PREMIUM";
}

/**
 * Apply the paid period to the stored status.
 *
 * A row can sit at ACTIVE forever: the only things that move it off ACTIVE are
 * Paystack's `subscription.disable` / `invoice.payment_failed` webhooks, and a
 * webhook that never arrives leaves paid access standing indefinitely.
 * `currentPeriodEnd` was written on every payment and then read by nothing.
 * It is the authority here.
 *
 * A NULL `currentPeriodEnd` means "no expiry", NOT "expired". It has to: the
 * admin APPROVE path (api/admin/subscribers/[id]) grants ACTIVE without ever
 * setting a period, and so does the FREE row every registration creates.
 * Treating null as expired would revoke every comped subscription.
 */
export function resolveSubscription(
  sub: SubscriptionRecord,
  now: Date = new Date(),
): { tier: SubscriptionTier | undefined; status: SubscriptionStatus | undefined } {
  if (!sub) return { tier: undefined, status: undefined };
  const tier = sub.tier as SubscriptionTier;
  const expired =
    sub.status === "ACTIVE" && sub.currentPeriodEnd != null && sub.currentPeriodEnd.getTime() <= now.getTime();
  return { tier, status: (expired ? "EXPIRED" : sub.status) as SubscriptionStatus };
}

/** True while the row is a paid tier, ACTIVE, and inside its period. */
export function hasActivePaidAccess(sub: SubscriptionRecord, now: Date = new Date()): boolean {
  const { tier, status } = resolveSubscription(sub, now);
  return status === "ACTIVE" && isPaidTier(tier);
}

export function entitlementFor(
  sub: SubscriptionRecord,
  role: Role | undefined,
  now: Date = new Date(),
): Entitlement {
  const { tier, status } = resolveSubscription(sub, now);
  return { tier, status, role };
}

/** The gate. Same rule everywhere — `canViewCategory`, fed from the database. */
export function canViewWith(entitlement: Entitlement, category: PredictionCategory): boolean {
  return canViewCategory(category, entitlement.tier, entitlement.status, entitlement.role);
}

import type { prisma } from "@/lib/prisma";
import type { PaidTier } from "@/lib/pricing";

/**
 * Record that a checkout has started. The subscription half of the initialize
 * route, unchanged in what it writes:
 *
 *   - a row WITH live paid access keeps its tier, status and period; only the
 *     reference of the checkout in flight is recorded;
 *   - any other row becomes { tier: <being bought>, status: PENDING } with the
 *     reference;
 *   - no row yet is created that way.
 *
 * WHAT CHANGED IS WHEN THE DECISION IS MADE. The route used to read the row,
 * decide "has access?" in JavaScript, then write. A payment granted between
 * that read and that write — the webhook for an earlier checkout, landing as
 * the customer clicks subscribe again — was then overwritten with PENDING by a
 * decision taken before it existed: charged, and locked out.
 *
 * Now the access test is part of each UPDATE's WHERE clause, so Postgres
 * evaluates it against the row as it is at write time, under the row lock
 * (READ COMMITTED re-checks the WHERE against the latest committed version
 * after waiting on a concurrent writer). The downgrade can only ever apply to
 * a row that has no live access at that instant. No transaction, no lock
 * held across statements, no schema change.
 *
 * The WHERE mirrors hasActivePaidAccess in lib/entitlement exactly: a paid
 * tier, ACTIVE, and a period end that is null (comped — no expiry) or still in
 * the future.
 */
const PAID_TIERS = ["VIP", "PREMIUM"];

export function liveAccessWhere(now: Date) {
  return {
    status: "ACTIVE",
    tier: { in: PAID_TIERS },
    OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
  };
}

export type CheckoutStartResult = "PENDING" | "KEPT_ACCESS" | "CREATED";

export async function recordCheckoutStart(
  db: typeof prisma,
  userId: string,
  tier: PaidTier,
  reference: string,
  now: Date = new Date(),
): Promise<CheckoutStartResult> {
  // Each pass is three single-statement attempts; one of them matches unless
  // the row changes between them (a grant landing, a concurrent create), in
  // which case the next pass sees the new state. Two passes cover any single
  // concurrent change; the third is margin.
  for (let pass = 0; pass < 3; pass++) {
    const reset = await db.subscription.updateMany({
      where: { userId, NOT: liveAccessWhere(now) },
      data: { tier, status: "PENDING", paystackRef: reference },
    });
    if (reset.count > 0) return "PENDING";

    const kept = await db.subscription.updateMany({
      where: { userId, ...liveAccessWhere(now) },
      data: { paystackRef: reference },
    });
    if (kept.count > 0) return "KEPT_ACCESS";

    try {
      await db.subscription.create({ data: { userId, tier, status: "PENDING", paystackRef: reference } });
      return "CREATED";
    } catch (error) {
      // Created concurrently (a double click): go round and update it instead.
      if ((error as { code?: string } | null)?.code !== "P2002") throw error;
    }
  }
  throw new Error("Could not record the checkout start: the subscription kept changing");
}

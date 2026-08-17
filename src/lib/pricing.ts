import type { SubscriptionTier } from "@/lib/enums";

/**
 * Subscription pricing — the single source of truth for what a plan costs.
 *
 * NGN is the currency we actually charge in. USD is a reference figure shown
 * beside it so a non-Nigerian visitor can size the price up; it is NOT a
 * second checkout currency and is never converted, sent to Paystack, or used
 * in any calculation. Paystack bills the naira amount regardless of which
 * number the visitor read. (Real multi-currency checkout is the deferred
 * crypto initiative, not this.)
 *
 * The USD figures are fixed reference prices set alongside the naira ones,
 * not a live FX conversion — they don't move with the exchange rate, and
 * they're set here deliberately rather than derived.
 */
export type PaidTier = Extract<SubscriptionTier, "VIP" | "PREMIUM">;

export const PLAN_PRICING: Record<PaidTier, { ngn: number; usd: number }> = {
  VIP: { ngn: 20_000, usd: 15 },
  PREMIUM: { ngn: 50_000, usd: 35 },
};

/**
 * What Paystack is told to charge, in kobo.
 *
 * Derived here and used server-side only. The checkout amount used to be
 * posted from the browser alongside the tier, which meant the price was
 * whatever the client said it was — a visitor could buy Premium for one
 * naira by editing the request. The amount now comes from the tier and the
 * table above, and the request body's own amount (if any) is ignored.
 */
export function koboFor(tier: PaidTier): number {
  return PLAN_PRICING[tier].ngn * 100;
}

/** "₦20,000" — the primary, charged figure. */
export function formatNgn(ngn: number): string {
  return `₦${ngn.toLocaleString("en-NG")}`;
}

/** "$15" — the secondary reference figure. */
export function formatUsd(usd: number): string {
  return `$${usd.toLocaleString("en-US")}`;
}

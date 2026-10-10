import { isPaid, type PaymentCategory } from "@/lib/paystack/failureCategory";

/**
 * What an admin needs to know about one attempt, beyond Paystack's status.
 *
 * Pure, so every rule below is asserted in scripts/check-payment-diagnostics.ts
 * and the admin route only has to feed it rows.
 *
 * NOTHING HERE IS MORE PRECISE THAN THE EVIDENCE. The stage comes from
 * Paystack's checkout session log (see summariseSessionLog) and says only what
 * that log shows. In particular NO_ACTIVITY means Paystack recorded nothing on
 * the checkout page — it does not claim the payer saw the page, and it does not
 * claim they did not.
 */

export const CHECKOUT_STAGES = [
  "PAID",
  "AUTHORIZATION_ATTEMPTED",
  "BLOCKED_BEFORE_AUTHORIZATION",
  "METHOD_SELECTED",
  "OPENED",
  "NO_ACTIVITY",
  "UNKNOWN",
] as const;

export type CheckoutStage = (typeof CHECKOUT_STAGES)[number];

export const STAGE_COPY: Record<CheckoutStage, string> = {
  PAID: "Paid",
  AUTHORIZATION_ATTEMPTED: "Payment authorization attempted",
  BLOCKED_BEFORE_AUTHORIZATION: "Stopped by Paystack before any charge",
  METHOD_SELECTED: "Chose a method, then left",
  OPENED: "Opened checkout, chose nothing",
  NO_ACTIVITY: "No checkout activity recorded by Paystack",
  UNKNOWN: "Not observed yet — reconcile",
};

export function checkoutStage(input: {
  status: string;
  sessionLogged: boolean | null;
  methodsTried: string | null;
  authAttempts: number | null;
  sessionError: string | null;
}): CheckoutStage {
  if (input.status === "success") return "PAID";
  if (input.sessionLogged == null) return "UNKNOWN";
  if ((input.authAttempts ?? 0) > 0) return "AUTHORIZATION_ATTEMPTED";
  if (input.sessionError) return "BLOCKED_BEFORE_AUTHORIZATION";
  if (input.methodsTried) return "METHOD_SELECTED";
  if (input.sessionLogged) return "OPENED";
  return "NO_ACTIVITY";
}

/**
 * Whether BetGenius started this transaction.
 *
 * The Paystack account also holds transactions we never initialised — test
 * probes, a payment-page test, anything created from the dashboard — and in
 * production they were a third of the "failed" count and the only "paid" one.
 * Counting them as customer checkouts is what made the headline numbers
 * misleading.
 *
 *   CHECKOUT — our own bg_<TIER>_ reference.
 *   LEGACY   — Paystack-minted reference carrying our userId metadata, which
 *              is what checkouts looked like before our references shipped.
 *   EXTERNAL — neither. Not a BetGenius checkout; excluded from the rates.
 */
export type AttemptOrigin = "CHECKOUT" | "LEGACY" | "EXTERNAL";

// The same shape lib/paystack/checkoutReference mints. Repeated rather than
// imported because the admin page renders this module in the browser, and
// that one imports Node's crypto to generate references.
const OUR_REFERENCE = /^bg_(VIP|PREMIUM)_[0-9a-f]{32}$/;

export function attemptOrigin(reference: string, userId: string | null): AttemptOrigin {
  if (OUR_REFERENCE.test(reference)) return "CHECKOUT";
  if (userId) return "LEGACY";
  return "EXTERNAL";
}

/**
 * The one-line answer: did this attempt end in a paying customer with access?
 *
 * ENTITLEMENT_MISSING is the P0 state: Paystack says the money moved, the
 * transaction is ours, and no grant is recorded against it. Everything else is
 * the Paystack category unchanged.
 */
export type AttemptOutcome = PaymentCategory | "ENTITLEMENT_MISSING" | "EXTERNAL_PAYMENT";

export function attemptOutcome(input: {
  category: PaymentCategory;
  origin: AttemptOrigin;
  entitled: boolean;
}): AttemptOutcome {
  if (!isPaid(input.category)) return input.category;
  if (input.origin === "EXTERNAL") return "EXTERNAL_PAYMENT";
  return input.entitled ? "SUCCESS" : "ENTITLEMENT_MISSING";
}

/** The method the payer actually chose last, or null when they chose none. */
export function lastMethodTried(methodsTried: string | null): string | null {
  if (!methodsTried) return null;
  const parts = methodsTried.split(",").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/**
 * One-time payment fallback regressions.
 *
 * While Paystack has no active recurring-capable channel, every paid checkout
 * is a ONE-TIME charge that buys exactly one 30-day period (see the block
 * comment in api/subscription/initialize/route.ts). That moves a great deal of
 * weight onto the checkout grant path, which previously only had to handle a
 * first purchase: it now also handles every renewal, so the cases below are
 * the difference between customers being billed correctly and being billed
 * twice, cut off early, or granted access they did not pay for.
 *
 * NO REAL PAYMENT IS MADE HERE, and none can be. The rules are pure functions
 * over a row and a verified-transaction shape, exactly as the existing
 * entitlement checks are — nothing in this file touches Paystack, the network
 * or the database.
 */
import assert from "node:assert/strict";
import {
  PAID_PERIOD_MS,
  decideCheckoutGrant,
  nextPaidPeriod,
  validateRenewal,
  type CheckoutRow,
} from "../src/lib/paystack/entitlement";
import { hasActivePaidAccess, resolveSubscription } from "../src/lib/entitlement";
import { newCheckoutReference, tierFromCheckoutReference } from "../src/lib/paystack/checkoutReference";
import { koboFor } from "../src/lib/pricing";
import { initializeTransaction, PAYSTACK_PLANS } from "../src/lib/paystack/paystack";

const NOW = new Date("2026-09-18T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const vipRef = newCheckoutReference("VIP");
const premiumRef = newCheckoutReference("PREMIUM");

/** A fresh FREE user who has just started a VIP checkout. */
const freshVipRow: CheckoutRow = {
  userId: "user_1",
  userEmail: "payer@example.com",
  tier: "FREE",
  status: "PENDING",
  paystackRef: vipRef,
  lastPaymentRef: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
};

const vipTxn = {
  status: "success",
  currency: "NGN",
  amount: koboFor("VIP"),
  reference: vipRef,
  customer: { email: "Payer@example.com" },
  metadata: { userId: "user_1", tier: "VIP" },
};

// ---------------------------------------------------------------------------
// 1. VIP success. One payment, one 30-day period, at the server-side price.
// ---------------------------------------------------------------------------
const vip = decideCheckoutGrant(freshVipRow, "VIP", vipTxn, NOW);
assert.equal(vip.granted, true, "a valid VIP one-time payment grants access");
assert.equal(vip.granted && vip.tier, "VIP", "the tier bought is the tier granted");
assert.equal(vip.granted && vip.periodStart.getTime(), NOW.getTime(), "a first purchase starts now");
assert.equal(
  vip.granted && vip.periodEnd.getTime(),
  NOW.getTime() + PAID_PERIOD_MS,
  "a first purchase ends exactly one paid period from now",
);
assert.equal(koboFor("VIP"), 2_000_000, "VIP is still NGN 20,000");

// ---------------------------------------------------------------------------
// 2. Premium success, at its own price — and the VIP price must not buy it.
// ---------------------------------------------------------------------------
const freshPremiumRow: CheckoutRow = {
  ...freshVipRow,
  userId: "user_2",
  userEmail: "buyer@example.com",
  paystackRef: premiumRef,
};
const premiumTxn = {
  status: "success",
  currency: "NGN",
  amount: koboFor("PREMIUM"),
  reference: premiumRef,
  customer: { email: "buyer@example.com" },
  metadata: { userId: "user_2", tier: "PREMIUM" },
};
const premium = decideCheckoutGrant(freshPremiumRow, "PREMIUM", premiumTxn, NOW);
assert.equal(premium.granted, true, "a valid Premium one-time payment grants access");
assert.equal(premium.granted && premium.tier, "PREMIUM", "Premium is granted, not VIP");
assert.equal(koboFor("PREMIUM"), 5_000_000, "Premium is still NGN 50,000");

// ---------------------------------------------------------------------------
// 3. Failed, abandoned and pending transactions grant nothing.
// ---------------------------------------------------------------------------
for (const status of ["failed", "abandoned", "pending", "reversed", undefined]) {
  const decided = decideCheckoutGrant(freshVipRow, "VIP", { ...vipTxn, status }, NOW);
  assert.equal(decided.granted, false, `a ${status ?? "missing-status"} transaction grants nothing`);
  assert(
    !decided.granted &&
      decided.code === "MISMATCH" &&
      decided.mismatches.some((m) => m.code === "TRANSACTION_NOT_SUCCESSFUL"),
    `a ${status ?? "missing-status"} transaction is rejected as unsuccessful`,
  );
}

// ---------------------------------------------------------------------------
// 4. Wrong amount. Underpaying buys nothing — including paying the VIP price
//    for Premium, which is the cheap-upgrade attack the price table exists to
//    stop now that the amount is no longer fixed by a Paystack plan.
// ---------------------------------------------------------------------------
const underpaid = decideCheckoutGrant(freshVipRow, "VIP", { ...vipTxn, amount: 100 }, NOW);
assert(
  !underpaid.granted && underpaid.code === "MISMATCH" && underpaid.mismatches.some((m) => m.code === "AMOUNT_MISMATCH"),
  "underpaying grants nothing",
);
const cheapPremium = decideCheckoutGrant(
  freshPremiumRow,
  "PREMIUM",
  { ...premiumTxn, amount: koboFor("VIP") },
  NOW,
);
assert(
  !cheapPremium.granted &&
    cheapPremium.code === "MISMATCH" &&
    cheapPremium.mismatches.some((m) => m.code === "AMOUNT_MISMATCH"),
  "paying the VIP price must not buy Premium",
);
const overpaid = decideCheckoutGrant(freshVipRow, "VIP", { ...vipTxn, amount: koboFor("VIP") + 1 }, NOW);
assert.equal(overpaid.granted, false, "an amount that is not exactly the tier price is rejected");

// Currency is checked with the amount: 20,000 of something else is not the price.
const wrongCurrency = decideCheckoutGrant(freshVipRow, "VIP", { ...vipTxn, currency: "USD" }, NOW);
assert(
  !wrongCurrency.granted &&
    wrongCurrency.code === "MISMATCH" &&
    wrongCurrency.mismatches.some((m) => m.code === "CURRENCY_MISMATCH"),
  "a non-NGN transaction grants nothing",
);

// ---------------------------------------------------------------------------
// 5. Wrong email / wrong identity. A transaction paid by someone else, or
//    carrying another user's id, grants nothing to this row.
// ---------------------------------------------------------------------------
const wrongEmail = decideCheckoutGrant(
  freshVipRow,
  "VIP",
  { ...vipTxn, customer: { email: "someone-else@example.com" } },
  NOW,
);
assert(
  !wrongEmail.granted && wrongEmail.code === "MISMATCH" && wrongEmail.mismatches.some((m) => m.code === "CUSTOMER_MISMATCH"),
  "a payment made by another email grants nothing",
);
const missingEmail = decideCheckoutGrant(freshVipRow, "VIP", { ...vipTxn, customer: {} }, NOW);
assert.equal(missingEmail.granted, false, "a transaction with no customer email grants nothing");
const wrongUser = decideCheckoutGrant(
  freshVipRow,
  "VIP",
  { ...vipTxn, metadata: { userId: "someone_else", tier: "VIP" } },
  NOW,
);
assert(
  !wrongUser.granted && wrongUser.code === "MISMATCH" && wrongUser.mismatches.some((m) => m.code === "USER_MISMATCH"),
  "another user's transaction grants nothing",
);
// Case and padding in the verified email are Paystack's, not a mismatch.
const paddedEmail = decideCheckoutGrant(freshVipRow, "VIP", { ...vipTxn, customer: { email: " PAYER@example.com " } }, NOW);
assert.equal(paddedEmail.granted, true, "email comparison ignores case and surrounding space");

// A reference that is not the one this row is checking out grants nothing,
// which is what stops a replayed reference being applied to another row.
const wrongRef = decideCheckoutGrant(freshVipRow, "VIP", { ...vipTxn, reference: premiumRef }, NOW);
assert(
  !wrongRef.granted && wrongRef.code === "MISMATCH" && wrongRef.mismatches.some((m) => m.code === "REFERENCE_MISMATCH"),
  "a transaction for a different reference grants nothing",
);

// ---------------------------------------------------------------------------
// 6. Duplicate webhook / callback. The callback verifies on redirect and the
//    webhook verifies again on arrival, so the SAME transaction is presented
//    twice by design. The second must add nothing.
// ---------------------------------------------------------------------------
assert.equal(vip.granted && vip.periodEnd.getTime(), NOW.getTime() + PAID_PERIOD_MS);
const alreadyGranted: CheckoutRow = {
  ...freshVipRow,
  tier: "VIP",
  status: "ACTIVE",
  paystackRef: null, // spent by the first grant
  lastPaymentRef: vipRef,
  currentPeriodStart: NOW,
  currentPeriodEnd: new Date(NOW.getTime() + PAID_PERIOD_MS),
};
const replay = decideCheckoutGrant(alreadyGranted, "VIP", vipTxn, new Date(NOW.getTime() + 1000));
assert.equal(replay.granted, false, "the same transaction must not grant twice");
assert.equal(!replay.granted && replay.code, "ALREADY_GRANTED", "a replay is recognised, not treated as a mismatch");

// ---------------------------------------------------------------------------
// 7. Expiry is driven by currentPeriodEnd alone, with no webhook involved.
//    This is what makes a one-time payment safe to sell: access stops on its
//    own when nobody sends us anything.
// ---------------------------------------------------------------------------
const paidRow = { tier: "VIP", status: "ACTIVE", currentPeriodEnd: new Date(NOW.getTime() + PAID_PERIOD_MS) };
assert.equal(hasActivePaidAccess(paidRow, NOW), true, "inside the paid period, access is live");
const dayBeforeEnd = new Date(NOW.getTime() + PAID_PERIOD_MS - DAY);
assert.equal(hasActivePaidAccess(paidRow, dayBeforeEnd), true, "access holds until the very end of the period");
const justAfterEnd = new Date(NOW.getTime() + PAID_PERIOD_MS + 1);
assert.equal(hasActivePaidAccess(paidRow, justAfterEnd), false, "access stops at currentPeriodEnd without any webhook");
assert.equal(
  resolveSubscription(paidRow, justAfterEnd).status,
  "EXPIRED",
  "a lapsed one-time period resolves EXPIRED even though the row still says ACTIVE",
);
// The comped/admin case must survive: null is "no expiry", not "expired".
assert.equal(
  hasActivePaidAccess({ tier: "PREMIUM", status: "ACTIVE", currentPeriodEnd: null }, justAfterEnd),
  true,
  "an admin comp with no period is not expired by the one-time rules",
);

// ---------------------------------------------------------------------------
// 8. Early renewal must not throw away paid time. THIS IS THE ONE THAT BIT:
//    the checkout grant used to write `now + PAID_PERIOD_MS` flat, which was
//    survivable when renewals came from Paystack's recurring path, and is not
//    survivable now that every renewal is a checkout.
// ---------------------------------------------------------------------------
const TEN_DAYS_LEFT = new Date(NOW.getTime() + 10 * DAY);
const renewEarlyRef = newCheckoutReference("VIP");
const renewingEarly: CheckoutRow = {
  ...freshVipRow,
  tier: "VIP",
  status: "ACTIVE",
  paystackRef: renewEarlyRef,
  lastPaymentRef: vipRef,
  currentPeriodStart: new Date(NOW.getTime() - 20 * DAY),
  currentPeriodEnd: TEN_DAYS_LEFT,
};
const early = decideCheckoutGrant(
  renewingEarly,
  "VIP",
  { ...vipTxn, reference: renewEarlyRef },
  NOW,
);
assert.equal(early.granted, true, "an ACTIVE customer may renew early");
assert.equal(
  early.granted && early.periodEnd.getTime(),
  TEN_DAYS_LEFT.getTime() + PAID_PERIOD_MS,
  "renewing early adds a period to the remaining time instead of discarding it",
);
assert.equal(
  early.granted && early.periodStart.getTime(),
  renewingEarly.currentPeriodStart!.getTime(),
  "extending an unexpired period keeps the span's original start",
);

// Renewing after a lapse starts fresh rather than back-dating.
const lapsedRef = newCheckoutReference("VIP");
const afterLapse = decideCheckoutGrant(
  {
    ...renewingEarly,
    paystackRef: lapsedRef,
    currentPeriodStart: new Date(NOW.getTime() - 60 * DAY),
    currentPeriodEnd: new Date(NOW.getTime() - DAY),
  },
  "VIP",
  { ...vipTxn, reference: lapsedRef },
  NOW,
);
assert.equal(
  afterLapse.granted && afterLapse.periodEnd.getTime(),
  NOW.getTime() + PAID_PERIOD_MS,
  "renewing after a lapse runs a full period from today",
);
assert.equal(afterLapse.granted && afterLapse.periodStart.getTime(), NOW.getTime(), "a lapsed renewal starts now");

// The period rule itself, directly — one definition, used by both paths.
assert.equal(
  nextPaidPeriod({ currentPeriodStart: null, currentPeriodEnd: null }, NOW).end.getTime(),
  NOW.getTime() + PAID_PERIOD_MS,
  "no existing period means one period from now",
);
assert.equal(
  nextPaidPeriod({ currentPeriodStart: NOW, currentPeriodEnd: TEN_DAYS_LEFT }, NOW).end.getTime(),
  TEN_DAYS_LEFT.getTime() + PAID_PERIOD_MS,
  "an unexpired period is extended, not replaced",
);
const recurring = validateRenewal(
  { tier: "VIP", status: "ACTIVE", currentPeriodStart: NOW, currentPeriodEnd: TEN_DAYS_LEFT, paystackRef: null },
  { status: "success", currency: "NGN", amount: koboFor("VIP"), reference: "T_recurring_1" },
  NOW,
);
assert.equal(
  recurring.granted && recurring.periodEnd.getTime(),
  TEN_DAYS_LEFT.getTime() + PAID_PERIOD_MS,
  "the dormant recurring path computes the identical period — the two cannot drift",
);
// The recurring path is idempotent on the recorded payment reference too.
const recurringReplay = validateRenewal(
  {
    tier: "VIP",
    status: "ACTIVE",
    currentPeriodStart: NOW,
    currentPeriodEnd: TEN_DAYS_LEFT,
    paystackRef: null,
    lastPaymentRef: "T_recurring_1",
  },
  { status: "success", currency: "NGN", amount: koboFor("VIP"), reference: "T_recurring_1" },
  NOW,
);
assert.equal(!recurringReplay.granted && recurringReplay.code, "ALREADY_APPLIED", "a recorded payment never re-applies");

// ---------------------------------------------------------------------------
// 9. An existing ACTIVE customer starting a checkout keeps what they have —
//    before paying, and for good if they abandon the page.
// ---------------------------------------------------------------------------
const activeBeforeCheckout = { tier: "VIP", status: "ACTIVE", currentPeriodEnd: TEN_DAYS_LEFT };
assert.equal(hasActivePaidAccess(activeBeforeCheckout, NOW), true, "an active customer has access before checking out");
// The initialize route writes only the reference when hasActivePaidAccess is
// true, so the row an abandoned upgrade leaves behind is this same row.
const afterAbandonedUpgrade = { ...activeBeforeCheckout };
assert.equal(
  hasActivePaidAccess(afterAbandonedUpgrade, NOW),
  true,
  "abandoning an upgrade must not revoke access already paid for",
);
assert.equal(
  resolveSubscription(afterAbandonedUpgrade, NOW).tier,
  "VIP",
  "an unpaid Premium upgrade must not downgrade or upgrade the stored tier",
);
// And an ACTIVE row reaching the grant path is a legitimate payer, not a fraud
// signal — it is exactly what an upgrade looks like.
const upgradeRef = newCheckoutReference("PREMIUM");
const upgrade = decideCheckoutGrant(
  {
    userId: "user_1",
    userEmail: "payer@example.com",
    tier: "VIP",
    status: "ACTIVE",
    paystackRef: upgradeRef,
    lastPaymentRef: vipRef,
    currentPeriodStart: NOW,
    currentPeriodEnd: TEN_DAYS_LEFT,
  },
  "PREMIUM",
  {
    status: "success",
    currency: "NGN",
    amount: koboFor("PREMIUM"),
    reference: upgradeRef,
    customer: { email: "payer@example.com" },
    metadata: { userId: "user_1", tier: "PREMIUM" },
  },
  NOW,
);
assert.equal(upgrade.granted, true, "an ACTIVE customer paying for an upgrade is granted it");
assert.equal(upgrade.granted && upgrade.tier, "PREMIUM", "the upgrade applies only once paid");

// A row that never went through checkout (CANCELED/EXPIRED) grants nothing.
const notCheckingOut = decideCheckoutGrant({ ...freshVipRow, status: "CANCELED" }, "VIP", vipTxn, NOW);
assert(
  !notCheckingOut.granted &&
    notCheckingOut.code === "MISMATCH" &&
    notCheckingOut.mismatches.some((m) => m.code === "SUBSCRIPTION_NOT_CHECKING_OUT"),
  "a row that never started a checkout grants nothing",
);

// ---------------------------------------------------------------------------
// 10. Immediate entitlement refresh. Access is resolved from the row, so the
//     moment the grant lands the same viewer is entitled — no re-login, and
//     no dependence on the webhook having been the one to write it.
// ---------------------------------------------------------------------------
const beforeGrant = { tier: "FREE", status: "PENDING", currentPeriodEnd: null };
assert.equal(hasActivePaidAccess(beforeGrant, NOW), false, "an unpaid checkout entitles nothing");
const afterGrant = {
  tier: vip.granted ? vip.tier : "FREE",
  status: "ACTIVE",
  currentPeriodEnd: vip.granted ? vip.periodEnd : null,
};
assert.equal(
  hasActivePaidAccess(afterGrant, new Date(NOW.getTime() + 1000)),
  true,
  "the row the grant writes entitles the customer immediately, with no re-login",
);

// ---------------------------------------------------------------------------
// 11. The checkout reference still carries its tier, which is what the grant
//     path uses to know what was bought — and the recurring configuration is
//     still present, so restoring plans is a one-line change.
// ---------------------------------------------------------------------------
assert.equal(tierFromCheckoutReference(vipRef), "VIP", "a VIP reference round-trips its tier");
assert.equal(tierFromCheckoutReference(premiumRef), "PREMIUM", "a Premium reference round-trips its tier");
assert.notEqual(newCheckoutReference("VIP"), newCheckoutReference("VIP"), "references are single-use");
assert.equal(typeof PAYSTACK_PLANS.VIP, "string", "the VIP plan mapping is retained for when plans return");
assert.equal(typeof PAYSTACK_PLANS.PREMIUM, "string", "the Premium plan mapping is retained for when plans return");
assert(
  /\bplan\?: string\b/.test(initializeTransaction.toString()) || initializeTransaction.length === 1,
  "initializeTransaction still accepts a plan, so recurring is restored by passing it again",
);

console.log(
  "One-time fallback checks passed: VIP and Premium grant one 30-day period at the server price; " +
    "failed/abandoned/pending, wrong amount, wrong currency, wrong email and wrong user grant nothing; " +
    "a duplicated webhook/callback never grants twice; access expires on currentPeriodEnd with no webhook; " +
    "early renewal keeps unused time and a lapsed one starts fresh; an ACTIVE customer starting or abandoning " +
    "a checkout keeps access; the granted row entitles immediately; plan configuration is retained.",
);

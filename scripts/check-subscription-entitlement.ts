/**
 * Entitlement regressions.
 *
 * Every case here is a bug that shipped, or one step away from one:
 * a customer paying and staying locked out, a subscriber losing access by
 * clicking subscribe twice, an ACTIVE row outliving the month it paid for.
 * The rules are pure functions precisely so they can be asserted without a
 * database — the routes do the IO, these decide.
 */
import assert from "node:assert/strict";
import { canViewCategory } from "../src/lib/access";
import {
  entitlementFor,
  hasActivePaidAccess,
  resolveSubscription,
  type SubscriptionRecord,
} from "../src/lib/entitlement";
import { PAID_PERIOD_MS, validateRenewal, validateVerifiedEntitlement } from "../src/lib/paystack/entitlement";
import { newCheckoutReference, tierFromCheckoutReference } from "../src/lib/paystack/checkoutReference";
import { koboFor } from "../src/lib/pricing";
import { RegistrationBody } from "../src/lib/registration";

const NOW = new Date("2026-09-18T12:00:00Z");
const IN_30_DAYS = new Date("2026-10-18T12:00:00Z");
const YESTERDAY = new Date("2026-09-17T12:00:00Z");

const canSeeVip = (sub: SubscriptionRecord, now = NOW) => {
  const e = entitlementFor(sub, "USER", now);
  return canViewCategory("VIP", e.tier, e.status, e.role);
};
const canSeePremium = (sub: SubscriptionRecord, now = NOW) => {
  const e = entitlementFor(sub, "USER", now);
  return canViewCategory("PREMIUM", e.tier, e.status, e.role);
};

// 1. FREE -> paid activation is visible without re-login.
//    The old bug lived in the JWT: the row went ACTIVE and the session kept
//    saying FREE. Authorization now reads the row, so the same user object
//    before and after the webhook differs only by the row itself.
const freeRow: SubscriptionRecord = { tier: "FREE", status: "ACTIVE", currentPeriodEnd: null };
assert.equal(canSeeVip(freeRow), false, "FREE must not see VIP");
const justPaid: SubscriptionRecord = { tier: "VIP", status: "ACTIVE", currentPeriodEnd: IN_30_DAYS };
assert.equal(canSeeVip(justPaid), true, "paid VIP must unlock with no re-login");

// 2. An ACTIVE subscriber beginning another checkout keeps access, and keeps
//    it after abandoning that checkout. The initialize route writes only the
//    reference when hasActivePaidAccess is true, so the row is unchanged.
assert.equal(hasActivePaidAccess(justPaid, NOW), true, "unexpired paid row has access");
const afterStartingUpgrade: SubscriptionRecord = { ...justPaid }; // tier/status untouched by design
assert.equal(canSeeVip(afterStartingUpgrade), true, "starting a checkout must not revoke access");
assert.equal(canSeePremium(afterStartingUpgrade), false, "an unpaid upgrade grants nothing yet");

// 3. A successful tier change takes effect once the webhook grants it.
const afterUpgradePaid: SubscriptionRecord = { tier: "PREMIUM", status: "ACTIVE", currentPeriodEnd: IN_30_DAYS };
assert.equal(canSeePremium(afterUpgradePaid), true, "paid upgrade unlocks PREMIUM");
assert.equal(canSeeVip(afterUpgradePaid), true, "PREMIUM includes VIP");

// 4. An ACTIVE row whose period has passed loses paid access.
const lapsed: SubscriptionRecord = { tier: "VIP", status: "ACTIVE", currentPeriodEnd: YESTERDAY };
assert.equal(resolveSubscription(lapsed, NOW).status, "EXPIRED", "past currentPeriodEnd resolves EXPIRED");
assert.equal(canSeeVip(lapsed), false, "an expired ACTIVE row must not retain paid access");
assert.equal(hasActivePaidAccess(lapsed, NOW), false, "expired row has no paid access");

// 5. A valid unexpired ACTIVE row keeps access — including the comped case,
//    where an admin grants ACTIVE and never sets a period. Null is "no
//    expiry", not "expired"; treating it otherwise would revoke every comp.
assert.equal(canSeeVip(justPaid), true, "unexpired paid row retains entitlement");
const comped: SubscriptionRecord = { tier: "PREMIUM", status: "ACTIVE", currentPeriodEnd: null };
assert.equal(canSeePremium(comped), true, "admin comp without a period keeps access");

// 6. Payment failure grants nothing. The verification the webhook runs before
//    touching the row still rejects a failed charge, a short payment, a
//    replayed reference for another user, and a mismatched tier.
const pending = {
  userId: "user_1",
  userEmail: "payer@example.com",
  tier: "PREMIUM",
  paystackRef: "bg_PREMIUM_" + "a".repeat(32),
  status: "ACTIVE", // preserved active row, mid-upgrade
};
const goodTxn = {
  status: "success",
  currency: "NGN",
  amount: koboFor("PREMIUM"),
  reference: pending.paystackRef,
  customer: { email: "Payer@example.com" },
  metadata: { userId: "user_1", tier: "PREMIUM" },
};
assert.deepEqual(validateVerifiedEntitlement(pending, goodTxn), [], "a real upgrade payment is accepted");
assert(
  validateVerifiedEntitlement(pending, { ...goodTxn, status: "failed" }).some(
    (m) => m.code === "TRANSACTION_NOT_SUCCESSFUL",
  ),
  "a failed charge grants nothing",
);
assert(
  validateVerifiedEntitlement(pending, { ...goodTxn, amount: koboFor("VIP") }).some((m) => m.code === "AMOUNT_MISMATCH"),
  "paying the VIP price must not buy PREMIUM",
);
assert(
  validateVerifiedEntitlement(pending, { ...goodTxn, metadata: { userId: "someone_else", tier: "PREMIUM" } }).some(
    (m) => m.code === "USER_MISMATCH",
  ),
  "another user's transaction grants nothing",
);
assert(
  validateVerifiedEntitlement({ ...pending, status: "CANCELED" }, goodTxn).some(
    (m) => m.code === "SUBSCRIPTION_NOT_CHECKING_OUT",
  ),
  "a row that never went through checkout grants nothing",
);

// 7. The reference carries the tier a checkout was for, which is what lets the
//    row keep its current tier until the payment actually lands.
const ref = newCheckoutReference("PREMIUM");
assert.equal(tierFromCheckoutReference(ref), "PREMIUM", "reference round-trips its tier");
assert.notEqual(newCheckoutReference("VIP"), newCheckoutReference("VIP"), "references are single-use");
assert.equal(tierFromCheckoutReference("T123456789"), null, "a legacy Paystack reference carries no tier");
assert.equal(tierFromCheckoutReference("bg_ADMIN_" + "a".repeat(32)), null, "only real tiers parse");
assert.equal(tierFromCheckoutReference(null), null, "a missing reference carries no tier");

// 9. Renewals. Paystack mints its own reference for each recurring invoice,
//    so a renewal never matches a checkout. Enforcing currentPeriodEnd without
//    this would cut off customers whose cards are still being charged.
const renewing = {
  tier: "VIP",
  status: "ACTIVE",
  currentPeriodEnd: IN_30_DAYS,
  paystackRef: null as string | null,
};
const renewalTxn = { status: "success", currency: "NGN", amount: koboFor("VIP"), reference: "T_renewal_1" };
const applied = validateRenewal(renewing, renewalTxn, NOW);
assert.equal(applied.granted, true, "a valid recurring charge renews");
assert.equal(
  applied.granted && applied.periodEnd.getTime(),
  IN_30_DAYS.getTime() + PAID_PERIOD_MS,
  "renewing early extends from the current period end, not from today",
);

const lapsedThenRenewed = validateRenewal(
  { tier: "VIP", status: "ACTIVE", currentPeriodEnd: YESTERDAY, paystackRef: null },
  renewalTxn,
  NOW,
);
assert.equal(
  lapsedThenRenewed.granted && lapsedThenRenewed.periodEnd.getTime(),
  NOW.getTime() + PAID_PERIOD_MS,
  "renewing after a lapse extends from today",
);

const replayed = validateRenewal({ ...renewing, paystackRef: "T_renewal_1" }, renewalTxn, NOW);
assert.equal(replayed.granted, false, "a redelivered renewal must not extend twice");
assert.equal(!replayed.granted && replayed.code, "ALREADY_APPLIED");

const underpaidRenewal = validateRenewal(renewing, { ...renewalTxn, amount: 100 }, NOW);
assert.equal(!underpaidRenewal.granted && underpaidRenewal.code, "AMOUNT_MISMATCH", "underpaying renews nothing");

const failedRenewal = validateRenewal(renewing, { ...renewalTxn, status: "failed" }, NOW);
assert.equal(
  !failedRenewal.granted && failedRenewal.code,
  "TRANSACTION_NOT_SUCCESSFUL",
  "a failed recurring charge renews nothing",
);

const freeRenewal = validateRenewal(
  { tier: "FREE", status: "ACTIVE", currentPeriodEnd: null, paystackRef: null },
  renewalTxn,
  NOW,
);
assert.equal(!freeRenewal.granted && freeRenewal.code, "NOT_A_PAID_PLAN", "a FREE row cannot be renewed into paid");

const canceledRenewal = validateRenewal({ ...renewing, status: "CANCELED" }, renewalTxn, NOW);
assert.equal(!canceledRenewal.granted && canceledRenewal.code, "SUBSCRIPTION_CANCELED", "a canceled row is not renewed");

// 8. Registration: a blank name is "not given", not a validation failure.
//    Leaving the optional-looking name field untouched used to 400 the whole
//    signup with "Please check your details".
const blankName = RegistrationBody.safeParse({ email: "a@b.com", password: "abcdefgh", name: "" });
assert.equal(blankName.success, true, "blank name must not block registration");
assert.equal(blankName.success && blankName.data.name, undefined, "blank name is stored as undefined");
const spacedName = RegistrationBody.safeParse({ email: "a@b.com", password: "abcdefgh", name: "   " });
assert.equal(spacedName.success, true, "whitespace-only name must not block registration");
assert.equal(spacedName.success && spacedName.data.name, undefined, "whitespace-only name is undefined");
const givenName = RegistrationBody.safeParse({ email: "a@b.com", password: "abcdefgh", name: "  Ada  " });
assert.equal(givenName.success && givenName.data.name, "Ada", "a real name is kept, trimmed");
assert.equal(
  RegistrationBody.safeParse({ email: "a@b.com", password: "short", name: "Ada" }).success,
  false,
  "a short password is still rejected",
);
assert.equal(
  RegistrationBody.safeParse({ email: "not-an-email", password: "abcdefgh" }).success,
  false,
  "a bad email is still rejected",
);

console.log(
  "Subscription entitlement checks passed: activation without re-login; checkout preserves active access; " +
    "upgrade applies on payment; expired ACTIVE loses access; comps retained; failed/mismatched payments rejected; " +
    "checkout references carry their tier; renewals extend and never double-apply; blank-name registration accepted.",
);

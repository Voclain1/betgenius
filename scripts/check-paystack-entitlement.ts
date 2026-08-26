import assert from "node:assert/strict";
import { validateVerifiedEntitlement } from "../src/lib/paystack/entitlement";

const pending = {
  userId: "user_vip_test",
  userEmail: "vip-test@example.com",
  tier: "VIP",
  paystackRef: "vip_checkout_ref",
  status: "PENDING",
};

const verified = {
  status: "success",
  currency: "NGN",
  amount: 2_000_000,
  reference: "vip_checkout_ref",
  customer: { email: "VIP-Test@example.com" },
  metadata: { userId: "user_vip_test", tier: "VIP" },
};

assert.deepEqual(validateVerifiedEntitlement(pending, verified), []);

const wrongAmount = validateVerifiedEntitlement(pending, { ...verified, amount: 100 });
assert(wrongAmount.some((mismatch) => mismatch.code === "AMOUNT_MISMATCH"));

const wrongReference = validateVerifiedEntitlement(pending, {
  ...verified,
  reference: "different_ref",
});
assert(wrongReference.some((mismatch) => mismatch.code === "REFERENCE_MISMATCH"));

const wrongUser = validateVerifiedEntitlement(pending, {
  ...verified,
  metadata: { ...verified.metadata, userId: "different_user" },
});
assert(wrongUser.some((mismatch) => mismatch.code === "USER_MISMATCH"));

console.log("Paystack entitlement checks passed: valid accepted; malformed amount, reference, and user rejected.");

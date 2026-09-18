/**
 * Payment observability regressions.
 *
 * Two things are being protected here, and the second matters more than the
 * first.
 *
 * 1. THE CLASSIFICATION IS USEFUL. An admin has to be able to tell a fraud
 *    block from a bank decline from an abandoned checkout, because those are
 *    three different people's problems. A category that silently lumps them
 *    together is worse than no category at all, so every mapping is asserted.
 *
 * 2. NOTHING SENSITIVE CAN BE STORED. The extractor is handed a full, realistic
 *    Paystack payload — card BIN and last4, authorization code, access code,
 *    the session log — and the result is asserted to contain none of it, by
 *    scanning the extracted object rather than by trusting the field list. If
 *    someone later widens the extractor to grab the whole transaction, this
 *    fails loudly.
 *
 * No network, no database, no real payment.
 */
import assert from "node:assert/strict";
import { classifyPaymentAttempt, CATEGORY_COPY, PAYMENT_CATEGORIES } from "../src/lib/paystack/failureCategory";
import { SAFE_FIELDS, toSafePaymentAttempt } from "../src/lib/paystack/recordPaymentAttempt";

// ---------------------------------------------------------------------------
// 1. The six distinctions the admin view exists to make.
// ---------------------------------------------------------------------------
assert.equal(
  classifyPaymentAttempt({ status: "success", gatewayResponse: "Approved" }),
  "SUCCESS",
  "an approved charge is a successful payment",
);
assert.equal(
  classifyPaymentAttempt({ status: "failed", gatewayResponse: "Denied by Fraud System." }),
  "FRAUD_BLOCK",
  "the fraud system blocking a charge is OUR problem to raise with Paystack",
);
assert.equal(
  classifyPaymentAttempt({ status: "abandoned", gatewayResponse: "The transaction was not completed" }),
  "ABANDONED",
  "an abandoned checkout is not a failure — nothing was charged",
);
assert.equal(
  classifyPaymentAttempt({ status: "failed", gatewayResponse: "Insufficient Funds" }),
  "INSUFFICIENT_FUNDS",
  "insufficient funds is the payer's to resolve",
);
assert.equal(
  classifyPaymentAttempt({ status: "failed", gatewayResponse: "Declined" }),
  "ISSUER_DECLINE",
  "a bank decline is the payer's bank, not us",
);
assert.equal(
  classifyPaymentAttempt({ status: "failed", gatewayResponse: "System malfunction" }),
  "GATEWAY_FAILURE",
  "a processor failure is nobody's fault and usually transient",
);

// Abandoned must win over its own misleading response text. Reading the text
// first would file every abandonment as an unexplained failure and bury the
// real declines — which is the entire point of the status-first ordering.
assert.equal(
  classifyPaymentAttempt({ status: "abandoned", gatewayResponse: "Declined" }),
  "ABANDONED",
  "status is authoritative over response text for abandonment",
);
// Fraud must win over decline wording, for the same reason in reverse.
assert.equal(
  classifyPaymentAttempt({ status: "failed", gatewayResponse: "Transaction declined by fraud system" }),
  "FRAUD_BLOCK",
  "a fraud block that also reads as a decline is still a fraud block",
);

// Real vocabulary variants seen across Paystack channels.
for (const response of ["do not honour", "Do Not Honor", "Invalid card", "Expired card", "Restricted card"]) {
  assert.equal(
    classifyPaymentAttempt({ status: "failed", gatewayResponse: response }),
    "ISSUER_DECLINE",
    `"${response}" is an issuer decline`,
  );
}
for (const response of ["Insufficient funds", "insufficient balance."]) {
  assert.equal(classifyPaymentAttempt({ status: "failed", gatewayResponse: response }), "INSUFFICIENT_FUNDS");
}
for (const status of ["pending", "ongoing", "queued"]) {
  assert.equal(classifyPaymentAttempt({ status, gatewayResponse: null }), "PENDING", `${status} is still in flight`);
}

// An unrecognised failure is admitted as unknown rather than guessed at.
assert.equal(
  classifyPaymentAttempt({ status: "failed", gatewayResponse: "Something nobody has mapped yet" }),
  "UNKNOWN_FAILURE",
  "an unmapped failure must not be forced into the nearest category",
);
assert.equal(classifyPaymentAttempt({ status: "failed", gatewayResponse: null }), "UNKNOWN_FAILURE");
assert.equal(classifyPaymentAttempt({}), "UNKNOWN_FAILURE", "a missing status is not silently a success");

// Every category is presentable, so the admin view cannot render a blank chip.
for (const category of PAYMENT_CATEGORIES) {
  assert(CATEGORY_COPY[category]?.label, `${category} has a label`);
  assert(CATEGORY_COPY[category]?.hint, `${category} explains who has to act`);
}

// ---------------------------------------------------------------------------
// 2. Sensitive data cannot reach the database.
// ---------------------------------------------------------------------------
// A realistic verify payload, including everything we must never store.
const fullPayload = {
  reference: "bg_VIP_" + "a".repeat(32),
  status: "failed",
  channel: "card",
  gateway_response: "Declined",
  amount: 2_000_000,
  currency: "NGN",
  created_at: "2026-09-18T16:39:31.000Z",
  metadata: { userId: "user_1", tier: "VIP" },
  // None of the following may survive extraction.
  access_code: "lqv0ru1k25ya861",
  authorization: {
    authorization_code: "AUTH_pmx3mgawyd",
    bin: "408408",
    last4: "4081",
    exp_month: "12",
    exp_year: "2030",
    card_type: "visa",
    bank: "TEST BANK",
    signature: "SIG_yEXu7dLDMEpPBQ2tgs",
    account_name: "A Payer",
  },
  customer: { id: 400998669, email: "payer@example.com", phone: "9067084003", customer_code: "CUS_balx6xiwcjpkgqj" },
  log: { history: [{ type: "input", message: "card number entered" }] },
  pin: "1234",
  otp: "123456",
} as any;

const safe = toSafePaymentAttempt(fullPayload);
assert(safe, "a well-formed transaction is extracted");

// The extracted object may contain ONLY the allowlisted keys.
assert.deepEqual(
  Object.keys(safe!).sort(),
  [...SAFE_FIELDS].sort(),
  "the extractor must produce exactly the allowlisted fields — no more",
);

// And, independently of the key list, nothing sensitive may appear anywhere in
// the extracted values. This is the assertion that survives someone widening
// SAFE_FIELDS without thinking.
const serialised = JSON.stringify(safe).toLowerCase();
const mustNotAppear: [string, string][] = [
  ["auth_pmx3mgawyd", "authorization code"],
  ["lqv0ru1k25ya861", "access code"],
  ["408408", "card BIN"],
  ["4081", "card last4"],
  ["sig_yexu7dldmeppbq2tgs", "card signature"],
  ["cus_balx6xiwcjpkgqj", "customer code"],
  ["9067084003", "phone number"],
  ["1234", "PIN"],
  ["123456", "OTP"],
  ["card number entered", "session log"],
];
for (const [needle, what] of mustNotAppear) {
  assert(!serialised.includes(needle), `${what} must never be stored (found "${needle}")`);
}
// Keys that must not exist under any spelling.
for (const forbidden of ["authorization", "access_code", "accesscode", "bin", "last4", "cvv", "pin", "otp", "log", "signature"]) {
  assert(!Object.keys(safe!).some((k) => k.toLowerCase() === forbidden), `no "${forbidden}" field is persisted`);
}

// The safe fields that SHOULD be there, are.
assert.equal(safe!.reference, fullPayload.reference);
assert.equal(safe!.userId, "user_1", "the user id is recorded so an admin can find the customer");
assert.equal(safe!.tier, "VIP");
assert.equal(safe!.channel, "card", "the channel is recorded — it is the evidence we are collecting");
assert.equal(safe!.status, "failed");
assert.equal(safe!.category, "ISSUER_DECLINE");
assert.equal(safe!.gatewayResponse, "Declined");
assert.equal(safe!.amountKobo, 2_000_000);
assert.equal(safe!.currency, "NGN");
assert.equal(safe!.occurredAt.toISOString(), "2026-09-18T16:39:31.000Z");

// The tier is recovered from our own reference even when Paystack sent no
// metadata, which is the case for every transaction Paystack minted itself.
const noMetadata = toSafePaymentAttempt({
  reference: "bg_PREMIUM_" + "b".repeat(32),
  status: "abandoned",
  created_at: "2026-09-18T16:40:24.000Z",
});
assert.equal(noMetadata!.tier, "PREMIUM", "the tier is carried by our reference when metadata is absent");
assert.equal(noMetadata!.category, "ABANDONED");
assert.equal(noMetadata!.userId, null, "an unknown user is null, not invented");

// A transaction with no reference is not recordable — there is nothing to key
// it on, and inventing one would create a duplicate on the next observation.
assert.equal(toSafePaymentAttempt({ status: "failed" }), null, "a transaction with no reference is skipped");

// A malformed timestamp must not produce an Invalid Date in the database.
const badDate = toSafePaymentAttempt({ reference: "T123", status: "failed", created_at: "not-a-date" });
assert(!Number.isNaN(badDate!.occurredAt.getTime()), "a malformed created_at falls back to now");

// Absurdly long text is capped rather than stored whole.
const longResponse = toSafePaymentAttempt({
  reference: "T124",
  status: "failed",
  gateway_response: "x".repeat(5000),
});
assert(longResponse!.gatewayResponse!.length <= 200, "gateway response is capped");

console.log(
  "Payment observability checks passed: fraud block, bank decline, insufficient funds, abandoned, gateway " +
    "failure and success are each distinguished; status outranks misleading response text; unmapped failures " +
    "stay unmapped; and a full Paystack payload yields no authorization code, access code, card BIN/last4, " +
    "signature, customer code, phone, PIN, OTP or session log.",
);

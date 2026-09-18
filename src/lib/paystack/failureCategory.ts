/**
 * What actually went wrong with a payment attempt.
 *
 * WHY A CATEGORY AND NOT JUST PAYSTACK'S STATUS. `failed` covers a bank
 * declining a card, a fraud engine refusing the transaction outright, and
 * Paystack itself falling over — three problems with three different owners.
 * The first is the customer's bank, the second is our Paystack account
 * configuration, and the third is nobody's fault and will pass. Told only
 * "failed", an admin cannot tell whether to reassure a customer, call
 * Paystack, or wait. The category is the difference.
 *
 * DERIVED, NOT STORED AS TRUTH. This maps a status and Paystack's fixed
 * gateway-response string onto our own vocabulary. It is a pure function so
 * every mapping below is asserted in scripts/check-payment-observability.ts,
 * and so re-classifying historical rows later is a backfill rather than a
 * migration.
 *
 * MATCHING IS DELIBERATELY CONSERVATIVE. An unrecognised failure becomes
 * UNKNOWN_FAILURE rather than being forced into the nearest category. A
 * miscategorised failure is worse than an uncategorised one: it sends whoever
 * reads it to the wrong place, confidently. UNKNOWN_FAILURE showing up in the
 * admin view is the signal to add a mapping here.
 */
export const PAYMENT_CATEGORIES = [
  "SUCCESS",
  "ABANDONED",
  "FRAUD_BLOCK",
  "ISSUER_DECLINE",
  "INSUFFICIENT_FUNDS",
  "GATEWAY_FAILURE",
  "PENDING",
  "UNKNOWN_FAILURE",
] as const;

export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

/** What each category means, and who has to act. Shown in the admin view. */
export const CATEGORY_COPY: Record<PaymentCategory, { label: string; hint: string }> = {
  SUCCESS: { label: "Paid", hint: "Charge approved and entitlement granted." },
  ABANDONED: {
    label: "Abandoned",
    hint: "The payer opened checkout and left without completing. No charge was attempted.",
  },
  FRAUD_BLOCK: {
    label: "Fraud block",
    hint: "Paystack's fraud system refused the transaction. Ours to raise with Paystack, not the payer's bank.",
  },
  ISSUER_DECLINE: {
    label: "Bank declined",
    hint: "The payer's bank or card issuer refused it. The payer needs to use another method or call their bank.",
  },
  INSUFFICIENT_FUNDS: {
    label: "Insufficient funds",
    hint: "The account did not have the amount available. The payer can retry themselves.",
  },
  GATEWAY_FAILURE: {
    label: "Gateway failure",
    hint: "Paystack or the upstream processor failed. Usually transient; nobody needs to change anything.",
  },
  PENDING: { label: "Pending", hint: "Still in flight — a transfer or USSD confirmation not yet settled." },
  UNKNOWN_FAILURE: {
    label: "Unclassified",
    hint: "A failure we have no mapping for. Add it to lib/paystack/failureCategory.",
  },
};

/** True when the attempt is money in the bank. Everything else is not. */
export function isPaid(category: PaymentCategory): boolean {
  return category === "SUCCESS";
}

const NORMALISE = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\.$/, "");

// Paystack's gateway responses are a fixed vocabulary, but it varies in
// punctuation and casing between channels, so each entry is matched as a
// substring of the normalised response rather than by equality.
const FRAUD = ["denied by fraud system", "fraud", "blocked by risk", "declined by risk"];

const INSUFFICIENT = ["insufficient funds", "insufficient balance", "not enough funds"];

const ISSUER = [
  "declined",
  "do not honour",
  "do not honor",
  "invalid card",
  "expired card",
  "restricted card",
  "lost or stolen",
  "card not supported",
  "card does not support",
  "transaction not permitted",
  "invalid pin",
  "incorrect pin",
  "pin tries exceeded",
  "invalid account",
  "no account",
  "account is dormant",
  "issuer",
  "exceeds withdrawal limit",
  "limit exceeded",
];

const GATEWAY = [
  "system malfunction",
  "processor",
  "gateway",
  "timeout",
  "timed out",
  "connection",
  "unable to process",
  "service unavailable",
  "try again later",
  "an error occurred",
];

function matches(response: string, needles: string[]): boolean {
  return needles.some((needle) => response.includes(needle));
}

/**
 * Classify one Paystack transaction.
 *
 * Status is checked before the response text because status is authoritative:
 * an `abandoned` transaction always carries "The transaction was not
 * completed", which reads like a failure and is not one — nothing was ever
 * charged. Reading the text first would file every abandonment as an
 * unexplained failure and bury the real declines.
 */
export function classifyPaymentAttempt(input: {
  status?: string | null;
  gatewayResponse?: string | null;
}): PaymentCategory {
  const status = NORMALISE(input.status);
  const response = NORMALISE(input.gatewayResponse);

  if (status === "success") return "SUCCESS";
  if (status === "abandoned") return "ABANDONED";
  if (status === "pending" || status === "ongoing" || status === "queued") return "PENDING";

  // `failed` and `reversed` are the ones that need the response text to mean
  // anything. Fraud is checked first: a fraud block often also reads as a
  // decline, and attributing it to the payer's bank would send an admin
  // chasing the wrong party.
  if (matches(response, FRAUD)) return "FRAUD_BLOCK";
  if (matches(response, INSUFFICIENT)) return "INSUFFICIENT_FUNDS";
  if (matches(response, ISSUER)) return "ISSUER_DECLINE";
  if (matches(response, GATEWAY)) return "GATEWAY_FAILURE";

  return "UNKNOWN_FAILURE";
}

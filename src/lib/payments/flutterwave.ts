import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { PLAN_PRICING, koboFor, type PaidTier } from "@/lib/pricing";
import { classifyPaymentAttempt } from "@/lib/paystack/failureCategory";
import { grantPayment } from "@/lib/payments/grant";

/**
 * Flutterwave Standard checkout (v3 API).
 *
 * Same principles as the Paystack integration, which this mirrors:
 *   - THE AMOUNT IS NEVER THE BROWSER'S. It comes from lib/pricing by tier.
 *   - ARRIVING BACK GRANTS NOTHING. The redirect's ?status=successful is a hint;
 *     access is granted only from Flutterwave's own /transactions/:id/verify
 *     response, fetched server-side, and only when every check passes.
 *   - EXACTLY ONCE. The return page and the webhook can both present the same
 *     transaction; lib/payments/grant claims the ledger row once.
 *
 * Our reference (`tx_ref`) carries the tier being bought, like Paystack's
 * bg_<TIER>_ references: fw_<TIER>_<32 hex>.
 */
const BASE = "https://api.flutterwave.com/v3";
const REFERENCE = /^fw_(VIP|PREMIUM)_[0-9a-f]{32}$/;

export function newFlutterwaveReference(tier: PaidTier): string {
  return `fw_${tier}_${crypto.randomBytes(16).toString("hex")}`;
}

export function tierFromFlutterwaveReference(ref: string | null | undefined): PaidTier | null {
  if (!ref || !REFERENCE.test(ref)) return null;
  return ref.split("_")[1] as PaidTier;
}

async function flw<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY ?? ""}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== "success") throw new Error(json.message || `Flutterwave error ${res.status}`);
  return json as T;
}

export async function initializeFlutterwave(input: { tier: PaidTier; userId: string; email: string }) {
  const reference = newFlutterwaveReference(input.tier);
  const site = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const json = await flw<{ data: { link: string } }>("/payments", {
    method: "POST",
    body: JSON.stringify({
      tx_ref: reference,
      amount: PLAN_PRICING[input.tier].ngn,
      currency: "NGN",
      redirect_url: `${site}/dashboard?paid=1&provider=flutterwave`,
      customer: { email: input.email },
      meta: { userId: input.userId, tier: input.tier },
      customizations: { title: "BetGenius", description: `${input.tier === "PREMIUM" ? "Premium" : "VIP"}, 30 days` },
    }),
  });
  return { link: json.data.link, reference };
}

/** The webhook's shared secret, compared in constant time. */
export function validFlutterwaveSignature(header: string | null): boolean {
  const secret = process.env.FLUTTERWAVE_SECRET_HASH;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type VerifiedFlutterwave = {
  id?: number;
  tx_ref?: string;
  amount?: number;
  currency?: string;
  status?: string;
  processor_response?: string;
  payment_type?: string;
  created_at?: string;
  customer?: { email?: string };
};

/**
 * Every check a payment must pass to grant. Pure, so each rule is asserted in
 * scripts/check-payments.ts. Returns the problems; none means grant.
 */
export function flutterwaveMismatches(tx: VerifiedFlutterwave, expect: { reference: string; email: string }): string[] {
  const problems: string[] = [];
  const tier = tierFromFlutterwaveReference(tx.tx_ref);
  if (tx.status !== "successful") problems.push("NOT_SUCCESSFUL");
  if (tx.tx_ref !== expect.reference || !tier) problems.push("REFERENCE_MISMATCH");
  if (tx.currency !== "NGN") problems.push("CURRENCY_MISMATCH");
  // `amount` is what was asked for; a fee passed to the customer shows in
  // charged_amount instead, so the price check stays exact.
  if (tier && Math.round((tx.amount ?? 0) * 100) !== koboFor(tier)) problems.push("AMOUNT_MISMATCH");
  if ((tx.customer?.email ?? "").trim().toLowerCase() !== expect.email.trim().toLowerCase()) problems.push("CUSTOMER_MISMATCH");
  return problems;
}

export type FlutterwaveOutcome =
  | { outcome: "GRANTED" | "ALREADY_GRANTED" }
  | { outcome: "NOT_PAID"; status: string | null }
  | { outcome: "REJECTED"; problems: string[] }
  | { outcome: "VERIFICATION_FAILED"; message: string };

/**
 * Verify one transaction with Flutterwave and apply it.
 * `expectUserId` (the return page) restricts it to the signed-in user's own payment.
 */
export async function applyFlutterwaveTransaction(transactionId: string, source: "CALLBACK" | "WEBHOOK", expectUserId?: string): Promise<FlutterwaveOutcome> {
  let tx: VerifiedFlutterwave;
  try {
    tx = (await flw<{ data: VerifiedFlutterwave }>(`/transactions/${encodeURIComponent(transactionId)}/verify`)).data ?? {};
  } catch (error) {
    return { outcome: "VERIFICATION_FAILED", message: error instanceof Error ? error.message : "Unknown error" };
  }
  const reference = tx.tx_ref ?? "";
  const tier = tierFromFlutterwaveReference(reference);
  if (!tier) return { outcome: "REJECTED", problems: ["NOT_OUR_REFERENCE"] };

  // The account is the one whose email Flutterwave verified the payment for.
  const user = await prisma.user.findUnique({ where: { email: (tx.customer?.email ?? "").trim().toLowerCase() }, select: { id: true, email: true } });
  if (!user || (expectUserId && user.id !== expectUserId)) return { outcome: "REJECTED", problems: ["USER_MISMATCH"] };

  const occurredAt = tx.created_at ? new Date(tx.created_at) : new Date();
  if (tx.status !== "successful") {
    // Recorded so /admin/payments shows Flutterwave attempts that did not pay.
    const status = tx.status === "failed" ? "failed" : tx.status === "cancelled" ? "abandoned" : "pending";
    await prisma.paymentAttempt
      .upsert({
        where: { reference },
        create: {
          reference,
          provider: "FLUTTERWAVE",
          userId: user.id,
          tier,
          channel: tx.payment_type ?? null,
          status,
          category: classifyPaymentAttempt({ status, gatewayResponse: tx.processor_response }),
          gatewayResponse: tx.processor_response?.slice(0, 200) ?? null,
          amountKobo: Math.round((tx.amount ?? 0) * 100),
          currency: tx.currency ?? null,
          occurredAt,
          source,
        },
        update: { status, gatewayResponse: tx.processor_response?.slice(0, 200) ?? null },
      })
      .catch(() => null);
    return { outcome: "NOT_PAID", status: tx.status ?? null };
  }

  const problems = flutterwaveMismatches(tx, { reference, email: user.email });
  if (problems.length) {
    console.error("Flutterwave payment refused", { reference, problems });
    await prisma.paymentAttempt
      .upsert({
        where: { reference },
        create: { reference, provider: "FLUTTERWAVE", userId: user.id, tier, status: "success", category: "SUCCESS", amountKobo: Math.round((tx.amount ?? 0) * 100), currency: tx.currency ?? null, occurredAt, source, entitlementError: problems.join(",") },
        update: { entitlementError: problems.join(",") },
      })
      .catch(() => null);
    return { outcome: "REJECTED", problems };
  }

  const result = await grantPayment({
    reference,
    provider: "FLUTTERWAVE",
    userId: user.id,
    tier,
    amountMinor: koboFor(tier),
    currency: "NGN",
    channel: tx.payment_type ?? null,
    occurredAt,
    source,
  });
  return { outcome: result.outcome };
}

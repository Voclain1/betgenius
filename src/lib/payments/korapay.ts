import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { PLAN_PRICING, koboFor, type PaidTier } from "@/lib/pricing";
import { classifyPaymentAttempt } from "@/lib/paystack/failureCategory";
import { grantPayment } from "@/lib/payments/grant";

/**
 * Korapay (Kora) Checkout Standard.
 *
 * Same principles as Paystack and Flutterwave:
 *   - THE AMOUNT IS NEVER THE BROWSER'S. It comes from lib/pricing by tier.
 *   - ARRIVING BACK GRANTS NOTHING. Access is granted only from Korapay's own
 *     GET /charges/:reference response, fetched server-side, and only when
 *     every check passes. The webhook is used for the reference alone.
 *   - EXACTLY ONCE. The return page and the webhook can both present the same
 *     charge; lib/payments/grant claims the ledger row once.
 *
 * Korapay's charge record does not carry the payer's email, so the account a
 * charge belongs to is bound on OUR side: starting a checkout writes a pending
 * PaymentAttempt with the userId, and only that row's owner can be granted.
 *
 * Our reference carries the tier being bought: kp_<TIER>_<32 hex>.
 * Korapay amounts are in naira (major units), unlike Paystack's kobo.
 */
const BASE = "https://api.korapay.com/merchant/api/v1";
const REFERENCE = /^kp_(VIP|PREMIUM)_[0-9a-f]{32}$/;

export function newKorapayReference(tier: PaidTier): string {
  return `kp_${tier}_${crypto.randomBytes(16).toString("hex")}`;
}

export function tierFromKorapayReference(ref: string | null | undefined): PaidTier | null {
  if (!ref || !REFERENCE.test(ref)) return null;
  return ref.split("_")[1] as PaidTier;
}

async function kora<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.KORAPAY_SECRET_KEY ?? ""}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== true) throw new Error(json.message || `Korapay error ${res.status}`);
  return json as T;
}

export async function initializeKorapay(input: { tier: PaidTier; userId: string; email: string }) {
  const reference = newKorapayReference(input.tier);
  const site = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  // Bind the reference to this account before the customer can pay against it.
  await prisma.paymentAttempt.create({
    data: {
      reference,
      provider: "KORAPAY",
      userId: input.userId,
      tier: input.tier,
      status: "pending",
      category: classifyPaymentAttempt({ status: "pending" }),
      amountKobo: koboFor(input.tier),
      currency: "NGN",
      occurredAt: new Date(),
      source: "CHECKOUT",
    },
  });
  const json = await kora<{ data: { checkout_url: string } }>("/charges/initialize", {
    method: "POST",
    body: JSON.stringify({
      reference,
      amount: PLAN_PRICING[input.tier].ngn,
      currency: "NGN",
      redirect_url: `${site}/dashboard?paid=1&provider=korapay&reference=${reference}`,
      notification_url: `${site}/api/payments/korapay/webhook`,
      narration: `BetGenius ${input.tier === "PREMIUM" ? "Premium" : "VIP"}, 30 days`,
      customer: { email: input.email },
      metadata: { userId: input.userId, tier: input.tier },
    }),
  }).catch(async (error) => {
    // No checkout exists, so the pending row would be a phantom attempt.
    await prisma.paymentAttempt.delete({ where: { reference } }).catch(() => null);
    throw error;
  });
  return { link: json.data.checkout_url, reference };
}

/**
 * Korapay signs webhooks with HMAC-SHA256 (key: the secret key) in
 * x-korapay-signature. Its docs say the `data` object is what is signed; the
 * raw body is accepted too. The signature only filters noise: nothing in the
 * body is trusted, because the charge is re-fetched from Korapay before any
 * grant.
 */
export function validKorapaySignature(rawBody: string, header: string | null, secret = process.env.KORAPAY_SECRET_KEY): boolean {
  if (!secret || !header) return false;
  const candidates: string[] = [rawBody];
  try {
    const data = (JSON.parse(rawBody) as { data?: unknown }).data;
    if (data !== undefined) candidates.unshift(JSON.stringify(data));
  } catch {
    return false;
  }
  const given = Buffer.from(header.trim().toLowerCase());
  return candidates.some((payload) => {
    const expected = Buffer.from(crypto.createHmac("sha256", secret).update(payload).digest("hex"));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  });
}

export type VerifiedKorapay = {
  reference?: string;
  amount?: number | string;
  amount_paid?: number | string;
  currency?: string;
  status?: string;
  payment_method?: string;
  created_at?: string;
};

/**
 * Every check a charge must pass to grant. Pure, so each rule is asserted in
 * scripts/check-payments.ts. Returns the problems; none means grant.
 */
export function korapayMismatches(charge: VerifiedKorapay, expect: { reference: string }): string[] {
  const problems: string[] = [];
  const tier = tierFromKorapayReference(charge.reference);
  if (charge.status !== "success") problems.push("NOT_SUCCESSFUL");
  if (charge.reference !== expect.reference || !tier) problems.push("REFERENCE_MISMATCH");
  if (charge.currency !== "NGN") problems.push("CURRENCY_MISMATCH");
  if (tier && Math.round(Number(charge.amount ?? 0) * 100) !== koboFor(tier)) problems.push("AMOUNT_MISMATCH");
  return problems;
}

export type KorapayOutcome =
  | { outcome: "GRANTED" | "ALREADY_GRANTED" }
  | { outcome: "NOT_PAID"; status: string | null }
  | { outcome: "REJECTED"; problems: string[] }
  | { outcome: "VERIFICATION_FAILED"; message: string };

/**
 * Verify one charge with Korapay and apply it.
 * `expectUserId` (the return page) restricts it to the signed-in user's own payment.
 */
export async function applyKorapayCharge(reference: string, source: "CALLBACK" | "WEBHOOK" | "RECONCILE", expectUserId?: string): Promise<KorapayOutcome> {
  const tier = tierFromKorapayReference(reference);
  if (!tier) return { outcome: "REJECTED", problems: ["NOT_OUR_REFERENCE"] };
  const row = await prisma.paymentAttempt.findUnique({ where: { reference }, select: { userId: true } });
  if (!row?.userId || (expectUserId && row.userId !== expectUserId)) return { outcome: "REJECTED", problems: ["USER_MISMATCH"] };
  // When Korapay told us about it, for the admin Payments log.
  const seen = source === "WEBHOOK" ? { webhookAt: new Date() } : source === "CALLBACK" ? { callbackAt: new Date() } : {};

  let charge: VerifiedKorapay;
  try {
    charge = (await kora<{ data: VerifiedKorapay }>(`/charges/${encodeURIComponent(reference)}`)).data ?? {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.paymentAttempt.update({ where: { reference }, data: { verifyError: message.slice(0, 300), ...seen } }).catch(() => null);
    return { outcome: "VERIFICATION_FAILED", message };
  }

  if (charge.status !== "success") {
    const status = charge.status === "failed" ? "failed" : charge.status === "expired" ? "abandoned" : "pending";
    await prisma.paymentAttempt
      .update({ where: { reference }, data: { status, category: classifyPaymentAttempt({ status }), channel: charge.payment_method ?? null, source, verifyError: null, ...seen } })
      .catch(() => null);
    return { outcome: "NOT_PAID", status: charge.status ?? null };
  }

  const problems = korapayMismatches(charge, { reference });
  if (problems.length) {
    console.error("Korapay payment refused", { reference, problems });
    await prisma.paymentAttempt.update({ where: { reference }, data: { entitlementError: problems.join(","), verifyError: null, ...seen } }).catch(() => null);
    return { outcome: "REJECTED", problems };
  }

  const result = await grantPayment({
    reference,
    provider: "KORAPAY",
    userId: row.userId,
    tier,
    amountMinor: koboFor(tier),
    currency: "NGN",
    channel: charge.payment_method ?? null,
    occurredAt: charge.created_at ? new Date(charge.created_at) : new Date(),
    source,
  });
  await prisma.paymentAttempt.update({ where: { reference }, data: { verifyError: null, ...seen } }).catch(() => null);
  return { outcome: result.outcome };
}

/**
 * Missed-webhook recovery. A Korapay webhook can fail to arrive (our deploy
 * was restarting, a network blip, Korapay gave up retrying), and a payer who
 * closed the tab never comes back through the return page. This finds our own
 * recent Korapay checkouts that are still pending and asks Korapay about each,
 * through applyKorapayCharge: the same verified, exactly-once path as the
 * webhook, so a sweep can never grant anything the webhook would not have.
 *
 * Runs on a schedule (deploy/ops/crontab, /api/payments/korapay/reconcile).
 */
export const KORAPAY_SWEEP = {
  /** Leave the webhook and the return page a head start. */
  MIN_AGE_MS: 3 * 60_000,
  /**
   * Korapay's one-time transfer accounts and checkouts are long expired by
   * then. An abandoned checkout stays "pending" at Korapay, so a longer
   * window would only re-ask about it for nothing.
   */
  MAX_AGE_MS: 24 * 60 * 60_000,
  /** Per run; a run every 10 minutes clears a backlog quickly. */
  LIMIT: 40,
} as const;

/** Which attempts a sweep re-checks. Pure, so the window is asserted in scripts/check-payments.ts. */
export function korapaySweepWhere(now: Date) {
  return {
    provider: "KORAPAY",
    status: "pending",
    entitlementGrantedAt: null,
    entitlementError: null,
    occurredAt: { gte: new Date(now.getTime() - KORAPAY_SWEEP.MAX_AGE_MS), lte: new Date(now.getTime() - KORAPAY_SWEEP.MIN_AGE_MS) },
  };
}

export type KorapaySweep = { checked: number; granted: number; notPaid: number; refused: number; failed: number };

export async function sweepKorapay(now: Date = new Date(), apply: typeof applyKorapayCharge = applyKorapayCharge): Promise<KorapaySweep> {
  const pending = await prisma.paymentAttempt.findMany({
    where: korapaySweepWhere(now),
    orderBy: { occurredAt: "desc" },
    select: { reference: true },
    take: KORAPAY_SWEEP.LIMIT,
  });
  const out: KorapaySweep = { checked: 0, granted: 0, notPaid: 0, refused: 0, failed: 0 };
  for (const { reference } of pending) {
    out.checked += 1;
    const result = await apply(reference, "RECONCILE");
    switch (result.outcome) {
      case "GRANTED":
        out.granted += 1;
        break;
      case "ALREADY_GRANTED":
        break;
      case "NOT_PAID":
        out.notPaid += 1;
        break;
      case "REJECTED":
        out.refused += 1;
        break;
      default:
        out.failed += 1;
    }
  }
  if (out.granted || out.refused || out.failed) console.info("Korapay sweep", out);
  return out;
}

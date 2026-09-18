/**
 * Paystack client.
 * Docs: https://paystack.com/docs/api
 */

const SECRET = process.env.PAYSTACK_SECRET_KEY || "";
const BASE = "https://api.paystack.co";

export const PAYSTACK_PLANS = {
  VIP: process.env.PAYSTACK_PLAN_VIP || "",
  PREMIUM: process.env.PAYSTACK_PLAN_PREMIUM || "",
};

async function paystackFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || json.status === false) {
    throw new Error(json.message || `Paystack error ${res.status}`);
  }
  return json as T;
}

/** Initialize a checkout/transaction. Returns the authorization URL to redirect to. */
export function initializeTransaction(input: {
  email: string;
  amountKobo: number; // kobo (NGN * 100)
  plan?: string;
  reference?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
}) {
  return paystackFetch<{
    status: boolean;
    message: string;
    data: { authorization_url: string; reference: string; access_code: string };
  }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      plan: input.plan,
      reference: input.reference,
      callback_url: input.callback_url,
      metadata: input.metadata,
    }),
  });
}

export function verifyTransaction(reference: string) {
  return paystackFetch<{ status: boolean; data: any }>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

/**
 * Recent transactions, newest first. READ-ONLY, and used only to reconcile the
 * payment-attempt log: an abandoned checkout never produces a webhook and the
 * payer never returns to trigger the callback, so listing is the only way it
 * can be observed at all.
 *
 * It does not, and must not, retry anything. Nothing in this client re-charges
 * or re-initializes a transaction.
 */
export function listTransactions(perPage = 100) {
  return paystackFetch<{
    status: boolean;
    data: Array<{
      reference?: string;
      status?: string;
      channel?: string;
      gateway_response?: string;
      amount?: number;
      currency?: string;
      created_at?: string;
      metadata?: { userId?: string; tier?: string } | null;
    }>;
  }>(`/transaction?perPage=${encodeURIComponent(String(perPage))}`);
}

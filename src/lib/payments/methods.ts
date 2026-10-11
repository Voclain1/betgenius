import { randomInt } from "node:crypto";

/**
 * Which ways to pay are switched on, and the details customers need.
 *
 * Each method is on only when its settings exist in the environment, so a
 * method can be added or withdrawn from Vercel without a code change, and a
 * half-configured one never appears:
 *
 *   PAYSTACK     PAYSTACK_SECRET_KEY
 *   FLUTTERWAVE  FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_SECRET_HASH (the
 *                webhook secret — without it payments could not be confirmed
 *                when the payer closes the tab)
 *   KORAPAY      KORAPAY_SECRET_KEY (also signs its webhooks)
 *   BANK         BANK_TRANSFER_BANK_NAME, BANK_TRANSFER_ACCOUNT_NUMBER,
 *                BANK_TRANSFER_ACCOUNT_NAME
 *   USDT         USDT_WALLET_ADDRESS (USDT_NETWORK, default "TRC20")
 */
export type PaymentMethod = "PAYSTACK" | "KORAPAY" | "FLUTTERWAVE" | "BANK" | "USDT";

export function enabledMethods(env: Record<string, string | undefined> = process.env): PaymentMethod[] {
  const methods: PaymentMethod[] = [];
  if (env.PAYSTACK_SECRET_KEY) methods.push("PAYSTACK");
  if (env.KORAPAY_SECRET_KEY) methods.push("KORAPAY");
  if (env.FLUTTERWAVE_SECRET_KEY && env.FLUTTERWAVE_SECRET_HASH) methods.push("FLUTTERWAVE");
  if (env.BANK_TRANSFER_BANK_NAME && env.BANK_TRANSFER_ACCOUNT_NUMBER && env.BANK_TRANSFER_ACCOUNT_NAME) methods.push("BANK");
  if (env.USDT_WALLET_ADDRESS) methods.push("USDT");
  return methods;
}

export function bankDetails(env: Record<string, string | undefined> = process.env) {
  return {
    bankName: env.BANK_TRANSFER_BANK_NAME ?? "",
    accountNumber: env.BANK_TRANSFER_ACCOUNT_NUMBER ?? "",
    accountName: env.BANK_TRANSFER_ACCOUNT_NAME ?? "",
  };
}

export function usdtDetails(env: Record<string, string | undefined> = process.env) {
  return { address: env.USDT_WALLET_ADDRESS ?? "", network: env.USDT_NETWORK || "TRC20" };
}

/** The short code a customer puts in the transfer narration. No 0/O, 1/I/L. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newManualCode(pick: (n: number) => number = randomInt): string {
  let out = "BG-";
  for (let i = 0; i < 6; i++) out += ALPHABET[pick(ALPHABET.length)];
  return out;
}

/** The ledger reference for an approved manual payment. */
export function manualReference(code: string): string {
  return `manual_${code}`;
}

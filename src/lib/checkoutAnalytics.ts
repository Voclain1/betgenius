import { PLAN_PRICING, type PaidTier } from "./pricing";
/** USDT is not an ISO reporting currency. Keep funnel counts without inventing NGN or an exchange rate. */
export function checkoutAnalytics(tier: PaidTier, method: string) {
  const item = { item_id: tier, item_name: `BetGenius ${tier}`, quantity: 1 };
  return method === "USDT"
    ? { payment_type: "usdt", items: [item] }
    : {
        currency: "NGN",
        value: PLAN_PRICING[tier].ngn,
        payment_type: method.toLowerCase(),
        items: [{ ...item, price: PLAN_PRICING[tier].ngn }],
      };
}
export function paymentProviderName(
  provider: string | null | undefined,
): string {
  return provider === "flutterwave"
    ? "Flutterwave"
    : provider === "korapay"
      ? "Korapay"
      : "Paystack";
}

/**
 * Small client-only wrapper around the production GA4 tag and Meta Pixel.
 *
 * Local and preview builds render neither Analytics.tsx nor MetaPixel.tsx, so
 * events deliberately become no-ops there. Event payloads must never contain
 * names, emails or any other user-provided values.
 *
 * Call sites name the GA4 event; the three conversion events are forwarded to
 * Meta under its standard names, from the same place and at the same moment,
 * so the two tools count the same boundaries. Every other event is GA4-only.
 */
type Params = Record<string, unknown>;
type Fbq = (...args: unknown[]) => void;

export function trackEvent(name: string, params: Params = {}): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { gtag?: (...args: unknown[]) => void; fbq?: Fbq };
  if (typeof w.gtag === "function") w.gtag("event", name, params);
  if (typeof w.fbq === "function") trackMetaEvent(w.fbq, name, params);
}

function trackMetaEvent(fbq: Fbq, name: string, params: Params): void {
  const items = Array.isArray(params.items) ? (params.items as { item_id?: unknown }[]) : [];
  const commerce = {
    currency: params.currency,
    value: params.value,
    content_ids: items.map((item) => item.item_id),
    content_type: "product",
  };

  switch (name) {
    case "sign_up":
      fbq("track", "CompleteRegistration", { content_name: params.method });
      return;
    case "begin_checkout":
      fbq("track", "InitiateCheckout", commerce);
      return;
    case "purchase":
      // eventID lets Meta drop a repeat of the same Paystack reference, the
      // counterpart of GA4 deduplicating on transaction_id.
      fbq("track", "Purchase", commerce, { eventID: params.transaction_id });
      return;
  }
}
